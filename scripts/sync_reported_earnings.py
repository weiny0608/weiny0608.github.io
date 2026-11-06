#!/usr/bin/env python3
"""Refresh the dashboard's latest published quarterly results from SEC EDGAR."""

import argparse
import json
import math
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

from issuer_earnings import latest_issuer_result

ROOT = Path(__file__).resolve().parents[1]
TICKER_CACHE = Path(__file__).with_name('sec_ticker_ciks.json')
DATA = 'https://data.sec.gov'
SEC = 'https://www.sec.gov'
REPORT_FORMS = {'10-Q', '10-K', '20-F', '40-F'}
EARNINGS_FORMS = {'8-K', '6-K'}
REVENUE_TAGS = (
    'Revenues', 'Revenue', 'SalesRevenueNet', 'RevenueNetOfInterestExpense',
    'RevenuesNetOfInterestExpense', 'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
)
EPS_TAGS = ('EarningsPerShareDiluted', 'DilutedEarningsLossPerShare')
CURRENCY = re.compile(r'[A-Z]{3}')
ISO_DATE = re.compile(r'\d{4}-\d{2}-\d{2}')
MONTH_DATE = re.compile(r'\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-9]{1,2}),?\s+(20[0-9]{2})\b', re.I)
ORDINALS = {'first': '1', 'second': '2', 'third': '3', 'fourth': '4'}
REVENUE_LABEL = re.compile(r'(?:(?:total|net) )?(?:net )?(?:operating )?(?:revenues?|net sales|sales)(?:,? net)?')
SCALE = {'thousand': 1_000, 'million': 1_000_000, 'billion': 1_000_000_000, 'k': 1_000, 'm': 1_000_000, 'b': 1_000_000_000}


