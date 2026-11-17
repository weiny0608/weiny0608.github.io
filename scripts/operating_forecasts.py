"""Project sales and free cash flow using comparable SEC financial statements."""

from datetime import date, timedelta
from math import isclose, isfinite
from statistics import median


def amount_history(series):
    return [
        {'periodStart': start.isoformat(), 'periodEnd': end.isoformat(), 'value': value}
        for (start, end), value in series
    ]


def trailing_revenue(client, cik, concepts, tag, currency, annual, latest_end, latest_revenue, today):
    """Bridge the latest interim sales using comparative figures from the same 10-Q."""
    from sync_reported_earnings import DATA, cash_flow_provenance, exact_duration_facts, iso_date, recent_filings

    (start, end), value = annual
    next_start = end + timedelta(days=1)
    if not 75 <= (latest_end - next_start).days + 1 <= 300 or not isinstance(latest_revenue, (int, float)):
        return None
    submissions = client.json(f'{DATA}/submissions/CIK{str(cik).zfill(10)}.json')
    filings = [(filed, filing) for filed, filing in recent_filings(submissions, latest_end)
               if filed <= today and filing['form'] == '10-Q' and iso_date(filing['reportDate']) == latest_end]
    for filed, filing in sorted(filings, key=lambda entry: entry[0], reverse=True):
        facts = exact_duration_facts(concepts, tag, currency, filing)
        standalone = {amount for (first, last), amount in facts.items()
                      if first >= next_start and last == latest_end and 75 <= (last - first).days + 1 <= 119}
        if len(standalone) != 1 or not isclose(next(iter(standalone)), latest_revenue, rel_tol=0.001):
            continue
        current = facts.get((next_start, latest_end))
        prior = [previous for (first, last), previous in facts.items()
                 if first == start and last < end and abs((last - first).days - (latest_end - next_start).days) <= 7]
        if current is None or len(prior) != 1 or min(current, prior[0]) <= 0:
            continue
        total = value + current - prior[0]
        if total > 0:
            return total, cash_flow_provenance(cik, filed, filing)
    return None


def revenue_projection(sales, base_year, latest_end, today, provenance, currency, accounting, trailing=None):
    annual_end = sales[0][0][1]
    growth = [new[1] / old[1] - 1 for new, old in zip(sales, sales[1:])]
    base = sales[0][1]
    sources = []
    if trailing and latest_end > annual_end:
        base, sources = trailing
        growth.append((base / sales[0][1]) ** (365.2425 / (latest_end - annual_end).days) - 1)
    base_end = latest_end if sources else annual_end
    rate = max(-0.20, min(0.30, median(growth)))
    elapsed = (base_end - annual_end).days / 365.2425
    return {
        'currency': currency, 'accounting': accounting, 'periodEnd': latest_end.isoformat(),
        'baseFiscalYear': base_year, 'basePeriodEnd': base_end.isoformat(),
        'basePeriodType': 'ttm' if sources else 'annual', **provenance,
        'supportingSources': sources, 'baseValue': base, 'growthRate': rate,
        'method': 'annual_revenue_growth', 'history': amount_history(sales),
        'years': {str(year): round(base * (1 + rate) ** (year - base_year - elapsed))
                  for year in range(today.year + 1, today.year + 4)},
    }


def fcf_projection(revenue, history, basis, cash_flow=None):
    margins = [row['value'] / row['revenue'] for row in history]
    context_keys = ('currency', 'accounting', 'periodEnd', 'baseFiscalYear', 'sourceName', 'sourceUrl', 'reportDate')
    context = {key: revenue[key] for key in context_keys}
    context.update(basePeriodEnd=history[0]['periodEnd'], basePeriodType='annual', baseValue=history[0]['value'])
    if cash_flow:
        context.update(basePeriodEnd=revenue['basePeriodEnd'], basePeriodType='ttm', baseValue=cash_flow['value'])
        context['supportingSources'] = [*revenue['supportingSources'],
                                        {key: cash_flow[key] for key in ('sourceUrl', 'sourceName', 'reportDate')}]
        margins.append(cash_flow['value'] / revenue['baseValue'])
    margin = median(margins)
    return {**context, 'capexBasis': basis, 'margin': margin, 'method': 'annual_fcf_margin', 'history': history,
            'years': {year: round(value * margin) for year, value in revenue['years'].items()}}


