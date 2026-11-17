"""Transparent EPS scenarios based on comparable diluted EPS in issuer filings."""

from datetime import date, datetime, timedelta
from math import expm1, isfinite, log, log1p
import re
from statistics import median
from xml.etree import ElementTree


ANNUAL_FORMS = {'10-K', '20-F', '40-F'}
DILUTED_TAGS = ('EarningsPerShareDiluted', 'DilutedEarningsLossPerShare')
GROWTH_FLOOR = -0.20
GROWTH_CEILING = 0.25
ALPHABET_CLASSES = {'GOOGL': 'A', 'GOOG': 'C'}
CLASS_EPS_SYMBOLS = frozenset((*ALPHABET_CLASSES, 'BRK.B', 'V'))


def latest_annual_context(client, cik, today):
    """Read the newest annual filing and its SEC Company Facts taxonomy."""
    from sync_reported_earnings import DATA, iso_date, recent_filings

    padded = str(cik).zfill(10)
    submissions = client.json(f'{DATA}/submissions/CIK{padded}.json')
    annual = []
    for filed, filing in recent_filings(submissions, today - timedelta(days=500)):
        if filing['form'] not in ANNUAL_FORMS or filed > today:
            continue
        end = iso_date(filing.get('reportDate'))
        if end and end < filed and (today - end).days <= 500:
            annual.append((end, filed, filing))
    if not annual:
        return None
    end, filed, filing = max(annual, key=lambda item: item[:2])
    facts = client.json(f'{DATA}/api/xbrl/companyfacts/CIK{padded}.json').get('facts', {})
    standards = [('us-gaap', 'GAAP')] if filing['form'] == '10-K' else [('ifrs-full', 'IFRS'), ('us-gaap', 'GAAP')]
    for taxonomy, accounting in standards:
        concepts = facts.get(taxonomy, {})
        if fiscal_year_for_period(concepts, filing, end):
            return concepts, filing, end, filed, accounting
    return None


def annual_facts(concepts, tags, unit, filing, period_end, limit=3):
    """Find a contiguous latest-year series using one tag in one filing."""
    from sync_reported_earnings import exact_duration_facts, inclusive_days

    best = []
    for tag in tags:
        facts = exact_duration_facts(concepts, tag, unit, filing)
        series = []
        end = period_end
        for _ in range(limit):
            same_end = [(dates, value) for dates, value in facts.items()
                        if dates[1] == end and 345 <= inclusive_days(dates) <= 385]
            if len(same_end) != 1:
                break
            series.append(same_end[0])
            end = same_end[0][0][0] - timedelta(days=1)
        if len(series) > len(best):
            best = series
    return best


def fiscal_year_for_period(concepts, filing, period_end):
    """Resolve the issuer's own fiscal-year label from facts in the annual filing."""
    from sync_reported_earnings import iso_date, inclusive_days

    tags = (*DILUTED_TAGS, 'NetIncomeLoss', 'ProfitLoss', 'Revenues', 'Revenue',
            'RevenueFromContractWithCustomerExcludingAssessedTax')
    years = set()
    for tag in tags:
        for facts in concepts.get(tag, {}).get('units', {}).values():
            for fact in facts:
                year = fact.get('fy')
                if (fact.get('accn') != filing['accessionNumber'] or fact.get('form') != filing['form']
                        or fact.get('fp') != 'FY' or fact.get('end') != period_end.isoformat()
                        or type(year) is not int or abs(year - period_end.year) > 1):
                    continue
                start = iso_date(fact.get('start'))
                if start and 345 <= inclusive_days((start, period_end)) <= 385:
                    years.add(year)
    return years.pop() if len(years) == 1 else None


def annual_source(cik, filing, filed):
    from sync_reported_earnings import cash_flow_provenance

    return cash_flow_provenance(cik, filed, filing)


def _split_after_report(concepts, filed, today):
    from sync_reported_earnings import iso_date

    for tag, concept in concepts.items():
        name = tag.lower()
        if 'stocksplit' not in name or ('ratio' not in name and 'shares' not in name):
            continue
        for facts in concept.get('units', {}).values():
            for fact in facts:
                split_date = iso_date(fact.get('end'))
                report_date = iso_date(fact.get('filed'))
                value = fact.get('val')
                if (split_date and report_date and filed < split_date <= today and report_date <= today
                        and value not in (None, 0) and ('ratio' not in name or value != 1)):
                    return True
    return False


def _source(row):
    return {key: row[key] for key in ('sourceUrl', 'sourceName', 'reportDate')}


def _distinct_sources(rows):
    sources = {_source(row)['sourceUrl']: _source(row) for row in rows}
    return list(sources.values())


