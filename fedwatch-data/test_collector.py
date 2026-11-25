"""Validation and last-good-publication tests; no network or browser required."""

import contextlib
from datetime import date, datetime, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest

from collector import (CollectionError, build_payload, extract_meeting_downloads,
                       parse_probability_csv, update_files)


NOW = datetime(2026, 11, 25, 4, 0, tzinfo=timezone.utc)
MEETING = date(2026, 12, 9)
HEADER = "Date,(350-375),(375-400),(400-425),(425-450),(450-475)\n"
VALID_CSV = HEADER + (
    "11/13/2026,,0.000000,0.925926,0.074074,\n"
    "11/16/2026,,0.000000,0.954815,0.045185,\n"
    "11/17/2026,,0.000000,0.968889,0.031111,\n"
    "11/20/2026,,0.114074,0.885926,0.000000,\n"
    "11/23/2026,,0.000000,0.962963,0.037037,\n"
)


class CsvValidationTests(unittest.TestCase):
    def test_preserves_official_fractions_and_populated_zeros(self):
        latest = parse_probability_csv(VALID_CSV.encode("utf-8-sig"))[-1]
        self.assertEqual(latest.as_of, date(2026, 11, 23))
        self.assertEqual(latest.rates, [
            {"lower_bps": 375, "upper_bps": 400, "probability": 0.0},
            {"lower_bps": 400, "upper_bps": 425, "probability": 0.962963},
            {"lower_bps": 425, "upper_bps": 450, "probability": 0.037037},
        ])

    def test_accepts_six_decimal_rounding_without_renormalizing(self):
        parsed = parse_probability_csv("Date,(375-400),(400-425),(425-450)\n11/23/2026,0.333333,0.333333,0.333333\n")
        self.assertEqual(parsed[0].rates[0]["probability"], 0.333333)

    def test_rejects_html_error_and_empty_response(self):
        for content in ("<html>Access denied</html>", "", "Date\n"):
            with self.subTest(content=content), self.assertRaises(CollectionError):
                parse_probability_csv(content)

    def test_rejects_missing_middle_bin_even_when_total_is_one(self):
        with self.assertRaisesRegex(CollectionError, "Missing probability"):
            parse_probability_csv(HEADER + "11/23/2026,,0.1,,0.9,\n")

    def test_rejects_truncated_and_extra_cells(self):
        for row in ("11/23/2026,0.1,0.9", "11/23/2026,,0.1,0.9,0,,extra"):
            with self.subTest(row=row), self.assertRaisesRegex(CollectionError, "Incomplete"):
                parse_probability_csv(HEADER + row + "\n")

    def test_rejects_invalid_or_incomplete_probability_mass(self):
        for probabilities in ("0.1,0.2,0.3", "0,NaN,1", "0,-0.1,1.1", "0,40%,60%", ",,,"):
            with self.subTest(probabilities=probabilities), self.assertRaises(CollectionError):
                parse_probability_csv("Date,(375-400),(400-425),(425-450)\n11/23/2026," + probabilities + "\n")

    def test_rejects_bad_dates_duplicates_and_unsorted_rows(self):
        for content in (
            HEADER + "11/31/2026,,0,0.9,0.1,\n",
            HEADER + "2026-11-23,,0,0.9,0.1,\n",
            VALID_CSV + "11/23/2026,,0,0.9,0.1,\n",
            VALID_CSV + "11/14/2026,,0,0.9,0.1,\n",
        ):
            with self.subTest(content=content[-80:]), self.assertRaises(CollectionError):
                parse_probability_csv(content)

    def test_rejects_duplicated_missing_or_wrong_width_headers(self):
        for columns in ("(375-400),(375-400)", "(375-400),(425-450)", "(375-425),(425-450)"):
            with self.subTest(columns=columns), self.assertRaises(CollectionError):
                parse_probability_csv("Date," + columns + "\n11/23/2026,0.5,0.5\n")


