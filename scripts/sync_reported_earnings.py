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

from issuer_earnings import (
    asml_exhibit_metrics, latest_amd_trailing_eps, latest_issuer_result,
    tsm_ads_quarter, tsm_cash_flow_presentation, tsm_exhibit_metrics,
)
from issuer_exhibit_specials import berkshire_statement_metrics, berkshire_statement_name, citi_exhibit_metrics

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
TRAILING_INCOME_TAGS = (
    'NetIncomeLossAvailableToCommonStockholdersDiluted',
    'NetIncomeLossAvailableToCommonStockholdersBasic',
    'NetIncomeLoss',
)
CASH_FLOW_TAGS = {
    'us-gaap': ('GAAP', 'NetCashProvidedByUsedInOperatingActivities', {
        'ppe': 'PaymentsToAcquirePropertyPlantAndEquipment',
        'productive_assets': 'PaymentsToAcquireProductiveAssets',
    }),
    'ifrs-full': ('IFRS', 'CashFlowsFromUsedInOperatingActivities', {
        'ppe': 'PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities',
    }),
}
CURRENCY = re.compile(r'[A-Z]{3}')
ISO_DATE = re.compile(r'\d{4}-\d{2}-\d{2}')
MONTH_DATE = re.compile(r'\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-9]{1,2})(?:,\s*|\s+)(20[0-9]{2})\b', re.I)
ORDINALS = {'first': '1', 'second': '2', 'third': '3', 'fourth': '4'}
REVENUE_LABEL = re.compile(r'(?:(?:total|net) )?(?:net )?(?:operating )?(?:revenues?|net sales|sales)(?:,? net)?')
EPS_GROUP_LABEL = re.compile(r'(?:net )?(?:earnings|income|loss)(?:/(?:earnings|income|loss))? per (?:ordinary |common )?(share|ads)(?: \(eps\))?')
QUARTER_HEADER = re.compile(r'\b(?:three months?|1[1-6]\s+weeks?\s+ended|quarter(?:ly)?|Q[1-4])\b', re.I)
LONGER_PERIOD_HEADER = re.compile(r'\b(?:(?:six|nine|twelve) months?|(?:26|39|52|53)\s+weeks?\s+ended|(?:full|fiscal) year)\b', re.I)
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
                        # Some retailers report a 16-week fourth quarter in their annual filing.
                        max_days = 119 if fact.get('fp') in ('FY', 'Q4') else 105
                        if not (75 <= (end_date - start_date).days <= max_days and 0 <= (filed - end_date).days <= 150):
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


def cash_flow_contexts(document, accession, form):
    """Pair consolidated CFO and cash purchases of property, plant and equipment."""
    contexts = {}
    for taxonomy, (accounting, operating_tag, capital_tags) in CASH_FLOW_TAGS.items():
        concepts = document.get('facts', {}).get(taxonomy, {})
        by_period = {}
        for metric, tag in {'operatingCashFlow': operating_tag, **capital_tags}.items():
            for unit, facts in concepts.get(tag, {}).get('units', {}).items():
                if not CURRENCY.fullmatch(unit):
                    continue
                for fact in facts:
                    if fact.get('accn') != accession or fact.get('form') != form:
                        continue
                    start = iso_date(fact.get('start'))
                    end = iso_date(fact.get('end'))
                    value = fact.get('val')
                    if not start or not end or end <= start or type(value) not in (int, float):
                        continue
                    if not math.isfinite(value) or int(value) != value:
                        continue
                    # These XBRL concepts represent positive cash payments. A negative
                    # value is ambiguous; don't silently convert a refund into capex.
                    key = (start, end, unit, accounting)
                    by_period.setdefault(key, {}).setdefault(metric, set()).add(int(value))
        for key, values in by_period.items():
            operating = values.get('operatingCashFlow', set())
            if len(operating) != 1:
                continue
            for basis in capital_tags:
                if basis not in values:
                    continue
                capital = values[basis]
                if len(capital) == 1 and min(capital) >= 0:
                    contexts[(*key, basis)] = (next(iter(operating)), next(iter(capital)))
                break
    return contexts