def _history_row(dates, eps, source):
    return {'periodStart': dates[0].isoformat(), 'periodEnd': dates[1].isoformat(), 'eps': eps, **source}


def _finish_forecast(symbol, accounting, basis, end, base_year, history, today, *, trailing=None, ads=False,
                     currency='USD'):
    from sync_reported_earnings import iso_date

    annual_end = iso_date(history[0]['periodEnd'])
    base = trailing or history[0]
    base_end = iso_date(base['periodEnd'])
    base_eps = base['eps']
    pairs = list(zip(history, history[1:]))
    if trailing:
        pairs.append((trailing, history[0]))
    rates = []
    changes = []
    for newer, older in pairs:
        elapsed = (iso_date(newer['periodEnd']) - iso_date(older['periodEnd'])).days
        if not 75 <= elapsed <= 385:
            continue
        annualize = 365.25 / elapsed
        changes.append((newer['eps'] - older['eps']) * annualize)
        if newer['eps'] > 0 and older['eps'] > 0:
            # Bound annual growth before exponentiation to handle near-zero EPS.
            log_growth = (log(newer['eps']) - log(older['eps'])) * annualize
            rates.append(expm1(min(log1p(GROWTH_CEILING), max(log1p(GROWTH_FLOOR), log_growth))))
    if not changes:
        return None

    growth = len(rates) == len(changes)
    if growth:
        method = 'historical_diluted_eps_growth'
        rate = round(median(rates), 6)
        change = None
    else:
        method = 'historical_diluted_eps_change'
        rate = None
        cap = GROWTH_CEILING * median(abs(row['eps']) for row in history)
        change = round(min(cap, max(-cap, median(changes))), 6)

    years = {}
    for target in range(today.year + 1, today.year + 4):
        horizon = ((date(target, 12, 31) - base_end).days / 365.25 if ads
                   else target - base_year - (base_end - annual_end).days / 365.25)
        if 0 < horizon <= 5:
            prediction = base_eps * (1 + rate) ** horizon if growth else base_eps + change * horizon
            years[str(target)] = round(prediction, 2)
    if len(years) != 3 or not all(isfinite(value) for value in years.values()):
        return None

    sources = []
    if trailing:
        sources = [trailing, *trailing.get('supportingSources', [])]
    sources.extend(source for row in history for source in (row, *row.get('supportingSources', [])))
    return {
        'symbol': symbol, 'currency': currency, 'epsBasis': basis, 'accounting': accounting, 'method': method,
        'periodEnd': end.isoformat(), **_source(base), 'baseEps': base_eps, 'baseFiscalYear': base_year,
        'basePeriodEnd': base_end.isoformat(), 'basePeriodType': 'ttm' if ads or trailing else 'annual',
        'growthRate': rate, 'annualChange': change, 'years': years,
        'supportingSources': _distinct_sources(sources),
        'history': [{key: row[key] for key in ('periodStart', 'periodEnd', 'eps', 'sourceUrl', 'sourceName', 'reportDate')}
                    for row in history],
    }


def _annual_class_history(document, period_end, heading, member, eps_label):
    """Read one class from the SEC-rendered annual statement with its dated columns."""
    from sync_reported_earnings import FilingTables

    for _, table in FilingTables(document).tables:
        if len(table) < 3:
            continue
        title = [value for value, _ in table[0] if value]
        if len(title) != 2 or not title[0].startswith(heading) or title[1] != '12 Months Ended':
            continue
        date_labels = [value for value, _ in table[1] if value]
        try:
            ends = [datetime.strptime(value.replace('.', '').replace('Sept ', 'Sep '), '%b %d, %Y').date()
                    for value in date_labels]
        except ValueError:
            continue
        if (len(ends) < 2 or ends[0] != period_end or any((end.month, end.day) != (period_end.month, period_end.day) for end in ends)
                or any(left.year != right.year + 1 for left, right in zip(ends, ends[1:]))):
            continue
        in_member = False
        for row in table[2:]:
            label, *values = [value for value, _ in row if value] or ['']
            if label.casefold() == member.casefold():
                in_member = True
            elif label.casefold().startswith(('class ', 'equivalent class ')):
                in_member = False
            elif in_member and label == eps_label:
                parsed = [re.fullmatch(r'\$\s*(-?[0-9]+(?:\.[0-9]+)?|\([0-9]+(?:\.[0-9]+)?\))', value)
                          for value in values]
                if len(parsed) != len(ends) or not all(parsed):
                    return []
                amounts = [float(value[1].replace('(', '-').replace(')', '')) for value in parsed]
                return [((end.replace(year=end.year - 1) + timedelta(days=1), end), value)
                        for end, value in zip(ends, amounts)]
    return []


