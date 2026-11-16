"""Build a trailing sum from four directly disclosed diluted EPS figures."""

import math
import re
from datetime import timedelta
from decimal import Decimal
from urllib.error import HTTPError


EPS_TAG = 'EarningsPerShareDiluted'
EPS_UNIT = 'USD/shares'


def _quarter_row(sec, cik, filing, filed, dates, label, eps, source=None):
    return {
        'periodStart': dates[0].isoformat(), 'periodEnd': dates[1].isoformat(),
        'quarter': label, 'eps': eps,
        **(source or sec.cash_flow_provenance(cik, filed, filing)),
    }


def _as_filed_quarter(sec, cik, concepts, facts, filed, filing, end):
    durations = sec.exact_duration_facts(concepts, EPS_TAG, EPS_UNIT, filing)
    current = [(dates, eps) for dates, eps in durations.items()
               if dates[1] == end and 75 <= sec.inclusive_days(dates) <= 105]
    if len(current) != 1:
        return None
    dates, eps = current[0]
    labels = {sec.fiscal_label(fact) for fact in facts
              if fact.get('accn') == filing['accessionNumber'] and fact.get('form') == filing['form']
              and (fact.get('start'), fact.get('end')) == tuple(day.isoformat() for day in dates)}
    if len(labels) != 1:
        return None
    label = labels.pop()
    expected = r'Q[1-3] FY\d{4}' if filing['form'] == '10-Q' else r'Q4 FY\d{4}'
    if not label or not re.fullmatch(expected, label):
        return None
    return _quarter_row(sec, cik, filing, filed, dates, label, eps)


def _fourth_quarter_summary_eps(sec, document, end, label):
    """Read an explicit Q4 GAAP-first summary when the release also includes guidance."""
    release = sec.FilingTables(document)
    lead = sec.clean(' '.join(release.text)[:3000])
    periods = re.findall(
        r'\bfourth (?:fiscal )?quarter (?:and (?:the )?fiscal year )?ended\s+([^.;]{8,40})', lead, re.I
    )
    if re.search(r'\bpreliminary\b', lead[:600], re.I) or not any(
        end in sec.quarter_dates(period) for period in periods
    ):
        return None

    amounts = set()
    for _, rows in release.tables:
        headers = []
        for row in rows:
            cells = [cell[0] for cell in row if cell[0]]
            if not cells:
                continue
            first = cells[0]
            if re.fullmatch(r'(?:diluted earnings per (?:common )?share|earnings per (?:common )?share\s*[-–—]\s*diluted)',
                            first, re.I):
                accounting = re.findall(r'(?<![a-z])(?:non[- ]gaap|gaap|ifrs)\b', ' '.join(headers), re.I)
                first_period = next((period for cell in headers if (period := sec.press_quarter(cell))), None)
                dollars = any(re.match(r'\(?(?:(?:U\.?S\.?\s+)?dollars|USD)\b', cell, re.I) for cell in headers)
                if accounting and accounting[0].upper() == 'GAAP' and first_period == label and dollars:
                    amount = sec.first_numeric(cells[1:])
                    if amount is not None:
                        amounts.add(float(amount))
                break
            if sec.first_numeric(cells[1:]) is not None:
                continue
            headers.extend(cells)
    return next(iter(amounts)) if len(amounts) == 1 else None


def _fourth_quarter_exhibit(sec, client, cik, filings, annual_filed, start, end, label):
    # Match the fiscal 10-K's quarter end and require an explicitly quarterly
    # GAAP statement in an issuer's Item 2.02 filing.
    releases = [(filed, filing) for filed, filing in filings
                if filing['form'] == '8-K' and end < filed <= annual_filed]
    for filed, filing in sorted(releases, key=lambda item: item[0], reverse=True):
        try:
            for url in sec.filing_exhibits(client, cik, filing):
                document = client.get(url)
                result = sec.press_metrics(document, filed, 'USD', 'GAAP')
                if result and (result[0], result[1], *result[4:]) == (end, label, 'USD', 'GAAP', 'share'):
                    eps = result[3]
                else:
                    eps = _fourth_quarter_summary_eps(sec, document, end, label)
                if eps is not None:
                    source = {**sec.cash_flow_provenance(cik, filed, filing), 'sourceUrl': url}
                    return _quarter_row(sec, cik, filing, filed, (start, end), label, eps, source)
        except HTTPError as exc:
            if exc.code != 404:
                raise
    return None


def _split_during_period(sec, concepts, start, today):
    for tag, concept in concepts.items():
        name = tag.lower()
        if 'stocksplit' not in name or not ('ratio' in name or 'shares' in name):
            continue
        for amounts in concept.get('units', {}).values():
            for fact in amounts:
                end = sec.iso_date(fact.get('end'))
                filed = sec.iso_date(fact.get('filed'))
                if end and filed and start <= end <= today and filed <= today:
                    if fact.get('val') not in (None, 0) and ('ratio' not in name or fact['val'] != 1):
                        return True
    return False