def cash_flow_period_type(start, end, form):
    days = (end - start).days
    if form in ('10-K', '20-F', '40-F'):
        return 'annual' if 345 <= days <= 385 else None
    if 75 <= days <= 119:
        return 'quarter'
    if 160 <= days <= 300:
        return 'ytd'
    return None


def cash_flow_provenance(cik, filed, filing):
    return {
        'reportDate': filed.isoformat(),
        'sourceUrl': filing_url(cik, filing),
        'sourceName': f"SEC Form {filing['form']}",
    }


def trailing_cash_flow(current_key, current_amounts, current_contexts, annual_rows):
    """Return exact annual + current interim − comparable prior interim when available."""
    start, end, unit, accounting, basis = current_key
    annual_rows = [
        (key, amounts, source) for key, amounts, source in annual_rows
        if key[1] + timedelta(days=1) == start and key[2:] == (unit, accounting, basis)
    ]
    # Use the newest filing for the preceding completed fiscal year.
    annual_rows.sort(key=lambda item: item[2]['reportDate'], reverse=True)
    for annual_key, annual_amounts, source in annual_rows:
        prior = [
            (key, amounts) for key, amounts in current_contexts.items()
            if key[0] == annual_key[0] and key[1] < annual_key[1]
            and key[2:] == (unit, accounting, basis)
            and abs((end - start).days - (key[1] - key[0]).days) <= 7
            and 350 <= (end - key[1]).days <= 380
        ]
        if len(prior) != 1:
            continue
        prior_key, prior_amounts = prior[0]
        operating, capital = (
            annual + current - previous
            for annual, current, previous in zip(annual_amounts, current_amounts, prior_amounts)
        )
        if capital >= 0:
            return prior_key[1] + timedelta(days=1), operating, capital, source
    return None


def latest_cash_flow(client, symbol, cik, today):
    """Use the latest period with an unambiguous pair of official statement inputs."""
    padded = str(cik).zfill(10)
    submissions = client.json(f'{DATA}/submissions/CIK{padded}.json')
    if symbol == 'TSM':
        return latest_tsm_cash_flow(client, cik, submissions, today)
    filings = [
        (filed, filing) for filed, filing in recent_filings(submissions, today - timedelta(days=550))
        if filing['form'] in REPORT_FORMS and filed <= today
    ]
    if not filings:
        return None
    document = client.json(f'{DATA}/api/xbrl/companyfacts/CIK{padded}.json')
    rows = []
    annual_rows = []
    for filed, filing in filings:
        report_end = iso_date(filing['reportDate'])
        if not report_end or not 0 <= (filed - report_end).days <= 150:
            continue
        form = filing['form']
        contexts = cash_flow_contexts(document, filing['accessionNumber'], form)
        same_end = [key for key in contexts if key[1] == report_end and cash_flow_period_type(*key[:2], form)]
        if not same_end:
            continue
        # A 10-Q may include both standalone and cumulative cash flow. Keep the
        # longest same-end period, with the actual period clearly identified.
        earliest_start = min(key[0] for key in same_end)
        latest = [key for key in same_end if key[0] == earliest_start]
        if len(latest) != 1:
            continue
        key = latest[0]
        period_type = cash_flow_period_type(*key[:2], form)
        source = cash_flow_provenance(cik, filed, filing)
        rows.append((key, contexts, period_type, source))
        if period_type == 'annual':
            annual_rows.append((key, contexts[key], source))
    if not rows:
        return None
    key, contexts, period_type, source = max(
        rows, key=lambda row: (row[0][1], row[3]['reportDate'], -row[0][0].toordinal())
    )
    start, end, currency, accounting, basis = key
    operating, capital = contexts[key]
    trailing = None
    if period_type != 'annual':
        trailing = trailing_cash_flow(key, (operating, capital), contexts, annual_rows)
    record = {'symbol': symbol, **source, 'currency': currency, 'accounting': accounting, 'capexBasis': basis}
    if trailing:
        record['reportedPeriod'] = {
            'periodStart': start.isoformat(), 'periodEnd': end.isoformat(), 'periodType': period_type,
            'operatingCashFlow': operating, 'capitalExpenditure': capital, 'value': operating - capital,
        }
        start, operating, capital, annual_source = trailing
        period_type = 'ttm'
        record['supportingSources'] = [annual_source]
    return {
        **record, 'periodStart': start.isoformat(), 'periodEnd': end.isoformat(), 'periodType': period_type,
        'operatingCashFlow': operating, 'capitalExpenditure': capital, 'value': operating - capital,
    }