def latest_tsm_operating_forecasts(client, cik, latest_end, trailing_eps, today):
    from issuer_earnings import tsm_exhibit_metrics
    from tsm_operating import tsm_annual_operating

    annual = tsm_annual_operating(client, cik, today)
    if not annual:
        return {}
    history = annual['history']
    sales = [((date.fromisoformat(row['periodStart']), date.fromisoformat(row['periodEnd'])), row['revenue']) for row in history]
    annual_end = sales[0][0][1]
    if not 0 <= (latest_end - annual_end).days <= 385:
        return {}
    trailing = None
    quarters = (trailing_eps or {}).get('quarters', [])
    if latest_end > annual_end and len(quarters) == 4 and quarters[0]['periodEnd'] == latest_end.isoformat():
        values, sources = [], []
        for quarter in quarters:
            parsed = tsm_exhibit_metrics(client.get(quarter['sourceUrl']), date.fromisoformat(quarter['reportDate']))
            if not parsed or parsed[0].isoformat() != quarter['periodEnd'] or parsed[4] != 'TWD' or parsed[2] <= 0:
                break
            values.append(parsed[2])
            sources.append({key: quarter[key] for key in ('sourceName', 'sourceUrl', 'reportDate')})
        if len(values) == 4:
            trailing = sum(values), sources
    provenance = {key: annual[key] for key in ('sourceName', 'sourceUrl', 'reportDate')}
    revenue = revenue_projection(sales, annual_end.year, latest_end, today, provenance, 'TWD', 'IFRS', trailing)
    return {'revenue': revenue, 'fcf': fcf_projection(revenue, history, 'ppe')}


def latest_operating_forecasts(client, cik, earnings, cash_flow, today, *, estimate_fcf, trailing_eps=None):
    """Estimate future fiscal-year revenue and, with comparable cash flows, FCF."""
    from forecast_issuer import annual_context_and_cik
    from sync_reported_earnings import CASH_FLOW_TAGS, DATA, REVENUE_TAGS, cash_flow_contexts, iso_date
    from valuation_forecasts import annual_facts, annual_source, fiscal_year_for_period

    latest_end = iso_date(earnings.get('periodEnd'))
    if not latest_end or not 0 <= (today - latest_end).days <= 190:
        return {}
    if earnings.get('symbol') == 'TSM':
        return latest_tsm_operating_forecasts(client, cik, latest_end, trailing_eps, today)
    annual, annual_cik, continuity = annual_context_and_cik(client, cik, today)
    if not annual:
        return {}
    concepts, filing, annual_end, filed, accounting = annual
    currency = earnings.get('currency')
    if not currency or accounting != earnings.get('accounting') or not 0 <= (latest_end - annual_end).days <= 385:
        return {}
    base_year = fiscal_year_for_period(concepts, filing, annual_end)
    years = range(today.year + 1, today.year + 4)
    if not base_year or base_year >= years.start or base_year < today.year - 2:
        return {}
    for tag in REVENUE_TAGS:
        sales = annual_facts(concepts, (tag,), currency, filing, annual_end)
        if len(sales) >= 2 and all(isfinite(value) and value > 0 for _, value in sales):
            break
    else:
        return {}

    interim = concepts
    if continuity:
        taxonomy = 'us-gaap' if accounting == 'GAAP' else 'ifrs-full'
        document = client.json(f'{DATA}/api/xbrl/companyfacts/CIK{str(cik).zfill(10)}.json')
        interim = document.get('facts', {}).get(taxonomy, {})
    trailing = trailing_revenue(client, cik, interim, tag, currency, sales[0], latest_end, earnings.get('revenue'), today)
    provenance = annual_source(annual_cik, filing, filed)
    trailing_input = (trailing[0], [trailing[1]]) if trailing else None
    revenue = revenue_projection(sales, base_year, latest_end, today, provenance, currency, accounting, trailing_input)
    result = {'revenue': revenue}
    if not estimate_fcf:
        return result

    padded = str(annual_cik).zfill(10)
    document = client.json(f'{DATA}/api/xbrl/companyfacts/CIK{padded}.json')
    contexts = cash_flow_contexts(document, filing['accessionNumber'], filing['form'], symbol=earnings.get('symbol'))
    for basis in next(tags for standard, _, tags in CASH_FLOW_TAGS.values() if standard == accounting):
        history = []
        for (start, end), sales_value in sales:
            amounts = contexts.get((start, end, currency, accounting, basis))
            if not amounts:
                break
            operating, capex = amounts
            history.append({'periodStart': start.isoformat(), 'periodEnd': end.isoformat(), 'revenue': sales_value,
                            'operatingCashFlow': operating, 'capitalExpenditure': capex, 'value': operating - capex})
        if len(history) >= 2:
            break
    else:
        return result

    aligned = trailing and cash_flow and (cash_flow.get('periodEnd'), cash_flow.get('currency'), cash_flow.get('accounting'),
                                          cash_flow.get('periodType'), cash_flow.get('capexBasis')) == (
        latest_end.isoformat(), currency, accounting, 'ttm', basis
    )
    result['fcf'] = fcf_projection(revenue, history, basis, cash_flow if aligned else None)
    if continuity:
        for metric in result.values():
            metric.setdefault('supportingSources', []).append(continuity)
    return result