class PayloadTests(unittest.TestCase):
    def test_builds_trading_snapshot_comparisons(self):
        meeting = build_payload({MEETING: VALID_CSV}, NOW)["meetings"][0]
        self.assertEqual(meeting["previous_day"]["as_of"], "2026-11-20")
        self.assertEqual(meeting["previous_week"]["as_of"], "2026-11-16")
        self.assertEqual(meeting["as_of"], "2026-11-23")

    def test_data_as_of_is_oldest_meeting_and_histories_can_be_short(self):
        other_csv = HEADER + "11/20/2026,,0,0.8,0.2,\n"
        payload = build_payload({date(2027, 1, 27): other_csv, MEETING: VALID_CSV}, NOW)
        self.assertEqual(payload["data_as_of"], "2026-11-20")
        self.assertEqual(payload["retrieved_at"], "2026-11-25T04:00:00Z")
        self.assertEqual(payload["meetings"][0]["meeting_date"], MEETING.isoformat())
        self.assertIsNone(payload["meetings"][1]["previous_day"])
        self.assertIsNone(payload["meetings"][1]["previous_week"])

    def test_rejects_empty_downloads_and_future_reporting_dates(self):
        for downloads in ({}, {MEETING: HEADER + "11/26/2026,,0,0.8,0.2,\n"}):
            with self.subTest(downloads=bool(downloads)), self.assertRaises(CollectionError):
                build_payload(downloads, NOW)

    def test_only_accepts_real_rendered_official_download_addresses(self):
        official = "https://cmegroup-tools.quikstrike.net/User/Export/FedWatch/MeetingExport.aspx?MeetingDate={}&insid=example&qsid=temporary"
        parsed = extract_meeting_downloads([official.format("20261028"), official.format("20261209"), official.format("20270127")], date(2026, 11, 25))
        self.assertEqual(list(parsed), [MEETING, date(2027, 1, 27)])
        for href in (official.format("20261309"), official.format("20261209").replace("cmegroup-tools.quikstrike.net", "example.com")):
            with self.subTest(href=href), self.assertRaises(CollectionError):
                extract_meeting_downloads([href], date(2026, 11, 25))


class PublicationTests(unittest.IsolatedAsyncioTestCase):
    async def test_older_official_history_cannot_replace_a_newer_snapshot(self):
        async def download(_timeout):
            return {MEETING: VALID_CSV}

        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stderr(io.StringIO()):
            directory = Path(temporary)
            newer = build_payload({MEETING: HEADER + "11/24/2026,,0,0.96,0.04,\n"}, NOW)
            previous = json.dumps(newer).encode()
            (directory / "latest.json").write_bytes(previous)
            self.assertEqual(await update_files(directory, downloader=download, now=NOW), 1)
            self.assertEqual((directory / "latest.json").read_bytes(), previous)

    async def test_success_publishes_all_valid_meetings_and_status(self):
        async def download(_timeout):
            return {MEETING: VALID_CSV, date(2027, 1, 27): VALID_CSV}

        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stdout(io.StringIO()):
            directory = Path(temporary)
            self.assertEqual(await update_files(directory, downloader=download, now=NOW), 0)
            self.assertEqual(len(json.loads((directory / "latest.json").read_text())["meetings"]), 2)
            self.assertEqual(json.loads((directory / "status.json").read_text())["state"], "ok")
            self.assertFalse(list(directory.glob(".*.tmp")))

    async def test_any_invalid_meeting_preserves_last_good_file_byte_for_byte(self):
        async def download(_timeout):
            return {MEETING: VALID_CSV, date(2027, 1, 27): "<html>error</html>"}

        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stderr(io.StringIO()):
            directory = Path(temporary)
            previous = b'{"last_good": true}\n'
            (directory / "latest.json").write_bytes(previous)
            self.assertEqual(await update_files(directory, downloader=download, now=NOW), 1)
            self.assertEqual((directory / "latest.json").read_bytes(), previous)
            self.assertEqual(json.loads((directory / "status.json").read_text())["state"], "error")

    async def test_request_failure_has_nonzero_exit_without_exposing_session_url(self):
        async def download(_timeout):
            raise RuntimeError("https://example.com/?qsid=secret-session-value")

        with tempfile.TemporaryDirectory() as temporary, contextlib.redirect_stderr(io.StringIO()) as output:
            directory = Path(temporary)
            self.assertEqual(await update_files(directory, downloader=download, now=NOW), 1)
            self.assertFalse((directory / "latest.json").exists())
            self.assertNotIn("secret-session-value", (directory / "status.json").read_text() + output.getvalue())


if __name__ == "__main__":
    unittest.main()
