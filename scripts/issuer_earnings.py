"""Read quarterly GAAP results from official issuer sites when available."""

from datetime import date, datetime
from decimal import Decimal
from html import unescape
import re
from urllib.request import Request, urlopen


AMD_RESULTS = "https://ir.amd.com/financial-information/financial-results"
AMD_RELEASE = re.compile(
    r'https://ir\.amd\.com/news-events/press-releases/detail/\d+/amd-reports-[a-z0-9-]+'
)


def _read(url):
    request = Request(url, headers={
        "User-Agent": "Nasdaq valuation earnings reader (https://weiny0608.github.io/nasdaq/)",
    })
    with urlopen(request, timeout=12) as response:
        return response.read().decode("utf-8")


def _amd_index_entries(document):
    sections = re.split(r'<div\b[^>]*\bclass="[^"]*\bresults-info\b[^"]*"[^>]*>', document)
    for section in sections[1:]:
        period = re.search(
            r'<h3>\s*(Q[1-4])\s+(?:&amp;\s*FY\s+)?(\d{4})\s*</h3>'
            r'\s*<div class="date">\s*(?:Quarter|Fiscal Year) Ended ([^<]+)</div>',
            section,
        )
        release = re.search(r'<a\b[^>]*\bhref="([^"]+)"[^>]*\baria-label="Earnings Release HTML ', section)
        if period and release and AMD_RELEASE.fullmatch(release[1]):
            end = datetime.strptime(period[3].strip(), "%b %d, %Y").date()
            yield period[1], period[2], end, release[1]


def _amd_result(document, entry):
    quarter, year, period_end, source_url = entry
    published = re.search(r'<time\b[^>]*\bdatetime="(\d{4}-\d{2}-\d{2})T', document)
    gaap = re.search(
        r'>\s*GAAP Quarterly Financial Results(?:\s*</[^>]+>)+\s*(<table\b.*?</table>)',
        document,
        re.IGNORECASE | re.DOTALL,
    )
    if not published or not gaap:
        raise ValueError("AMD release is missing its publication date or GAAP quarterly table")

    report_date = date.fromisoformat(published[1])
    if not period_end < report_date <= date.today():
        raise ValueError("AMD publication date does not match the reported quarter")

    values = {}
    current_quarter = re.compile(rf"^{quarter}\s*(?:['’]{year[-2:]}|{year})(?:\b|\()")
    found_header = False
    for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', gaap[1], re.IGNORECASE | re.DOTALL):
        cells = re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', row, re.IGNORECASE | re.DOTALL)
        if len(cells) >= 2:
            label, current = [unescape(re.sub(r'<[^>]*>', '', cell)).strip() for cell in cells[:2]]
            if not label and current_quarter.match(current):
                found_header = True
            values[label.casefold()] = current

    # AMD prints the current quarter in the first data column, then the prior quarters.
    if not found_header:
        raise ValueError("AMD GAAP table does not label the current quarter in the first column")

    revenue = values.get("revenue ($m)", "").replace(",", "")
    eps = values.get("diluted earnings per share", "").replace(" ", "")
    if not re.fullmatch(r"\$\d+", revenue) or not re.fullmatch(r"\$-?\d+\.\d+|\(\$\d+\.\d+\)", eps):
        raise ValueError("AMD GAAP revenue or diluted EPS format changed")
    diluted = Decimal(eps.strip("()").replace("$", ""))
    if eps.startswith("("):
        diluted = -diluted

    return {
        "symbol": "AMD",
        "reportDate": report_date.isoformat(),
        "periodEnd": period_end.isoformat(),
        "quarter": f"{quarter} FY{year}",
        "revenue": int(revenue[1:]) * 1_000_000,
        "eps": float(diluted),
        "currency": "USD",
        "accounting": "GAAP",
        "epsBasis": "share",
        "sourceUrl": source_url,
        "sourceName": "AMD Investor Relations",
    }


def latest_issuer_result(symbol):
    """Return an issuer result, or None if the symbol has no supported source."""
    if symbol != "AMD":
        return None
    entries = list(_amd_index_entries(_read(AMD_RESULTS)))
    if not entries:
        raise ValueError("AMD financial results page contains no quarterly earnings releases")
    entry = max(entries, key=lambda item: item[2])
    return _amd_result(_read(entry[3]), entry)