def _class_eps_history(client, symbol, cik, filing, period_end):
    from sync_reported_earnings import archive_dir

    if symbol == 'BRK.B':
        statement = 'Consolidated Statements of Earnings'
        member = 'Equivalent Class B [Member]'
        label = 'Net earnings per average equivalent'
    elif symbol == 'V':
        statement = 'Earnings Per Share - Schedule of Earnings Per Share, Basic and Diluted (Details)'
        member = 'Class A common stock'
        label = 'Earnings per share - diluted (in dollars per share)'
    else:
        statement = 'Net Income Per Share - Schedule of Earnings Per Share (Details)'
        member = f'Class {ALPHABET_CLASSES[symbol]}'
        label = 'Diluted net income per share (in dollars per share)'
    directory = archive_dir(cik, filing['accessionNumber'])
    try:
        summary = ElementTree.fromstring(client.get(directory + 'FilingSummary.xml'))
    except ElementTree.ParseError:
        return [], None
    filenames = {report.findtext('HtmlFileName') for report in summary.findall('./MyReports/Report')
                 if report.findtext('ShortName') == statement}
    if len(filenames) != 1:
        return [], None
    page = filenames.pop()
    if not page or not re.fullmatch(r'R\d+\.htm', page):
        return [], None
    url = directory + page
    return _annual_class_history(client.get(url), period_end, statement + ' - USD ($)', member, label), url


def _listing_ticker_key(symbol):
    """Normalize the spelling of an SEC or exchange preferred-stock symbol."""
    normalized = re.sub(r'[./ ]+', '-', symbol.strip().upper())
    return re.sub(r'(?<=-)PR(?=[A-Z]{1,2}$)', 'P', normalized)


def _single_common_listing(document, symbol, cik, filing):
    """Identify one common share class and classify other securities on an SEC cover."""
    from sync_reported_earnings import FilingTables

    expected_end = date.fromisoformat(filing['reportDate'])
    common_title = r'\b(?:common (?:stock|shares?)|ordinary shares?)\b'
    for _, table in FilingTables(document).tables:
        rows = [[value for value, _ in row if value] for row in table]
        values = {row[0]: row[1] for row in rows if len(row) == 2}
        try:
            end = datetime.strptime(values.get('Document Period End Date', '').replace('.', '').replace('Sept ', 'Sep '), '%b %d, %Y').date()
            filing_cik = int(values.get('Entity Central Index Key', '-1'))
        except ValueError:
            continue
        if end != expected_end or values.get('Document Type') != filing['form'] or filing_cik != int(cik):
            continue

        common = set()
        other = set()
        title = None
        for row in rows:
            if len(row) != 2:
                continue
            key, text = row
            if key == 'Title of 12(g) Security' and re.search(common_title, text, re.I):
                return None
            if key == 'Title of 12(b) Security':
                if title is not None:
                    return None
                title = text
            elif key == 'Trading Symbol':
                if title is None:
                    return None
                ticker = _listing_ticker_key(text)
                if re.match(rf'^(?:class [A-Z0-9-]+ )?{common_title}', title, re.I):
                    common.add(ticker)
                elif (re.search(r'\bpreferred stock\b', title, re.I)
                      or (not re.search(common_title, title, re.I)
                          and re.search(r'\bnotes?\b|\bETNs?\b|\bdebt securities\b', title, re.I))):
                    other.add(ticker)
                else:
                    return None
                title = None
        if title is None and common == {_listing_ticker_key(symbol)} and not common & other:
            return other
    return None


def _official_listing_sources(client, symbol, cik, listed, submissions, annual_filing, report_end, today):
    from urllib.error import HTTPError

    from sync_reported_earnings import archive_dir, iso_date, recent_filings

    recent = [(filed, filing) for filed, filing in recent_filings(submissions, report_end)
              if filed <= today and filing['form'] in ('10-K', '10-Q') and iso_date(filing['reportDate']) == report_end]
    if not recent:
        return None
    _, newest = max(recent, key=lambda item: item[0])
    covers = {filing['accessionNumber']: filing for filing in (annual_filing, newest)}
    instruments = set()
    sources = []
    for accession, filing in covers.items():
        url = archive_dir(cik, accession) + 'R1.htm'
        try:
            other = _single_common_listing(client.get(url), symbol, cik, filing)
        except HTTPError as error:
            if error.code != 404:
                raise
            return None
        if other is None:
            return None
        instruments.update(other)
        sources.append({'sourceUrl': url, 'sourceName': f"SEC Form {filing['form']}（上市股別）",
                        'reportDate': filing['filingDate']})
    extras = {_listing_ticker_key(ticker) for ticker in listed} - {_listing_ticker_key(symbol)}
    return sources if extras <= instruments else None


