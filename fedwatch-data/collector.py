#!/usr/bin/env python3
"""Publish the official FedWatch historical CSV probabilities, without modelling them.

The browser enters through CME's public parent page and discovers the current
download links in the rendered Downloads view. Session identifiers are never
persisted or printed. No credentials, forged referrers, or anti-bot workarounds
are used. Any failed meeting download or validation keeps latest.json intact.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Awaitable, Callable, Mapping, Union
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo


OFFICIAL_PARENT = "https://www.cmegroup.com/cn-t/markets/interest-rates/cme-fedwatch-tool.html"
QUICKSTRIKE_HOST = "cmegroup-tools.quikstrike.net"
MAX_CSV_BYTES = 8 * 1024 * 1024
NEW_YORK = ZoneInfo("America/New_York")


class CollectionError(ValueError):
    """An intentionally public error message, containing no session URL."""


@dataclass(frozen=True)
class Snapshot:
    as_of: date
    rates: list[dict[str, int | float]]

    def as_json(self) -> dict:
        return {"as_of": self.as_of.isoformat(), "rates": self.rates}


def utc_timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("A timezone-aware datetime is required")
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_probability_csv(content: bytes | str) -> list[Snapshot]:
    """Read official fraction-valued CSVs; blanks are unknown, never zero.

    Only empty bins outside a row's populated range are omitted. An empty bin
    inside that range, a truncated row, or a probability total outside the CSV's
    six-decimal rounding tolerance is rejected.
    """
    if isinstance(content, bytes):
        if len(content) > MAX_CSV_BYTES:
            raise CollectionError("Official CSV exceeds the allowed size")
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise CollectionError("Official CSV is not valid UTF-8") from None
    else:
        text = content.removeprefix("\ufeff")
        if len(text.encode("utf-8")) > MAX_CSV_BYTES:
            raise CollectionError("Official CSV exceeds the allowed size")
    try:
        rows = list(csv.reader(io.StringIO(text, newline=""), strict=True))
    except csv.Error:
        raise CollectionError("Malformed official CSV") from None
    if not rows or len(rows[0]) < 2 or rows[0][0] != "Date":
        raise CollectionError("Expected an official CSV with a Date header; received another response")

    header = rows[0]
    bins: list[tuple[int, int]] = []
    for column in header[1:]:
        match = re.fullmatch(r"\((\d+)-(\d+)\)", column)
        if not match:
            raise CollectionError("Invalid rate-range header in official CSV")
        lower, upper = map(int, match.groups())
        if upper - lower != 25 or (bins and bins[-1][1] != lower):
            raise CollectionError("Official CSV rate ranges are duplicated, missing, or out of order")
        bins.append((lower, upper))

    snapshots: list[Snapshot] = []
    for row_number, row in enumerate(rows[1:], start=2):
        if not row or all(not value.strip() for value in row):
            continue
        if len(row) != len(header):
            raise CollectionError(f"Incomplete official CSV row {row_number}")
        if not re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", row[0]):
            raise CollectionError(f"Invalid reporting date in official CSV row {row_number}")
        try:
            reporting_date = datetime.strptime(row[0], "%m/%d/%Y").date()
        except ValueError:
            raise CollectionError(f"Invalid reporting date in official CSV row {row_number}") from None
        if snapshots and reporting_date <= snapshots[-1].as_of:
            raise CollectionError("Official CSV dates are duplicated or out of order")

        populated = [index for index, value in enumerate(row[1:]) if value.strip()]
        if not populated:
            raise CollectionError(f"No probabilities in official CSV row {row_number}")
        first, last = populated[0], populated[-1]
        if populated != list(range(first, last + 1)):
            raise CollectionError(f"Missing probability inside official CSV row {row_number}")
        rates = []
        total = Decimal(0)
        for index in populated:
            raw = row[index + 1].strip()
            try:
                probability = Decimal(raw)
            except InvalidOperation:
                raise CollectionError(f"Invalid probability in official CSV row {row_number}") from None
            if not probability.is_finite() or not Decimal(0) <= probability <= Decimal(1):
                raise CollectionError(f"Out-of-range probability in official CSV row {row_number}")
            total += probability
            rates.append({
                "lower_bps": bins[index][0],
                "upper_bps": bins[index][1],
                "probability": float(probability),
            })
        # Each exported fraction is rounded to six decimals. Preserve those
        # fractions; do not renormalize or manufacture missing probability mass.
        rounding_tolerance = Decimal("0.00000051") * len(rates)
        if abs(total - Decimal(1)) > max(Decimal("0.000001"), rounding_tolerance):
            raise CollectionError(f"Probabilities do not sum to 100% in official CSV row {row_number}")
        snapshots.append(Snapshot(reporting_date, rates))

    if not snapshots:
        raise CollectionError("Official CSV has no reporting rows")
    return snapshots


def build_payload(downloads: Mapping[date, bytes | str], retrieved_at: datetime) -> dict:
    if not downloads:
        raise CollectionError("No upcoming official meeting downloads were found")
    today = retrieved_at.astimezone(NEW_YORK).date()
    meetings = []
    for meeting_date, content in sorted(downloads.items()):
        if meeting_date < today:
            raise CollectionError("A past meeting was supplied as an upcoming meeting")
        history = parse_probability_csv(content)
        if any(snapshot.as_of > min(today, meeting_date) for snapshot in history):
            raise CollectionError(f"A future reporting date was received for meeting {meeting_date.isoformat()}")
        latest = history[-1]
        week_limit = latest.as_of - timedelta(days=7)
        previous_week = next((snapshot for snapshot in reversed(history[:-1]) if snapshot.as_of <= week_limit), None)
        meetings.append({
            "meeting_date": meeting_date.isoformat(),
            **latest.as_json(),
            "previous_day": history[-2].as_json() if len(history) > 1 else None,
            "previous_week": previous_week.as_json() if previous_week else None,
        })
    return {
        "schema_version": 1,
        "source": {"name": "CME FedWatch", "url": OFFICIAL_PARENT},
        "retrieved_at": utc_timestamp(retrieved_at),
        "data_as_of": min(meeting["as_of"] for meeting in meetings),
        "meetings": meetings,
    }


def extract_meeting_downloads(hrefs: list[str], today: date) -> dict[date, str]:
    """Validate rendered download links without exposing their session values."""
    downloads: dict[date, str] = {}
    for href in hrefs:
        parsed = urlsplit(href)
        if (parsed.scheme != "https" or parsed.hostname != QUICKSTRIKE_HOST
                or parsed.username or parsed.password
                or parsed.path != "/User/Export/FedWatch/MeetingExport.aspx"):
            raise CollectionError("An unexpected official meeting download address was received")
        meeting_values = parse_qs(parsed.query).get("MeetingDate", [])
        if len(meeting_values) != 1 or not re.fullmatch(r"\d{8}", meeting_values[0]):
            raise CollectionError("An official download link has an invalid meeting date")
        try:
            meeting_date = datetime.strptime(meeting_values[0], "%Y%m%d").date()
        except ValueError:
            raise CollectionError("An official download link has an invalid meeting date") from None
        if meeting_date < today:
            continue
        if meeting_date in downloads:
            raise CollectionError("Duplicate upcoming meeting download links were received")
        downloads[meeting_date] = href
    if not downloads:
        raise CollectionError("No upcoming official meeting downloads were found")
    return downloads


async def fetch_official_csvs(timeout_seconds: float = 120, *, headless: bool = True) -> dict[date, bytes]:
    try:
        from playwright.async_api import async_playwright, TimeoutError as BrowserTimeout
    except ImportError:
        raise CollectionError("Playwright is not installed; install requirements.txt and Chromium") from None

    async def fetch() -> dict[date, bytes]:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=headless, channel="chromium")
            try:
                context = await browser.new_context(accept_downloads=True, locale="en-US")
                page = await context.new_page()
                page.set_default_timeout(timeout_seconds * 1000)
                response = await page.goto(OFFICIAL_PARENT, wait_until="domcontentloaded")
                if response is None or response.status >= 400:
                    status = response.status if response else "no response"
                    raise CollectionError(f"Official CME parent page could not be loaded (HTTP {status})")
                consent = page.get_by_role("button", name=re.compile(r"接受所有\s*Cookie|Accept All Cookies", re.I))
                try:
                    await consent.first.wait_for(state="visible", timeout=5000)
                    await consent.first.click()
                except BrowserTimeout:
                    pass  # Consent is not shown in every region or session.
                # The iframe is created and navigated by CME's own parent page.
                # Entering through the parent provides the normal public session.
                frame = page.frame_locator('iframe[src*="cmegroup-tools.quikstrike.net"]')
                await frame.locator('a[id$="_lbDownloads"]').click()
                links = frame.locator('a[href*="Export/FedWatch/MeetingExport.aspx"]')
                await links.first.wait_for(state="visible")
                hrefs = await links.evaluate_all("elements => elements.map(element => element.href)")
                urls = extract_meeting_downloads(hrefs, datetime.now(NEW_YORK).date())
                collected = {}
                for meeting_date, url in sorted(urls.items()):
                    # Use the browser's ordinary request context and the exact
                    # rendered link. Do not forge Referer, cookies, or credentials.
                    result = await context.request.get(url, timeout=timeout_seconds * 1000)
                    if result.status != 200:
                        raise CollectionError(f"Official CSV download failed for {meeting_date.isoformat()} (HTTP {result.status})")
                    if "text/html" in result.headers.get("content-type", "").lower():
                        raise CollectionError(f"Official CSV download returned an HTML error for {meeting_date.isoformat()}")
                    body = await result.body()
                    if len(body) > MAX_CSV_BYTES:
                        raise CollectionError(f"Official CSV exceeds the allowed size for {meeting_date.isoformat()}")
                    collected[meeting_date] = body
                    await result.dispose()
                return collected
            finally:
                await browser.close()

    try:
        return await asyncio.wait_for(fetch(), timeout=timeout_seconds)
    except CollectionError:
        raise
    except asyncio.TimeoutError:
        raise CollectionError("Timed out loading official CME probability downloads") from None
    except Exception as error:
        # Playwright exceptions may contain the entire session-bearing URL.
        # Only expose the exception class, never its raw message or traceback.
        detail = re.sub(r"https?://\S+", "[official address]", str(error))
        detail = re.sub(r"(?i)(insid|qsid)=[^\s&]+", r"\1=[redacted]", detail)
        raise CollectionError(f"Official browser collection failed ({type(error).__name__}): {detail[:500]}") from None


def atomic_write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
            temporary_path = stream.name
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            Path(temporary_path).unlink(missing_ok=True)


Downloader = Callable[[float], Awaitable[Mapping[date, Union[bytes, str]]]]


async def update_files(output_dir: Path, timeout_seconds: float = 120, *,
                       downloader: Downloader | None = None,
                       now: datetime | None = None) -> int:
    attempted_at = now or datetime.now(timezone.utc)
    try:
        downloads = await (downloader or fetch_official_csvs)(timeout_seconds)
        payload = build_payload(downloads, now or datetime.now(timezone.utc))
        previous_path = output_dir / "latest.json"
        if previous_path.exists():
            try:
                previous = json.loads(previous_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                previous = {}
            if isinstance(previous, dict) and previous.get("schema_version") == 1:
                old_dates = {item["meeting_date"]: item["as_of"]
                             for item in previous.get("meetings", [])
                             if isinstance(item, dict) and isinstance(item.get("meeting_date"), str)
                             and isinstance(item.get("as_of"), str)}
                if any(item["as_of"] < old_dates.get(item["meeting_date"], "")
                       for item in payload["meetings"]):
                    raise CollectionError("Official history is older than the last successful snapshot; keeping the newer data")
        # Nothing touches latest.json until every discovered meeting validates.
        atomic_write_json(output_dir / "latest.json", payload)
        atomic_write_json(output_dir / "status.json", {
            "state": "ok", "last_attempt_at": utc_timestamp(attempted_at),
            "message": f"Updated {len(payload['meetings'])} official meetings; data as of {payload['data_as_of']}",
        })
        print(f"Updated {len(payload['meetings'])} official meetings; data as of {payload['data_as_of']}")
        return 0
    except Exception as error:
        message = str(error) if isinstance(error, CollectionError) else f"Update failed ({type(error).__name__})"
        try:
            atomic_write_json(output_dir / "status.json", {
                "state": "error", "last_attempt_at": utc_timestamp(attempted_at), "message": message,
            })
        except Exception:
            print("Could not write collection status", file=sys.stderr)
        print(f"FedWatch collection failed: {message}", file=sys.stderr)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--timeout", type=float, default=120, help="Total collection timeout in seconds (default: 120)")
    parser.add_argument("--headed", action="store_true", help="Use a regular browser window; on Linux run with xvfb-run")
    arguments = parser.parse_args()
    if not math.isfinite(arguments.timeout) or arguments.timeout <= 0:
        parser.error("--timeout must be a finite positive number")
    async def download(timeout):
        return await fetch_official_csvs(timeout, headless=not arguments.headed)
    return asyncio.run(update_files(arguments.output_dir, arguments.timeout, downloader=download))


if __name__ == "__main__":
    raise SystemExit(main())