def _consistent_comparatives(sec, facts, row, today):
    for fact in facts:
        if (fact.get('start'), fact.get('end')) != (row['periodStart'], row['periodEnd']):
            continue
        filed = sec.iso_date(fact.get('filed'))
        if filed and filed <= today and fact.get('form') in ('10-K', '10-Q', '10-K/A', '10-Q/A'):
            amount = fact.get('val')
            if type(amount) not in (int, float) or not math.isclose(amount, row['eps'], rel_tol=0, abs_tol=0.005001):
                return False
    return True


def latest_quarter_sum_eps(client, symbol, cik, earnings, today, *, helpers=None):
    """Return four consecutive GAAP EPS inputs for an unambiguous USD share."""
    if helpers is None:
        import sync_reported_earnings as helpers
    sec = helpers
    if not earnings or (earnings.get('currency'), earnings.get('accounting'), earnings.get('epsBasis')) != (
        'USD', 'GAAP', 'share'
    ):
        return None
    end = sec.iso_date(earnings.get('periodEnd'))
    if not end or end > today:
        return None
    padded = str(cik).zfill(10)
    submissions = client.json(f'{sec.DATA}/submissions/CIK{padded}.json')
    tickers = submissions.get('tickers') or []
    exchanges = submissions.get('exchanges') or []
    if {sec.ticker_key(ticker) for ticker in tickers} != {sec.ticker_key(symbol)} or not set(exchanges) & {'NYSE', 'Nasdaq'}:
        return None
    filings = [(filed, filing) for filed, filing in sec.recent_filings(submissions, end - timedelta(days=400))
               if filed <= today and filing['form'] in ('10-Q', '10-K', '8-K')]
    by_end = {}
    for filed, filing in filings:
        report_end = sec.iso_date(filing['reportDate'])
        if filing['form'] in ('10-K', '10-Q') and report_end and 0 <= (filed - report_end).days <= 150:
            by_end.setdefault(report_end, []).append((filed, filing))
    if len(by_end.get(end, ())) != 1 or by_end[end][0][1]['form'] != '10-Q':
        return None
    concepts = client.json(f'{sec.DATA}/api/xbrl/companyfacts/CIK{padded}.json').get('facts', {}).get('us-gaap', {})
    facts = concepts.get(EPS_TAG, {}).get('units', {}).get(EPS_UNIT, [])
    if not facts or _split_during_period(sec, concepts, end - timedelta(days=370), today):
        return None

    quarters = []
    for index in range(4):
        reports = by_end.get(end, ())
        if len(reports) != 1:
            return None
        filed, filing = reports[0]
        row = _as_filed_quarter(sec, cik, concepts, facts, filed, filing, end)
        if row is None and filing['form'] == '10-K' and quarters:
            # The preceding Q3 supplies Q4's start. The following Q1 fixes
            # Q4's fiscal year even when the issuer's fiscal year straddles January.
            preceding = [day for day, reports_at_end in by_end.items()
                         if 75 <= (end - day).days <= 105 and len(reports_at_end) == 1
                         and reports_at_end[0][1]['form'] == '10-Q']
            next_label = quarters[-1]['quarter']
            if len(preceding) == 1 and next_label.startswith('Q1 FY'):
                label = f'Q4 FY{int(next_label[-4:]) - 1}'
                row = _fourth_quarter_exhibit(sec, client, cik, filings, filed,
                                               preceding[0] + timedelta(days=1), end, label)
        if not row or not _consistent_comparatives(sec, facts, row, today):
            return None
        if index == 0 and not math.isclose(row['eps'], earnings['eps'], rel_tol=0, abs_tol=0.005001):
            return None
        if quarters:
            newer = quarters[-1]
            fiscal_sequence = lambda quarter: int(quarter['quarter'][1]) + int(quarter['quarter'][-4:]) * 4
            if fiscal_sequence(newer) - fiscal_sequence(row) != 1 or newer['reportDate'] <= row['reportDate']:
                return None
        quarters.append(row)
        end = sec.iso_date(row['periodStart']) - timedelta(days=1)

    newest, oldest = quarters[0], quarters[-1]
    window = (sec.iso_date(oldest['periodStart']), sec.iso_date(newest['periodEnd']))
    if not 345 <= sec.inclusive_days(window) <= 385:
        return None
    source_fields = ('reportDate', 'sourceName', 'sourceUrl')
    return {
        'symbol': symbol, 'currency': 'USD', 'epsBasis': 'share', 'accounting': 'GAAP',
        'method': 'sum_reported_quarters',
        'eps': float(sum(Decimal(str(row['eps'])) for row in quarters)),
        'periodStart': oldest['periodStart'], 'periodEnd': newest['periodEnd'],
        **{field: newest[field] for field in source_fields},
        'supportingSources': [{field: row[field] for field in source_fields} for row in quarters[1:]],
        'quarters': quarters,
    }
