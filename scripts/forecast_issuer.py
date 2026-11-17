"""Select annual filings through verified changes of SEC registrant."""

from datetime import date


def annual_context_and_cik(client, cik, today):
    from valuation_forecasts import latest_annual_context

    current = latest_annual_context(client, cik, today)
    if current or int(cik) != 2115436 or today < date(2026, 7, 1):
        return current, cik, None

    # ExxonMobil's redomiciliation exchanged one old common share for one new
    # share and retained the consolidated reporting basis (Form 10-Q, Note 1).
    predecessor = 34088
    prior = latest_annual_context(client, predecessor, today)
    if not prior or prior[2] >= date(2026, 7, 1):
        return None, cik, None
    continuity = {
        'sourceUrl': 'https://www.sec.gov/Archives/edgar/data/2115436/000211543626000020/R9.htm',
        'sourceName': 'SEC Form 10-Q（ExxonMobil 申報主體變更）',
        'reportDate': '2026-11-02',
    }
    return prior, predecessor, continuity
