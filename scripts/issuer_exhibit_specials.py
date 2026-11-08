"""Issuer-specific readers for earnings exhibits with nonstandard tables."""

from calendar import monthrange
from datetime import date, datetime
import re
from xml.etree import ElementTree


QUARTER_NUMBERS = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4}
CITI_REPORTED_RESULTS = re.compile(
    r'\bCitigroup Inc\. today reported net (?:income|loss) for the '
    r'(first|second|third|fourth) quarter (20\d{2}) of '
    r'\(?\$-?\d[\d,]*(?:\.\d+)?\)? (?:million|billion), or '
    r'(\(?\$-?\d+\.\d{2}\)?) per diluted share, on revenues of',
    re.I,
)


def citi_exhibit_metrics(filing, filed):
    """Pair reported diluted EPS and the exact quarterly revenue in Citi's 8-K."""
    lead = ' '.join(' '.join(filing.text).replace('\u200b', '').split())
    match = CITI_REPORTED_RESULTS.search(lead[:6500])
    if not match:
        return None
    quarter = QUARTER_NUMBERS[match[1].lower()]
    year = int(match[2])
    month = quarter * 3
    end = date(year, month, monthrange(year, month)[1])
    if not 0 < (filed - end).days <= 90:
        return None

    expected_column = re.compile(rf"{quarter}Q['’]?{year % 100:02}", re.I)
    revenue = set()
    for _, table in filing.tables:
        current_quarter = False
        for row in table:
            cells = [value.replace('\u200b', '').strip() for value, _ in row]
            cells = [value for value in cells if value and value != '$']
            if len(cells) < 2:
                continue
            label, current = cells[:2]
            if re.match(r'citigroup\s*\(\$ in millions, except per share\b', label, re.I):
                current_quarter = bool(expected_column.fullmatch(current))
            elif current_quarter and label.lower() == 'total revenues, net of interest expense':
                if re.fullmatch(r'\d{1,3}(?:,\d{3})+', current):
                    revenue.add(int(current.replace(',', '')) * 1_000_000)
    if len(revenue) != 1:
        return None
    displayed_eps = match[3]
    eps = float(displayed_eps.strip('()').replace('$', ''))
    if displayed_eps.startswith('('):
        eps = -abs(eps)
    return end, f'Q{quarter} FY{year}', revenue.pop(), eps, 'USD', 'GAAP', 'share'


def berkshire_statement_name(summary):
    """Find the SEC-rendered consolidated earnings statement in FilingSummary.xml."""
    try:
        document = ElementTree.fromstring(summary)
    except ElementTree.ParseError:
        return None
    for report in document.findall('./MyReports/Report'):
        name = report.findtext('HtmlFileName') or ''
        if (report.findtext('MenuCategory') == 'Statements'
                and report.findtext('ShortName') == 'Consolidated Statements of Earnings'
                and re.fullmatch(r'R\d+\.htm', name)):
            return name
    return None


def berkshire_statement_metrics(filing, filed, end):
    """Read consolidated revenue and the reported Class B EPS in Berkshire's 10-Q."""
    if not 0 <= (filed - end).days <= 90:
        return None
    quarter = (end.month + 2) // 3
    for _, table in filing.tables:
        rows = [[cell for cell, _ in row if cell] for row in table]
        if len(rows) < 3 or rows[0][:2] != [
            'Consolidated Statements of Earnings - USD ($) $ in Millions', '3 Months Ended',
        ]:
            continue
        try:
            printed_date = rows[1][0].replace('.', '').replace('Sept ', 'Sep ')
            header_end = datetime.strptime(printed_date, '%b %d, %Y').date()
        except (IndexError, ValueError):
            continue
        if header_end != end:
            continue
        revenue = None
        in_class_b = False
        for row in rows[2:]:
            if not row:
                continue
            label = row[0]
            if label == 'Total revenues' and revenue is None and len(row) > 1:
                if re.fullmatch(r'\d{1,3}(?:,\d{3})+', row[1]):
                    revenue = int(row[1].replace(',', '')) * 1_000_000
            if label.endswith('[Member]'):
                in_class_b = label == 'Equivalent Class B [Member]'
            if in_class_b and label == 'Net earnings per average equivalent' and len(row) > 1:
                value = row[1].replace('$', '').replace(' ', '')
                if revenue is not None and re.fullmatch(r'-?\d+\.\d+|\(\d+\.\d+\)', value):
                    eps = float(value.strip('()'))
                    if value.startswith('('):
                        eps = -eps
                    return end, f'Q{quarter} FY{end.year}', revenue, eps, 'USD', 'GAAP', 'class_b'
                break
    return None