def exact_duration_facts(concepts, tag, unit, filing):
    """Get unique amounts tied to one submission and exact date intervals."""
    values = {}
    for fact in concepts.get(tag, {}).get('units', {}).get(unit, []):
        if fact.get('accn') != filing['accessionNumber'] or fact.get('form') != filing['form']:
            continue
        start, end = iso_date(fact.get('start')), iso_date(fact.get('end'))
        val = fact.get('val')
        if start and end and start < end and type(val) in (int, float) and math.isfinite(val):
            values.setdefault((start, end), set()).add(val)
    return {dates: next(iter(amounts)) for dates, amounts in values.items() if len(amounts) == 1}


def inclusive_days(dates):
    return (dates[1] - dates[0]).days + 1


def diluted_earnings_contexts(concepts, filing):
    """Use income numerators that reconcile to the filed diluted EPS to the cent."""
    per_share = exact_duration_facts(concepts, 'EarningsPerShareDiluted', 'USD/shares', filing)
    shares = exact_duration_facts(concepts, 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', filing)
    earnings = {}
    for tag in TRAILING_INCOME_TAGS:
        income = exact_duration_facts(concepts, tag, 'USD', filing)
        for dates in per_share.keys() & shares.keys() & income.keys():
            if (dates not in earnings and shares[dates] > 0 and income[dates] > 0
                    and abs(income[dates] / shares[dates] - per_share[dates]) <= 0.005001):
                earnings[dates] = (income[dates], shares[dates], per_share[dates], tag)
    return earnings


def has_noncomparable_earnings(concepts, first_date, last_date, accessions):
    """Discontinue a bridge when structured tags identify a split or discontinued operations."""
    for tag, concept in concepts.items():
        normalized = tag.lower()
        split = 'stocksplit' in normalized and ('ratio' in normalized or 'shares' in normalized)
        discontinued = 'discontinuedoperations' in normalized and (
            normalized.startswith(('incomeloss', 'earningsper', 'profitloss'))
        )
        if not (split or discontinued):
            continue
        for facts in concept.get('units', {}).values():
            for fact in facts:
                if fact.get('accn') not in accessions:
                    continue
                end = iso_date(fact.get('end'))
                if end and first_date <= end <= last_date and fact.get('val') not in (None, 0):
                    if not split or 'ratio' not in normalized or fact['val'] != 1:
                        return True
    return False


def latest_trailing_eps(client, symbol, cik, earnings, today):
    """Read as-filed annual EPS or derive a comparable US GAAP rolling estimate."""
    if not earnings or (earnings.get('currency'), earnings.get('accounting'), earnings.get('epsBasis')) != (
        'USD', 'GAAP', 'share'
    ):
        return None
    end = iso_date(earnings.get('periodEnd'))
    if not end:
        return None
    padded = str(cik).zfill(10)
    submissions = client.json(f'{DATA}/submissions/CIK{padded}.json')
    tickers = submissions.get('tickers') or []
    exchanges = submissions.get('exchanges') or []
    # SEC Company Facts is entity-wide. Don't attach it to an unverified share class.
    if {ticker_key(ticker) for ticker in tickers} != {ticker_key(symbol)} or not set(exchanges) & {'Nasdaq', 'NYSE'}:
        return None
    filings = sorted(
        [(filed, filing) for filed, filing in recent_filings(submissions, today - timedelta(days=560))
         if filed <= today and filing['form'] in ('10-K', '10-Q')],
        key=lambda item: item[0], reverse=True,
    )
    newest = next(((filed, filing) for filed, filing in filings if iso_date(filing['reportDate']) == end), None)
    if not newest:
        return None
    filed, filing = newest
    concepts = client.json(f'{DATA}/api/xbrl/companyfacts/CIK{padded}.json').get('facts', {}).get('us-gaap', {})
    source = cash_flow_provenance(cik, filed, filing)
    record = {'symbol': symbol, 'currency': 'USD', 'epsBasis': 'share', 'accounting': 'GAAP',
              'periodEnd': end.isoformat(), **source}

    if filing['form'] == '10-K':
        values = [(dates, eps) for dates, eps in exact_duration_facts(
            concepts, 'EarningsPerShareDiluted', 'USD/shares', filing
        ).items() if dates[1] == end and 345 <= inclusive_days(dates) <= 385]
        if len(values) == 1:
            dates, eps = values[0]
            return {**record, 'periodStart': dates[0].isoformat(), 'eps': eps, 'method': 'reported_annual'}
        return None

    quarterly = exact_duration_facts(concepts, 'EarningsPerShareDiluted', 'USD/shares', filing)
    current_quarter = [eps for dates, eps in quarterly.items() if dates[1] == end and 75 <= inclusive_days(dates) <= 119]
    if len(current_quarter) != 1 or not math.isclose(current_quarter[0], earnings['eps'], rel_tol=0, abs_tol=0.005001):
        return None
    current_contexts = diluted_earnings_contexts(concepts, filing)
    current_periods = [dates for dates in current_contexts if dates[1] == end and 75 <= inclusive_days(dates) <= 300]
    if not current_periods:
        return None
    current_dates = min(current_periods)
    current_income, current_shares, _, income_tag = current_contexts[current_dates]
    annual = next(((date_filed, report) for date_filed, report in filings
                   if report['form'] == '10-K'
                   and iso_date(report['reportDate']) == current_dates[0] - timedelta(days=1)), None)
    if not annual:
        return None
    annual_filed, annual_filing = annual
    annual_end = iso_date(annual_filing['reportDate'])
    annual_contexts = diluted_earnings_contexts(concepts, annual_filing)
    annual_dates = [dates for dates in annual_contexts if dates[1] == annual_end and 345 <= inclusive_days(dates) <= 385]
    if len(annual_dates) != 1:
        return None
    annual_dates = annual_dates[0]
    comparative = [dates for dates in current_contexts
                   if dates[0] == annual_dates[0] and dates[1] < annual_end
                   and abs(inclusive_days(dates) - inclusive_days(current_dates)) <= 7
                   and 345 <= (end - dates[1]).days <= 385]
    if len(comparative) != 1:
        return None
    prior_dates = comparative[0]
    prior = next(((date_filed, report) for date_filed, report in filings
                  if report['form'] == '10-Q' and iso_date(report['reportDate']) == prior_dates[1]), None)
    if not prior:
        return None
    prior_filed, prior_filing = prior
    # Comparing the restated column against its original submission catches a split
    # or other revision that would make the share counts incompatible with the bridge.
    prior_as_filed = diluted_earnings_contexts(concepts, prior_filing).get(prior_dates)
    if prior_as_filed != current_contexts[prior_dates]:
        return None
    prior_income, prior_shares, _, prior_tag = prior_as_filed
    annual_income, annual_shares, _, annual_tag = annual_contexts[annual_dates]
    if len({income_tag, prior_tag, annual_tag}) != 1 or annual_income <= prior_income:
        return None
    rolling_start = prior_dates[1] + timedelta(days=1)
    accessions = {item['accessionNumber'] for _, item in filings
                  if (iso_date(item['reportDate']) or date.min) >= prior_dates[1]}
    if has_noncomparable_earnings(concepts, prior_dates[0], end, accessions):
        return None

    total_income = annual_income + current_income - prior_income
    share_days = (annual_shares * inclusive_days(annual_dates)
                  + current_shares * inclusive_days(current_dates)
                  - prior_shares * inclusive_days(prior_dates))
    rolling_shares = share_days / inclusive_days((rolling_start, end))
    if not min(annual_shares, current_shares, prior_shares) * 0.80 <= rolling_shares <= max(
        annual_shares, current_shares, prior_shares
    ) * 1.20:
        return None
    return {
        **record, 'periodStart': rolling_start.isoformat(), 'eps': round(total_income / rolling_shares, 4),
        'method': 'calculated_ttm', 'netIncome': total_income, 'weightedShares': round(rolling_shares),
        'supportingSources': [cash_flow_provenance(cik, annual_filed, annual_filing),
                              cash_flow_provenance(cik, prior_filed, prior_filing)],
    }


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


def filing_exhibits(client, cik, filing):
    directory = archive_dir(cik, filing['accessionNumber'])
    index_url = directory + filing['accessionNumber'] + '-index.html'
    try:
        index = client.get(index_url)
    except HTTPError as exc:
        if exc.code != 404:
            raise
        index = client.get(index_url.removesuffix('l'))
    return exhibit_urls(cik, filing, index)


def latest_tsm_ads_eps(client, cik, earnings, today):
    """Sum the USD diluted EPS per ADS printed in four TSMC 6-K exhibits."""
    if not earnings or (earnings.get('currency'), earnings.get('accounting'), earnings.get('epsBasis')) != (
        'TWD', 'IFRS', 'share'
    ):
        return None
    end = iso_date(earnings.get('periodEnd'))
    if not end or end > today or (end.month, end.day) not in ((3, 31), (6, 30), (9, 30), (12, 31)):
        return None
    submissions = client.json(f'{DATA}/submissions/CIK{str(cik).zfill(10)}.json')
    if 'TSM' not in (submissions.get('tickers') or []) or 'NYSE' not in (submissions.get('exchanges') or []):
        return None
    filings = [(filed, filing) for filed, filing in recent_filings(submissions, end - timedelta(days=280))
               if filing['form'] == '6-K' and filed <= today]
    quarters = []
    for quarter_number in range(1, 5):
        candidates = sorted(
            ((filed, filing) for filed, filing in filings if 0 <= (filed - end).days <= 60),
            key=lambda item: (not re.fullmatch(r'tsm-\d{8}x6k\.htm', item[1]['primaryDocument'], re.I), item[0]),
        )
        for filed, filing in candidates:
            try:
                for url in filing_exhibits(client, cik, filing):
                    quarter = tsm_ads_quarter(client.get(url), filed)
                    if quarter and quarter['periodEnd'] == end.isoformat():
                        quarters.append({**quarter, 'reportDate': filed.isoformat(),
                                         'sourceName': '台積電法說會財報（SEC 6-K）', 'sourceUrl': url})
                        break
            except HTTPError as exc:
                if exc.code != 404:
                    raise
            if len(quarters) == quarter_number:
                break
        else:
            return None
        end = date.fromisoformat(quarters[-1]['periodStart']) - timedelta(days=1)

    newest = quarters[0]
    source_keys = ('reportDate', 'sourceName', 'sourceUrl')
    return {
        'symbol': 'TSM', 'currency': 'USD', 'epsBasis': 'ADS', 'accounting': 'IFRS',
        'method': 'sum_reported_quarters', 'eps': float(sum(Decimal(str(row['eps'])) for row in quarters)),
        'periodStart': quarters[-1]['periodStart'], 'periodEnd': newest['periodEnd'],
        **{key: newest[key] for key in source_keys},
        'supportingSources': [{key: quarter[key] for key in source_keys} for quarter in quarters[1:]],
        'quarters': quarters,
    }


def latest_tsm_cash_flow(client, cik, submissions, today):
    filings = [
        (filed, filing) for filed, filing in recent_filings(submissions, today - timedelta(days=160))
        if filing['form'] == '6-K' and filed <= today
    ]
    for filed, filing in sorted(filings, key=lambda pair: pair[0], reverse=True)[:10]:
        for url in filing_exhibits(client, cik, filing):
            metrics = tsm_cash_flow_presentation(client.get(url), filed)
            if not metrics:
                continue
            start, end, operating, capex = metrics
            return {
                'symbol': 'TSM', 'currency': 'TWD', 'accounting': 'IFRS',
                'capexBasis': 'issuer_capex', 'periodType': 'quarter',
                'periodStart': start.isoformat(), 'periodEnd': end.isoformat(), 'reportDate': filed.isoformat(),
                'value': operating - capex, 'operatingCashFlow': operating, 'capitalExpenditure': capex,
                'sourceName': '台積電財報簡報（SEC 6-K）', 'sourceUrl': url,
            }
    return None


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
    match = re.search(r'\bfiscal(?:\s+year)?\s+(20\d{2})\s+(first|second|third|fourth)\s+quarter\b', text, re.I)
    if match:
        return f'Q{ORDINALS[match[2].lower()]} FY{match[1]}'
    match = re.search(r'\bfourth quarter and (?:(?:full[- ]year\s+)?fiscal(?:\s+year)?|full[- ]year)\s+(20\d{2})\b', text, re.I)
    if match:
        return f'Q4 FY{match[1]}'
    return None


def statement_dates(headers, header):
    for index, cell in enumerate(headers):
        partial = re.fullmatch(r'three months? ended\s*([A-Za-z]+\s+\d{1,2},?)', cell, re.I)
        if partial:
            year = next((value for value in headers[index + 1:] if re.fullmatch(r'20\d{2}', value)), None)
            if year:
                return list(quarter_dates(f'{partial[1]} {year}'))
    return list(quarter_dates(header))


def press_metrics(document, filed, currency_hint=None, accounting_hint='GAAP', *, share_class=None):
    """Extract only explicitly quarter-labelled consolidated GAAP/IFRS table values."""
    filing = FilingTables(document)
    lead = clean(' '.join(filing.text)[:9000])
    if not re.search(r'\b(?:quarter|Q[1-4])\b', lead, re.I) or re.search(r'\bpreliminary\b', lead[:500], re.I):
        return None
    release_quarter = press_quarter(lead[:1000])
    for context, rows in filing.tables:
        headers = []
        revenue_rows = []
        eps_rows = []
        eps_group = None
        for cells in rows:
            values = [cell[0] for cell in cells]
            if not values or not any(values):
                continue
            label = next(value for value in values if value)
            label_index = values.index(label)
            label = re.sub(r'\s*\([$€£¥]?[kmb]\)|\s*\(\d+\)|:|\(loss\)', '', label, flags=re.I).lower()
            label = clean(label)
            number = first_numeric(values[label_index + 1:])
            if not revenue_rows and not eps_rows and (number is None or re.fullmatch(r'20\d{2}', label)):
                headers.extend(values)
            group_label = EPS_GROUP_LABEL.fullmatch(label)
            if number is None and group_label:
                eps_group = 'ADS' if group_label[1] == 'ads' else 'share'
            elif number is None and share_class and label == 'diluted earnings per share':
                eps_group = 'class'
            elif label not in ('basic', 'diluted') and not (eps_group == 'class' and label.startswith('class ')):
                eps_group = None
            if number is None:
                continue
            if REVENUE_LABEL.fullmatch(label):
                revenue_rows.append((not label.startswith('total '), number))
            per_share_row = re.search(r'per (?:diluted |ordinary |common )?(?:share|ads)|\beps\b', label)
            excluded_eps = re.search(r'\b(?:non[- ]gaap|adjusted|shares? (?:used|outstanding)|weighted[- ]average)\b', label)
            if eps_group == 'class' and label == f'class {share_class} common stock':
                eps_rows.append((number, 'share'))
            elif label == 'diluted' and eps_group in ('share', 'ADS'):
                eps_rows.append((number, eps_group))
                eps_group = None
            elif per_share_row and not excluded_eps and re.search(r'\bdiluted\b', label):
                eps_rows.append((number, 'ADS' if 'ads' in label else 'share'))
        if not revenue_rows or len(set(eps_rows)) != 1:
            continue
        header = clean(' '.join(headers))
        quarter_start = QUARTER_HEADER.search(header)
        if not quarter_start:
            continue
        # Prevent taking YTD or adjusted columns when they precede the quarterly GAAP column.
        longer_period = LONGER_PERIOD_HEADER.search(header)
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
        # In statements such as "in millions, except shares ... reflected in thousands",
        # the exception applies to the share-count rows, not to revenue.
        scale_text = re.sub(r'\bexcept\b[^()]{0,100}?\b(?:reflected|expressed|stated|shown|presented|reported) in (?:thousand|million|billion)s\b', '', context + ' ' + header, flags=re.I)
        scales = set(re.findall(r'\bin\s+(thousand|million|billion)s\b', scale_text, re.I))
        scales |= {scale.lower() for scale in re.findall(r'\brevenues?\s*\([$€£¥]([kmb])\)', ' '.join(cell[0] for row in rows for cell in row), re.I)}
        factors = {SCALE[scale.lower()] for scale in scales}
        if len(factors) != 1:
            continue
        dates = statement_dates(headers, header)
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
        header_quarter = press_quarter(header)
        if header_quarter and release_quarter and header_quarter != release_quarter:
            continue
        quarter = header_quarter or release_quarter
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


def latest_berkshire_result(client, cik, filings, existing):
    best = existing or None
    for filed, filing in filings:
        end = iso_date(filing['reportDate'])
        if filing['form'] != '10-Q' or not end:
            continue
        if best and end.isoformat() <= best['periodEnd']:
            continue
        directory = archive_dir(cik, filing['accessionNumber'])
        try:
            name = berkshire_statement_name(client.get(directory + 'FilingSummary.xml'))
            if name:
                url = directory + name
                metrics = berkshire_statement_metrics(FilingTables(client.get(url)), filed, end)
                if metrics:
                    candidate = make_result('BRK.B', filed, *metrics, url, '10-Q')
                    best = prefer_result(best, candidate)
        except (OSError, ValueError) as exc:
            print(f'BRK.B: SEC statement unavailable ({exc})', file=sys.stderr)
    return best


def latest_result(client, symbol, cik, existing, today):
    padded = str(cik).zfill(10)
    submissions = client.json(f'{DATA}/submissions/CIK{padded}.json')
    cutoff = max(today - timedelta(days=160), iso_date(existing.get('reportDate')) or date.min)
    filings = list(recent_filings(submissions, cutoff))
    if not filings:
        return existing or None
    if symbol == 'BRK.B':
        return latest_berkshire_result(client, cik, filings, existing)
    issuer_exhibit = {'ASML': asml_exhibit_metrics, 'TSM': tsm_exhibit_metrics}.get(symbol)
    facts = {}
    if not issuer_exhibit:
        try:
            facts = client.json(f'{DATA}/api/xbrl/companyfacts/CIK{padded}.json')
        except (OSError, ValueError) as exc:
            print(f'{symbol}: XBRL facts unavailable ({exc})', file=sys.stderr)
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
        try:
            currency_hint = (best_candidate or {}).get('currency') or hinted_currency or ('USD' if form == '8-K' else None)
            accounting_hint = (best_candidate or {}).get('accounting') or existing.get('accounting') or ('GAAP' if form == '8-K' else None)
            for url in filing_exhibits(client, cik, filing):
                document = client.get(url)
                if issuer_exhibit:
                    metrics = issuer_exhibit(document, filed)
                else:
                    metrics = press_metrics(document, filed, currency_hint, accounting_hint, share_class='a' if symbol == 'V' else None)
                    if not metrics and symbol == 'C' and form == '8-K':
                        metrics = citi_exhibit_metrics(FilingTables(document), filed)
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


def prefer_cash_flow(existing, candidate):
    if not existing or not candidate:
        return candidate or existing
    def rank(row):
        return row['periodEnd'], row['reportDate'], row['periodType'] == 'ttm'
    return candidate if rank(candidate) >= rank(existing) else existing


def update_feed(client, symbols, selected, previous, now):
    cik_by_ticker = load_ciks(client)
    results = {item['symbol']: item for item in previous.get('results', []) if item['symbol'] in symbols}
    cash_flows = {item['symbol']: item for item in previous.get('cashFlows', []) if item['symbol'] in symbols}
    trailing_eps = {item['symbol']: item for item in previous.get('trailingEps', []) if item['symbol'] in symbols}
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
        try:
            cash_flow = latest_cash_flow(client, symbol, cik, now.date())
        except (OSError, ValueError) as exc:
            print(f'{symbol}: cash flow facts unavailable ({exc})', file=sys.stderr)
            cash_flow = None
        if cash_flow:
            cash_flows[symbol] = prefer_cash_flow(cash_flows.get(symbol), cash_flow)
        try:
            eps = (latest_tsm_ads_eps(client, cik, results.get(symbol), now.date()) if symbol == 'TSM'
                   else latest_trailing_eps(client, symbol, cik, results.get(symbol), now.date()))
        except (OSError, ValueError) as exc:
            print(f'{symbol}: trailing EPS facts unavailable ({exc})', file=sys.stderr)
            eps = None
        if eps:
            trailing_eps[symbol] = eps
    if not completed:
        raise RuntimeError('No SEC company filings could be checked. Existing feed retained.')
    return result_feed(previous, results, symbols, now, cash_flows, trailing_eps)


def result_feed(previous, results, symbols, now, cash_flows, trailing_eps):
    # Keep a verified denominator through temporary outages while it remains current.
    trailing_eps = {symbol: row for symbol, row in trailing_eps.items()
                    if row.get('periodEnd') == results.get(symbol, {}).get('periodEnd')}
    if (results == {item['symbol']: item for item in previous.get('results', [])}
            and cash_flows == {item['symbol']: item for item in previous.get('cashFlows', [])}
            and trailing_eps == {item['symbol']: item for item in previous.get('trailingEps', [])}):
        return previous
    feed = {
        'updatedAt': now.isoformat(timespec='seconds'),
        'results': sorted(results.values(), key=lambda item: (item['reportDate'], item['symbol']), reverse=True),
        'coverage': {'total': len(symbols), 'withResults': len(results)},
    }
    if cash_flows or 'cashFlows' in previous:
        feed['cashFlows'] = [cash_flows[symbol] for symbol in sorted(cash_flows)]
    if trailing_eps or 'trailingEps' in previous:
        feed['trailingEps'] = [trailing_eps[symbol] for symbol in sorted(trailing_eps)]
    return feed


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
    cash_flows = {item['symbol']: item for item in sec_feed.get('cashFlows', []) if item['symbol'] in symbols}
    trailing_eps = {item['symbol']: item for item in sec_feed.get('trailingEps', []) if item['symbol'] in symbols}
    amd_eps = trailing_eps.get('AMD', {})
    amd_result = results.get('AMD')
    if 'AMD' in selected and amd_result and (
        amd_eps.get('periodEnd') != amd_result['periodEnd'] or amd_eps.get('method') == 'sum_reported_quarters'
    ):
        try:
            candidate = latest_amd_trailing_eps(amd_result, now.date())
            if candidate:
                trailing_eps['AMD'] = candidate
            elif amd_eps.get('method') == 'sum_reported_quarters':
                trailing_eps.pop('AMD', None)
        except (OSError, ValueError) as exc:
            print(f'AMD: issuer trailing EPS unavailable ({exc})', file=sys.stderr)
    feed = result_feed(previous, results, symbols, now, cash_flows, trailing_eps)
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
    print(f'Cash flow from official filings: {len(next_feed.get("cashFlows", []))} of {len(symbols)} dashboard companies/tickers.')
    print(f'Trailing EPS from official filings: {len(next_feed.get("trailingEps", []))} of {len(symbols)} dashboard companies/tickers.')


if __name__ == '__main__':
    main()