class SecClient:
    def __init__(self, user_agent):
        self.user_agent = user_agent
        self.last_request = 0.0
        self.cache = {}
        self.blocked_hosts = {}

    def get(self, url):
        if url in self.cache:
            return self.cache[url]
        host = urlsplit(url).hostname
        if host in self.blocked_hosts:
            raise self.blocked_hosts[host]
        for attempt in range(2):
            time.sleep(max(0, 0.25 - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            try:
                with urlopen(Request(url, headers={'User-Agent': self.user_agent}), timeout=20) as response:
                    payload = response.read().decode('utf-8-sig', errors='replace')
            except HTTPError as exc:
                if exc.code == 403:
                    self.blocked_hosts[host] = exc
                if attempt or exc.code not in (429, 500, 502, 503, 504):
                    raise
                retry_after = exc.headers.get('Retry-After', '')
                time.sleep(min(60, int(retry_after)) if retry_after.isdigit() else 3)
            except (TimeoutError, URLError):
                if attempt:
                    raise
                time.sleep(2)
            else:
                self.cache[url] = payload
                return payload

    def json(self, url):
        return json.loads(self.get(url))


def tracked_symbols(root):
    html = (root / 'nasdaq' / 'index.html').read_text(encoding='utf-8')
    start = re.search(r'\bconst stocks\s*=\s*', html)
    if not start:
        raise ValueError('Cannot find valuation stocks')
    stocks, _ = json.JSONDecoder().raw_decode(html[start.end():])
    calendar = json.loads((root / 'earnings_hub.json').read_text(encoding='utf-8'))
    symbols = {row['t'] for row in stocks} | calendar['earningsDates'].keys()
    if 'GOOGL' in symbols:
        symbols.add('GOOG')
    return sorted(symbols)


def ticker_key(symbol):
    return symbol.upper().replace('.', '-')


def load_ciks(client):
    try:
        tickers = client.json(f'{SEC}/files/company_tickers.json')
        if not isinstance(tickers, dict) or not tickers:
            raise ValueError('Invalid SEC ticker mapping')
        return {ticker_key(item['ticker']): item['cik_str'] for item in tickers.values()}
    except (OSError, TypeError, ValueError, KeyError) as exc:
        print(f'SEC live ticker mapping unavailable ({exc}); using verified local CIKs.', file=sys.stderr)
        cached = json.loads(TICKER_CACHE.read_text(encoding='utf-8'))['tickers']
        return {ticker_key(symbol): cik for symbol, cik in cached.items()}


def iso_date(value):
    if not isinstance(value, str) or not ISO_DATE.fullmatch(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def archive_dir(cik, accession):
    return f'{SEC}/Archives/edgar/data/{int(cik)}/{accession.replace("-", "")}/'


def filing_url(cik, filing):
    return archive_dir(cik, filing['accessionNumber']) + filing['primaryDocument']


def make_result(symbol, filed, end, quarter, revenue, eps, currency, accounting, basis, url, form):
    return {
        'symbol': symbol, 'reportDate': filed.isoformat(), 'periodEnd': end.isoformat(),
        'quarter': quarter, 'revenue': revenue, 'eps': eps, 'currency': currency,
        'accounting': accounting, 'epsBasis': basis, 'sourceUrl': url,
        'sourceName': f'SEC Form {form}',
    }


def fiscal_label(fact):
    period = fact.get('fp')
    year = fact.get('fy')
    if type(year) is int and period in ('Q1', 'Q2', 'Q3', 'Q4', 'FY'):
        return f'{"Q4" if period == "FY" else period} FY{year}'
    return None


def tagged_facts(document, accession, filed, end):
    """Match consolidated values from the same accession, quarter and currency."""
    results = []
    for taxonomy, accounting in (('us-gaap', 'GAAP'), ('ifrs-full', 'IFRS')):
        concepts = document.get('facts', {}).get(taxonomy, {})
        by_period = {}
        for metric, tags in (('revenue', REVENUE_TAGS), ('eps', EPS_TAGS)):
            for rank, tag in enumerate(tags):
                for unit, values in concepts.get(tag, {}).get('units', {}).items():
                    currency = unit if metric == 'revenue' else unit.removesuffix('/shares')
                    if not CURRENCY.fullmatch(currency) or (metric == 'eps' and unit == currency):
                        continue
                    for fact in values:
                        if fact.get('accn') != accession:
                            continue
                        start_date = iso_date(fact.get('start'))
                        end_date = iso_date(fact.get('end'))
                        value = fact.get('val')
                        if not start_date or not end_date or (end and end_date != end):
                            continue
                        if not (75 <= (end_date - start_date).days <= 105 and 0 <= (filed - end_date).days <= 150):
                            continue
                        if type(value) not in (float, int) or not math.isfinite(value) or (metric == 'revenue' and value < 0):
                            continue
                        key = (start_date, end_date, currency)
                        by_period.setdefault(key, {}).setdefault(metric, []).append((rank, value, fact))
        for (_, end_date, currency), values in by_period.items():
            if not {'revenue', 'eps'} <= values.keys():
                continue
            revenue, eps = (choose_tag(values[key]) for key in ('revenue', 'eps'))
            if revenue and eps:
                results.append((end_date, fiscal_label(eps[2]) or fiscal_label(revenue[2]), revenue[1], eps[1], currency, accounting))
    if not results:
        return None
    latest_end = max(result[0] for result in results)
    latest = [result for result in results if result[0] == latest_end]
    return latest[0] if len(latest) == 1 else None


def choose_tag(values):
    rank = min(item[0] for item in values)
    best = [item for item in values if item[0] == rank]
    return best[0] if len({item[1] for item in best}) == 1 else None


def clean(value):
    return re.sub(r'\s+', ' ', value).strip()


class FilingTables(HTMLParser):
    """Read SEC filing index links and earnings table cells using the stdlib."""

    def __init__(self, document):
        super().__init__(convert_charrefs=True)
        self.text = []
        self.tables = []
        self.table = self.row = self.cell = None
        self.table_depth = 0
        self.hidden = 0
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style', 'sup', 'ix:hidden'}:
            self.hidden += 1
        elif tag == 'table':
            self.table_depth += 1
            if self.table_depth == 1:
                self.table = (clean(' '.join(self.text)[-900:]), [])
        elif self.table_depth != 1:
            return
        elif tag == 'tr':
            self.row = []
        elif tag in {'td', 'th'} and self.row is not None:
            self.cell = ([], [])
        elif tag == 'a' and self.cell is not None:
            href = dict(attrs).get('href')
            if href:
                self.cell[1].append(href)

    def handle_endtag(self, tag):
        if tag in {'script', 'style', 'sup', 'ix:hidden'}:
            self.hidden = max(0, self.hidden - 1)
        elif tag == 'table' and self.table_depth:
            self.table_depth -= 1
            if not self.table_depth:
                self.tables.append(self.table)
                self.table = self.row = self.cell = None
        elif self.table_depth != 1:
            return
        elif tag in {'td', 'th'} and self.cell is not None and self.row is not None:
            self.row.append((clean(''.join(self.cell[0])), self.cell[1]))
            self.cell = None
        elif tag == 'tr' and self.row is not None and self.table is not None:
            self.table[1].append(self.row)
            self.row = self.cell = None

    def handle_data(self, data):
        if self.hidden:
            return
        self.text.append(data)
        if self.cell is not None and self.table_depth == 1:
            self.cell[0].append(data)


def exhibit_urls(cik, filing, index):
    directory = archive_dir(cik, filing['accessionNumber'])
    preferred, other = [], []
    for _, rows in FilingTables(index).tables:
        for row in rows:
            values = [cell[0] for cell in row]
            if not any(re.fullmatch(r'EX-99(?:\.\d+)?', value, re.I) for value in values):
                continue
            description = ' '.join(values).lower()
            for _, links in row:
                for link in links:
                    url = urljoin(directory, link)
                    if url.startswith(directory) and urlsplit(url).path.endswith(('.htm', '.html')):
                        group = preferred if re.search(r'press release|earnings|shareholder letter|financial statements', description) else other
                        group.append(url)
    return list(dict.fromkeys(preferred + other))[:3]


def first_numeric(values):
    """Get the first financial value, including table cells split around '$' or parentheses."""
    for pos, value in enumerate(values):
        value = value.strip().replace('−', '-')
        numeric = re.fullmatch(r'\(?\s*[$€£¥]?\s*(-?\d[\d,]*(?:\.\d+)?)\s*\)?', value)
        if numeric:
            previous = [entry.strip() for entry in values[:pos] if entry.strip()]
            if any(entry not in ('$', '€', '£', '¥', '(') for entry in previous):
                return None
            number = Decimal(numeric[1].replace(',', ''))
            return -abs(number) if value.startswith('(') or '(' in previous else number
        if value in ('—', '–', '-'):
            return None
    return None


def quarter_dates(text):
    for month, day, year in MONTH_DATE.findall(text):
        try:
            yield datetime.strptime(f'{month} {day} {year}', '%B %d %Y').date()
        except ValueError:
            continue


def press_quarter(text):
    match = re.search(r'\bQ([1-4])\b\s*(?:FY(?:E)?\s*|Fiscal\s*)?[\'’]?\s*(20\d{2}|\d{2})\b', text, re.I)
    if match:
        return f'Q{match[1]} FY{int(match[2]) + (2000 if len(match[2]) == 2 else 0)}'
    match = re.search(r'\b(first|second|third|fourth)\s+quarter\b(?:\s+of)?\s+(?:(?:fiscal(?:\s+year)?|FY)\s+)?(20\d{2})\b', text, re.I)
    if match:
        return f'Q{ORDINALS[match[1].lower()]} FY{match[2]}'
    return None


def press_metrics(document, filed, currency_hint=None, accounting_hint='GAAP'):
    """Extract only explicitly quarter-labelled consolidated GAAP/IFRS table values."""
    filing = FilingTables(document)
    lead = clean(' '.join(filing.text)[:9000])
    if not re.search(r'\b(?:quarter|Q[1-4])\b', lead, re.I) or re.search(r'\bpreliminary\b', lead[:500], re.I):
        return None
    for context, rows in filing.tables:
        headers = []
        revenue_rows = []
        eps_rows = []
        eps_group = False
        for cells in rows:
            values = [cell[0] for cell in cells]
            if not values or not any(values):
                continue
            label = next(value for value in values if value)
            label_index = values.index(label)
            label = re.sub(r'\s*\([$€£¥]?[kmb]\)|\s*\(\d+\)|:|\(loss\)', '', label, flags=re.I).lower()
            label = clean(label)
            number = first_numeric(values[label_index + 1:])
            if number is None and not revenue_rows and not eps_rows:
                headers.extend(values)
            if number is None and re.search(r'(?:earnings|income|loss) per (?:ordinary |common )?(?:share|ads)', label):
                eps_group = True
            if number is None:
                continue
            if REVENUE_LABEL.fullmatch(label):
                revenue_rows.append((not label.startswith('total '), number))
            diluted_row = eps_group and label == 'diluted'
            per_share_row = re.search(r'per (?:diluted |ordinary |common )?(?:share|ads)|\beps\b', label)
            if re.search(r'\bdiluted\b', label) and (diluted_row or per_share_row):
                eps_rows.append((number, 'ADS' if 'ads' in label else 'share'))
        if not revenue_rows or len(set(eps_rows)) != 1:
            continue
        header = clean(' '.join(headers))
        if not re.search(r'\b(?:three months?|quarter(?:ly)?|Q[1-4])\b', header, re.I):
            continue
        # Prevent taking YTD or adjusted columns when they precede the quarterly GAAP column.
        longer_period = re.search(r'\b(?:(?:six|nine|twelve) months?|(?:full|fiscal) year)\b', header, re.I)
        quarter_start = re.search(r'\b(?:three months?|quarter(?:ly)?|Q[1-4])\b', header, re.I)
        accounting_labels = re.findall(r'(?<![a-z])(?:non[- ]gaap|gaap|ifrs)\b', header, re.I)
        headings = re.findall(r'(?<![a-z])(non[- ]gaap|gaap|ifrs)\s+quarterly financial results\b', context, re.I)
        if not accounting_labels and headings:
            accounting_labels = headings[-1:]
        statement = re.search(r'\bconsolidated (?:statements? of (?:operations|income|earnings|profit)|income statements?)\b', context + ' ' + header, re.I)
        explicit_gaap = accounting_labels and accounting_labels[0].lower() in ('gaap', 'ifrs')
        if longer_period and longer_period.start() < quarter_start.start():
            continue
        if not explicit_gaap and (not statement or accounting_labels):
            continue
        if re.search(r'\b(?:non[- ]gaap|adjusted)\b', context, re.I) and not explicit_gaap:
            # A nearby adjusted heading cannot establish the basis for an unlabeled table.
            if not re.search(r'\bconsolidated (?:statements? of|income statements?)\b', context, re.I):
                continue
        best_rank = min(rank for rank, _ in revenue_rows)
        revenue = {value for rank, value in revenue_rows if rank == best_rank}
        if len(revenue) != 1 or min(revenue) < 0:
            continue
        scales = set(re.findall(r'\bin\s+(thousand|million|billion)s\b', context + ' ' + header, re.I))
        scales |= {scale.lower() for scale in re.findall(r'\brevenues?\s*\([$€£¥]([kmb])\)', ' '.join(cell[0] for row in rows for cell in row), re.I)}
        factors = {SCALE[scale.lower()] for scale in scales}
        if len(factors) != 1:
            continue
        dates = list(quarter_dates(header))
        if not dates:
            for match in re.finditer(r'\bended\s+([^.;]{8,40})', lead, re.I):
                dates.extend(quarter_dates(match[1]))
        if not dates or not 0 <= (filed - dates[0]).days <= 150:
            continue
        units = set(re.findall(r'\b(?:USD|EUR|GBP|CAD|JPY|TWD|CNY|CHF|KRW|AUD)\b', context + ' ' + header))
        for pattern, code in ((r'New Taiwan dollars|NT\$', 'TWD'), (r'U\.?S\.? dollars|US\$', 'USD'), (r'\beuros?\b|€', 'EUR'), (r'Japanese yen', 'JPY')):
            if re.search(pattern, context + ' ' + header, re.I):
                units.add(code)
        if len(units) > 1:
            continue
        currency = next(iter(units), None) or currency_hint
        if not currency:
            continue
        eps, basis = eps_rows[0]
        quarter = press_quarter(header) or press_quarter(lead[:1000])
        accounting = accounting_labels[0].upper() if explicit_gaap else accounting_hint
        if accounting not in ('GAAP', 'IFRS'):
            continue
        return dates[0], quarter, float(next(iter(revenue)) * factors.pop()), float(eps), currency, accounting, basis
    return None


def recent_filings(submissions, cutoff):
    recent = submissions.get('filings', {}).get('recent', {})
    columns = ('form', 'accessionNumber', 'filingDate', 'reportDate', 'primaryDocument', 'items')
    for index, _ in enumerate(recent.get('form', [])):
        filing = {column: recent[column][index] if index < len(recent.get(column, [])) else '' for column in columns}
        filed = iso_date(filing['filingDate'])
        if not filed or filed < cutoff or not filing['primaryDocument'] or not re.fullmatch(r'\d{10}-\d{2}-\d{6}', filing['accessionNumber']):
            continue
        form = filing['form']
        if form in REPORT_FORMS or form == '6-K' or form == '8-K' and '2.02' in re.split(r'[,;\s]+', filing['items']):
            yield filed, filing


def latest_result(client, symbol, cik, existing, today):
    padded = str(cik).zfill(10)
    submissions = client.json(f'{DATA}/submissions/CIK{padded}.json')
    cutoff = max(today - timedelta(days=160), iso_date(existing.get('reportDate')) or date.min)
    filings = list(recent_filings(submissions, cutoff))
    if not filings:
        return existing or None
    facts_url = f'{DATA}/api/xbrl/companyfacts/CIK{padded}.json'
    try:
        facts = client.json(facts_url)
    except (OSError, ValueError) as exc:
        print(f'{symbol}: XBRL facts unavailable ({exc})', file=sys.stderr)
        facts = {}
    best = existing or None
    hinted_currency = existing.get('currency')
    reports = []
    releases = []
    for filed, filing in filings:
        if filing['form'] in REPORT_FORMS:
            reports.append((filed, filing))
        else:
            releases.append((filed, filing))
    best_candidate = None
    for filed, filing in reports + releases:
        form = filing['form']
        report_end = iso_date(filing['reportDate']) if form in REPORT_FORMS else None
        if form in REPORT_FORMS and report_end is None:
            continue
        metrics = tagged_facts(facts, filing['accessionNumber'], filed, report_end)
        if not metrics:
            continue
        end, quarter, revenue, eps, currency, accounting = metrics
        candidate = make_result(symbol, filed, end, quarter, revenue, eps, currency, accounting, 'share', filing_url(cik, filing), form)
        best_candidate = prefer_result(best_candidate, candidate)
    # Search official exhibits for early and untagged releases and directly stated Q4 results.
    # An established filing for this period provides a safe currency hint for the exhibit.
    for filed, filing in releases[:8]:
        if existing and filed <= iso_date(existing.get('reportDate')):
            continue
        if best_candidate and filed < iso_date(best_candidate['periodEnd']):
            continue
        form = filing['form']
        directory = archive_dir(cik, filing['accessionNumber'])
        try:
            index_url = directory + filing['accessionNumber'] + '-index.html'
            try:
                index = client.get(index_url)
            except HTTPError as exc:
                if exc.code != 404:
                    raise
                index = client.get(index_url.removesuffix('l'))
            currency_hint = (best_candidate or {}).get('currency') or hinted_currency or ('USD' if form == '8-K' else None)
            accounting_hint = (best_candidate or {}).get('accounting') or existing.get('accounting') or ('GAAP' if form == '8-K' else None)
            for url in exhibit_urls(cik, filing, index):
                metrics = press_metrics(client.get(url), filed, currency_hint, accounting_hint)
                if not metrics:
                    continue
                end, quarter, revenue, eps, currency, accounting, basis = metrics
                if best_candidate and best_candidate['periodEnd'] == end.isoformat():
                    # Keep the more precise XBRL values if the release reports them rounded.
                    if (currency, accounting, basis) != tuple(best_candidate[key] for key in ('currency', 'accounting', 'epsBasis')):
                        continue
                    if not math.isclose(revenue, best_candidate['revenue'], rel_tol=0.001) or not math.isclose(eps, best_candidate['eps'], abs_tol=0.005):
                        continue
                    quarter = best_candidate['quarter'] or quarter
                    revenue, eps, accounting = (best_candidate[key] for key in ('revenue', 'eps', 'accounting'))
                candidate = make_result(symbol, filed, end, quarter, revenue, eps, currency, accounting, basis, url, form)
                best_candidate = prefer_result(best_candidate, candidate)
                break
        except (OSError, ValueError) as exc:
            print(f'{symbol}: SEC exhibit unavailable ({exc})', file=sys.stderr)
            if isinstance(exc, HTTPError) and exc.code == 403:
                break
    return prefer_result(best, best_candidate)


def prefer_result(existing, candidate):
    if not existing or not candidate:
        return candidate or existing
    if candidate['periodEnd'] > existing['periodEnd']:
        return candidate
    if candidate['periodEnd'] == existing['periodEnd'] and candidate['reportDate'] < existing['reportDate']:
        return candidate
    return existing


def update_feed(client, symbols, selected, previous, now):
    cik_by_ticker = load_ciks(client)
    results = {item['symbol']: item for item in previous.get('results', []) if item['symbol'] in symbols}
    completed = 0
    for symbol in selected:
        cik = cik_by_ticker.get(ticker_key(symbol))
        if not cik:
            print(f'{symbol}: no SEC CIK mapping', file=sys.stderr)
            continue
        try:
            result = latest_result(client, symbol, cik, results.get(symbol, {}), now.date())
        except (OSError, ValueError) as exc:
            print(f'{symbol}: SEC check failed ({exc})', file=sys.stderr)
            if isinstance(exc, HTTPError) and exc.code == 403:
                if not completed:
                    raise RuntimeError('SEC submissions refused access (HTTP 403). Existing feed retained.') from exc
                print('SEC submissions refused access; remaining company results retained.', file=sys.stderr)
                break
            continue
        completed += 1
        if result:
            results[symbol] = result
    if not completed:
        raise RuntimeError('No SEC company filings could be checked. Existing feed retained.')
    return result_feed(previous, results, symbols, now)


def result_feed(previous, results, symbols, now):
    if results == {item['symbol']: item for item in previous.get('results', [])}:
        return previous
    return {
        'updatedAt': now.isoformat(timespec='seconds'),
        'results': sorted(results.values(), key=lambda item: (item['reportDate'], item['symbol']), reverse=True),
        'coverage': {'total': len(symbols), 'withResults': len(results)},
    }


def refresh_feed(client, symbols, selected, previous, now):
    sec_error = None
    try:
        sec_feed = update_feed(client, symbols, selected, previous, now)
    except (OSError, ValueError, RuntimeError) as exc:
        sec_error = exc
        sec_feed = previous

    results = {item['symbol']: item for item in sec_feed.get('results', []) if item['symbol'] in symbols}
    issuer_checked = 0
    for symbol in selected:
        try:
            candidate = latest_issuer_result(symbol)
        except (OSError, ValueError) as exc:
            print(f'{symbol}: issuer site check failed ({exc})', file=sys.stderr)
            continue
        if candidate:
            issuer_checked += 1
            results[symbol] = prefer_result(results.get(symbol), candidate)

    if sec_error:
        if not issuer_checked:
            raise sec_error
        message = f'SEC data unavailable ({sec_error}). Checked {issuer_checked} issuer site(s); other results retained.'
        print(f'::warning::{message}' if os.environ.get('GITHUB_ACTIONS') else message, file=sys.stderr)
    feed = result_feed(previous, results, symbols, now)
    return {**feed, 'secStatus': 'unavailable' if sec_error else 'available'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--symbols', nargs='+', help='Limit an audit to these dashboard tickers')
    parser.add_argument('--output', type=Path, default=ROOT / 'reported_earnings.json')
    args = parser.parse_args()
    user_agent = os.environ.get('SEC_USER_AGENT', '')
    if not re.search(r'\S+@\S+\.\S+|https://\S+', user_agent):
        parser.error('Set SEC_USER_AGENT to a project name and monitored email address or public contact URL.')
    symbols = tracked_symbols(ROOT)
    selected = list(dict.fromkeys(symbol.upper() for symbol in (args.symbols or symbols)))
    if set(selected) - set(symbols):
        parser.error('Use dashboard ticker symbols only.')
    previous = json.loads(args.output.read_text(encoding='utf-8')) if args.output.exists() else {'results': []}
    try:
        next_feed = refresh_feed(SecClient(user_agent), symbols, selected, previous, datetime.now(timezone.utc))
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f'{exc}\n')
    if next_feed != previous:
        temp = args.output.with_suffix('.tmp')
        temp.write_text(json.dumps(next_feed, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        temp.replace(args.output)
    print(f'Confirmed quarterly results: {len(next_feed["results"])} of {len(symbols)} dashboard companies/tickers.')


if __name__ == '__main__':
    main()