def _tsm_eps_forecast(client, cik, earnings, trailing, end, today):
    from sync_reported_earnings import latest_tsm_ads_eps

    if (not trailing or (trailing.get('currency'), trailing.get('accounting'), trailing.get('epsBasis'))
            != ('USD', 'IFRS', 'ADS') or trailing.get('periodEnd') != end.isoformat()):
        return None
    history = [trailing]
    for years_ago in (1, 2):
        compare_end = end.replace(year=end.year - years_ago)
        comparable = latest_tsm_ads_eps(client, cik, {**earnings, 'periodEnd': compare_end.isoformat()}, today)
        if not comparable:
            break
        history.append(comparable)
    if len(history) < 2:
        return None
    return _finish_forecast('TSM', 'IFRS', 'ADS', end, end.year, history, today, ads=True)


def latest_eps_forecast(client, symbol, cik, earnings, trailing, today):
    """Model the next three labeled years, using the quote's currency and share basis."""
    from forecast_issuer import annual_context_and_cik
    from sync_reported_earnings import DATA, iso_date, ticker_key

    if not earnings or earnings.get('symbol') != symbol:
        return None
    end = iso_date(earnings.get('periodEnd'))
    reported = iso_date(earnings.get('reportDate'))
    if not end or not reported or not end <= reported <= today or (today - end).days > 220:
        return None
    if symbol == 'TSM':
        return _tsm_eps_forecast(client, cik, earnings, trailing, end, today)
    currency = 'EUR' if symbol == 'ASML' else 'USD'
    basis = 'class_b' if symbol == 'BRK.B' else 'share'
    if earnings.get('currency') != currency or earnings.get('epsBasis') != basis:
        return None

    submissions = client.json(f'{DATA}/submissions/CIK{str(cik).zfill(10)}.json')
    listed = {ticker_key(ticker) for ticker in submissions.get('tickers') or []}
    if ticker_key(symbol) not in listed or not set(submissions.get('exchanges') or []) & {'Nasdaq', 'NYSE'}:
        return None
    class_filing = symbol in CLASS_EPS_SYMBOLS
    # Nasdaq-registered ASML shares are ordinary shares, not depositary receipts.
    expected_tickers = {'ASML', 'ASMLF'} if symbol == 'ASML' else {ticker_key(symbol)}
    if symbol == 'META' and not listed <= expected_tickers:
        return None
    annual, source_cik, continuity = annual_context_and_cik(client, cik, today)
    if not annual:
        return None
    concepts, filing, base_end, filed, accounting = annual
    if base_end > end or accounting != earnings.get('accounting') or _split_after_report(concepts, filed, today):
        return None
    listing_sources = []
    if not class_filing and not listed <= expected_tickers:
        if source_cik != cik:
            return None
        listing_sources = _official_listing_sources(client, symbol, cik, listed, submissions, filing, end, today)
        if not listing_sources:
            return None
    source = annual_source(source_cik, filing, filed)
    if class_filing:
        series, class_url = _class_eps_history(client, symbol, source_cik, filing, base_end)
        if not class_url:
            return None
        source['sourceUrl'] = class_url
    else:
        series = annual_facts(concepts, DILUTED_TAGS, f'{currency}/shares', filing, base_end)
    base_year = fiscal_year_for_period(concepts, filing, base_end)
    if len(series) < 2 or not base_year:
        return None
    history = [_history_row(dates, eps, source) for dates, eps in series]
    comparable_trailing = None
    if (trailing and not class_filing and 75 <= (end - base_end).days <= 300
            and trailing.get('periodEnd') == end.isoformat()
            and (trailing.get('currency'), trailing.get('accounting'), trailing.get('epsBasis'))
            == (currency, accounting, basis)):
        comparable_trailing = trailing
    forecast = _finish_forecast(symbol, accounting, basis, end, base_year, history, today, trailing=comparable_trailing,
                                currency=currency)
    if forecast and symbol in ALPHABET_CLASSES:
        forecast['shareClass'] = ALPHABET_CLASSES[symbol]
    if forecast and symbol == 'BRK.B':
        forecast['epsDefinition'] = 'equivalent_class_b'
    if forecast and symbol == 'V':
        forecast['shareClass'] = 'A'
    if forecast:
        forecast['supportingSources'].extend(listing_sources)
        if continuity:
            forecast['supportingSources'].append(continuity)
    return forecast
