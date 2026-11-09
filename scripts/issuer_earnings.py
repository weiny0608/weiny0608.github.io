"""Read quarterly results from official issuer announcements."""

from datetime import date, datetime
from decimal import Decimal
from html import unescape
import re
from urllib.request import Request, urlopen


AMD_RESULTS = "https://ir.amd.com/financial-information/financial-results"
AMD_RELEASE = re.compile(
    r'https://ir\.amd\.com/news-events/press-releases/detail/\d+/amd-reports-[a-z0-9-]+'
)
TSM_RELEASE = re.compile(
    r'TSMC \(TWSE:\s*2330,\s*NYSE:\s*TSM\) today announced '
    r'consolidated revenue of NT\$\s*(?P<revenue>\d+(?:,\d{3})*(?:\.\d+)?) billion,\s*'
    r'net (?:income|loss) of NT\$\s*[\d,.]+ billion,\s*and diluted earnings per share of '
    r'NT\$\s*(?P<eps>-?\d+\.\d+)(?:\s*\(US\$\s*-?\d+\.\d+ per ADR unit\))? '
    r'for the (?P<ordinal>first|second|third|fourth) quarter ended '
    r'(?P<end>[A-Za-z]+ \d{1,2}, 20\d{2})\.',
    re.I,
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


def tsm_exhibit_metrics(document, filed):
    """Parse the TIFRS consolidated release attached to a TSMC Form 6-K."""
    text = ' '.join(unescape(re.sub(r'<[^>]+>', ' ', document)).split())
    release = TSM_RELEASE.search(text[:2000])
    if not release or not re.search(r'\bTIFRS on a consolidated basis\b', text[release.end():release.end() + 700], re.I):
        return None
    quarter = ('first', 'second', 'third', 'fourth').index(release['ordinal'].lower()) + 1
    try:
        period_end = datetime.strptime(release['end'], '%B %d, %Y').date()
    except ValueError:
        return None
    quarter_ends = ((3, 31), (6, 30), (9, 30), (12, 31))
    if (period_end.month, period_end.day) != quarter_ends[quarter - 1] or not 0 <= (filed - period_end).days <= 150:
        return None

    revenue = Decimal(release['revenue'].replace(',', '')) * 1_000_000_000
    # Prefer the unrounded first column of the same quarter's TWD table when present.
    sales = re.search(
        rf'{period_end.year} {release["ordinal"]} quarter consolidated results:\s*'
        rf'\(Unit:\s*NT\$ million, except for EPS\)\s*{quarter}Q{period_end.year % 100:02d} Amount\b'
        r'[^:]{0,240}?\bNet sales\s+(\d+(?:,\d{3})*)(?=\s|$)',
        text[release.end():], re.I,
    )
    if sales:
        exact_revenue = Decimal(sales[1].replace(',', '')) * 1_000_000
        if abs(revenue - exact_revenue) > 5_000_000:
            return None
        revenue = exact_revenue
    return period_end, f'Q{quarter} FY{period_end.year}', int(revenue), float(release['eps']), 'TWD', 'IFRS', 'share'


def tsm_cash_flow_presentation(document, filed):
    """Read TSMC's consolidated cash-flow slide in the SEC earnings presentation."""
    text = ' '.join(unescape(re.sub(r'<[^>]+>', ' ', document)).split())
    if not re.search(r'\bTSMC\s+(?:Property|Consolidated)\b', text, re.I):
        return None
    label = re.compile(
        r'\bCash Flows\s*\*\s*Free cash flow\s*=\s*Cash from operating activities\s*'
        r'[–−—-]\s*Capital expenditures\s*\(In NT\$ billions\)\s*'
        r'(?P<quarter>[1-4])Q(?P<year>\d{2})\s+[1-4]Q\d{2}\s+[1-4]Q\d{2}\s+Beginning Balance\b',
        re.I,
    )
    number = r'(?:-?\d[\d,]*\.\d{2}|\(\d[\d,]*\.\d{2}\))'
    rows = re.compile(
        rf'\bCash from operating activities (?P<operating>{number}) {number} {number} '
        rf'Capital expenditures (?P<capital>{number}) {number} {number} '
        rf'.{{0,500}}?\bFree Cash Flow\s*\*\s*(?P<free>{number}) {number} {number}(?=\s|$)',
        re.I,
    )
    results = set()
    for heading in label.finditer(text):
        current = rows.search(text[heading.end():heading.end() + 750])
        if not current:
            continue
        year = 2000 + int(heading['year'])
        quarter = int(heading['quarter'])
        end_month, end_day = ((3, 31), (6, 30), (9, 30), (12, 31))[quarter - 1]
        end = date(year, end_month, end_day)
        if not 0 <= (filed - end).days <= 60:
            continue
        start = date(year, end_month - 2, 1)
        operating, capital, published = (
            Decimal(current[field].replace(',', '').replace('(', '-').replace(')', ''))
            for field in ('operating', 'capital', 'free')
        )
        # The slide reports outflows in parentheses and rounds to NT$0.01 billion.
        if capital > 0 or abs((operating + capital) - published) > Decimal('0.01'):
            continue
        results.add((start, end, int(operating * 1_000_000_000), int(-capital * 1_000_000_000)))
    return next(iter(results)) if len(results) == 1 else None


def asml_exhibit_metrics(document, filed):
    """Read ASML's consolidated US GAAP income-statement slide in its Form 6-K."""
    slides = [' '.join(unescape(content).split()) for content in
              re.findall(r'<font\b[^>]*>([^<]*)</font>', document, re.I)]
    title = re.search(r'\bFinancial Statements US GAAP Q([1-4]) (20\d{2})\b', ' '.join(slides[:3]), re.I)
    if not title or not any('asml financial statements' in slide.lower() for slide in slides[:5]):
        return None
    quarter, year = map(int, title.groups())
    number = r'(?:-?\d[\d,]*\.\d+|\(\d[\d,]*\.\d+\))'
    results = set()
    for slide in slides:
        header = re.match(
            r'Three months ended(?: (?P<ytd>Six months|Nine months|Twelve months|Years?) ended)? '
            r'(?P<ends>(?:[A-Za-z]{3} \d{1,2}, ){2,4})'
            r'\(Unaudited,\s*(?:€, in millions|in millions €), except per share data\) '
            r'(?P<years>(?:20\d{2} ){2,4})Net system sales\b',
            slide, re.I,
        )
        if not header or 'Summary US GAAP Consolidated Statements of Operations' not in slide:
            continue
        ends = re.findall(r'[A-Za-z]{3} \d{1,2}', header['ends'])
        years = [int(value) for value in header['years'].split()]
        expected_years = [year - 1, year] * (2 if header['ytd'] else 1)
        if years != expected_years or len(ends) != len(years):
            continue
        try:
            period_end = datetime.strptime(f'{ends[1]} {year}', '%b %d %Y').date()
        except ValueError:
            continue
        if period_end.month != quarter * 3 or not 0 <= (filed - period_end).days <= 150:
            continue
        revenue = re.search(rf'\bTotal net sales ((?:{number} )+)Total cost of sales\b', slide, re.I)
        eps = re.search(
            rf'\bDiluted net income per ordinary share ((?:{number} )+)Weighted average number\b', slide, re.I,
        )
        if not revenue or not eps:
            continue
        sales_columns, eps_columns = revenue[1].split(), eps[1].split()
        if len(sales_columns) != len(years) or len(eps_columns) != len(years):
            continue
        sales = Decimal(sales_columns[1].replace(',', '')) * 1_000_000
        diluted = Decimal(eps_columns[1].replace(',', '').replace('(', '-').replace(')', ''))
        if sales >= 0:
            results.add((period_end, f'Q{quarter} FY{year}', int(sales), float(diluted), 'EUR', 'GAAP', 'share'))
    return next(iter(results)) if len(results) == 1 else None
