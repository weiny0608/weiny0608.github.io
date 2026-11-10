import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import sync_reported_earnings as collector
from issuer_earnings import tsm_cash_flow_presentation


class ReportedEarningsTest(unittest.TestCase):
    def test_trailing_eps_uses_latest_annual_or_verified_interim_bridge(self):
        current, annual, prior = ('0000000001-26-000003', '0000000001-26-000002', '0000000001-25-000001')
        submissions = {'tickers': ['EXAMPLE'], 'exchanges': ['NYSE'], 'filings': {'recent': {
            'form': ['10-Q', '10-K', '10-Q'],
            'filingDate': ['2026-04-20', '2026-02-20', '2025-04-20'],
            'reportDate': ['2026-03-31', '2025-12-31', '2025-03-31'],
            'accessionNumber': [current, annual, prior],
            'primaryDocument': ['interim.htm', 'annual.htm', 'comparative.htm'],
        }}}
        contexts = [
            (current, '10-Q', '2026-01-01', '2026-03-31', 3_800, 950, 4.0),
            (current, '10-Q', '2025-01-01', '2025-03-31', 2_000, 1_000, 2.0),
            (annual, '10-K', '2025-01-01', '2025-12-31', 10_000, 1_000, 10.0),
            (prior, '10-Q', '2025-01-01', '2025-03-31', 2_000, 1_000, 2.0),
        ]
        concepts = {}
        for tag, unit, field in (
            ('NetIncomeLoss', 'USD', 4),
            ('WeightedAverageNumberOfDilutedSharesOutstanding', 'shares', 5),
            ('EarningsPerShareDiluted', 'USD/shares', 6),
        ):
            concepts[tag] = {'units': {unit: [self.cash_fact(*row[:4], row[field]) for row in contexts]}}

        class Client:
            def json(self, url):
                return submissions if '/submissions/' in url else {'facts': {'us-gaap': concepts}}

        def check(end='2026-03-31', eps=4):
            latest = {'currency': 'USD', 'accounting': 'GAAP', 'epsBasis': 'share', 'periodEnd': end, 'eps': eps}
            return collector.latest_trailing_eps(Client(), 'EXAMPLE', 1, latest, date(2026, 5, 1))

        interim = check()
        self.assertEqual((interim['method'], interim['periodStart'], interim['netIncome']),
                         ('calculated_ttm', '2025-04-01', 11_800))
        self.assertAlmostEqual(interim['eps'], 11_800 * 365 / (1_000 * 365 + (950 - 1_000) * 90), places=4)
        self.assertEqual([source['sourceName'] for source in interim['supportingSources']],
                         ['SEC Form 10-K', 'SEC Form 10-Q'])
        self.assertEqual((check('2025-12-31')['method'], check('2025-12-31')['eps']), ('reported_annual', 10.0))
        self.assertIsNone(check('2026-06-30'))
        self.assertIsNone(check(eps=4.1))

        concepts['StockSplitConversionRatio1'] = {'units': {'pure': [
            {'accn': current, 'end': '2026-02-15', 'val': 2},
        ]}}
        self.assertIsNone(check())
        concepts.pop('StockSplitConversionRatio1')
        concepts['WeightedAverageNumberOfDilutedSharesOutstanding']['units']['shares'][-1]['val'] = 2_000
        self.assertIsNone(check())
        submissions['tickers'].append('OTHER')
        self.assertIsNone(check('2025-12-31'))

    def test_tsmc_cash_flow_requires_quarter_currency_and_concordant_amounts(self):
        slide = '''<p>TSMC Property Cash Flows * Free cash flow =
            Cash from operating activities &#8211; Capital expenditures (In NT$ billions)
            3Q26 2Q26 3Q25 Beginning Balance 3,134.22 3,035.64 2,364.52
            Cash from operating activities 919.77 783.36 426.83
            Capital expenditures (443.21) (496.00) (287.45)
            Ending Balance 3,621.89 3,134.22 2,470.76 Free Cash Flow * 476.56 287.36 139.38</p>'''
        filed = date(2026, 10, 15)
        self.assertEqual(tsm_cash_flow_presentation(slide, filed), (
            date(2026, 7, 1), date(2026, 9, 30), 919_770_000_000, 443_210_000_000,
        ))
        self.assertIsNone(tsm_cash_flow_presentation(slide, date(2026, 7, 16)))
        self.assertIsNone(tsm_cash_flow_presentation(slide.replace('NT$ billions', 'US$ billions'), filed))
        self.assertIsNone(tsm_cash_flow_presentation(slide.replace('476.56', '500.00'), filed))

    @staticmethod
    def cash_fact(accn, form, start, end, value):
        return {'accn': accn, 'form': form, 'start': start, 'end': end, 'val': value}

    @staticmethod
    def cash_document(operating, capex, productive=None):
        concepts = {
            'NetCashProvidedByUsedInOperatingActivities': {'units': {'USD': operating}},
            'PaymentsToAcquirePropertyPlantAndEquipment': {'units': {'USD': capex}},
        }
        if productive is not None:
            concepts['PaymentsToAcquireProductiveAssets'] = {'units': {'USD': productive}}
        return {'facts': {'us-gaap': concepts}}

    def test_cash_flow_uses_same_context_and_accepts_negative_operating_or_zero_capex(self):
        fact = self.cash_fact('one', '10-Q', '2026-06-01', '2026-08-31', -135_000_000)
        operating = [fact, fact]
        capex = [
            {**fact, 'accn': 'different-filing', 'val': 999},
            {**fact, 'start': '2026-01-01', 'val': 999},
            {**fact, 'val': 0},
        ]
        data = self.cash_document(operating, capex, [{**fact, 'val': 200_000_000}])
        key = (date(2026, 6, 1), date(2026, 8, 31), 'USD', 'GAAP', 'ppe')
        self.assertEqual(collector.cash_flow_contexts(data, 'one', '10-Q'), {key: (-135_000_000, 0)})
        # Same-priority disagreement and unexpectedly signed cash outflows are unsafe.
        for bad_capex in ([*capex, {**fact, 'val': 1}], [{**fact, 'val': -1}], []):
            with self.subTest(bad_capex=bad_capex):
                self.assertEqual(collector.cash_flow_contexts(self.cash_document(operating, bad_capex), 'one', '10-Q'), {})
        mixed_currency = self.cash_document(operating, capex)
        mixed_currency['facts']['us-gaap']['PaymentsToAcquirePropertyPlantAndEquipment']['units'] = {'EUR': capex}
        self.assertEqual(collector.cash_flow_contexts(mixed_currency, 'one', '10-Q'), {})
        productive = self.cash_document(operating, [], [{**fact, 'val': 199_000_000}])
        self.assertEqual(collector.cash_flow_contexts(productive, 'one', '10-Q'), {
            (*key[:-1], 'productive_assets'): (-135_000_000, 199_000_000),
        })

    def test_cash_flow_uses_exact_trailing_year_only_with_comparable_periods(self):
        current = '0000000001-26-000003'
        annual = '0000000001-26-000001'
        operating = [
            self.cash_fact(current, '10-Q', '2025-12-28', '2026-09-26', 28),
            self.cash_fact(current, '10-Q', '2024-12-29', '2025-09-27', 20),
            self.cash_fact(annual, '10-K', '2024-12-29', '2025-12-27', 30),
        ]
        capex = [{**fact, 'val': amount} for fact, amount in zip(operating, [9, 5, 7])]
        filings = {'filings': {'recent': {
            'form': ['10-Q', '10-K'], 'accessionNumber': [current, annual],
            'filingDate': ['2026-11-04', '2026-02-10'], 'reportDate': ['2026-09-26', '2025-12-27'],
            'primaryDocument': ['q.htm', 'k.htm'],
        }}}

        class Client:
            def __init__(self, facts):
                self.facts = facts

            def json(self, url):
                return self.facts if '/companyfacts/' in url else filings

        as_of = date(2026, 11, 9)
        row = collector.latest_cash_flow(Client(self.cash_document(operating, capex)), 'TEST', 1, as_of)
        self.assertEqual(
            (row['periodType'], row['periodStart'], row['periodEnd'], row['operatingCashFlow'], row['capitalExpenditure'], row['value']),
            ('ttm', '2025-09-28', '2026-09-26', 38, 11, 27),
        )
        self.assertEqual(row['reportedPeriod']['value'], 19)
        self.assertTrue(row['sourceUrl'].endswith('/q.htm'))
        self.assertTrue(row['supportingSources'][0]['sourceUrl'].endswith('/k.htm'))
        without_comparative = collector.latest_cash_flow(Client(self.cash_document(operating, capex[::2])), 'TEST', 1, as_of)
        self.assertEqual((without_comparative['periodType'], without_comparative['value']), ('ytd', 19))

    def test_cash_flow_feed_keeps_prior_rows_during_incomplete_check(self):
        row = {'symbol': 'AMD', 'periodEnd': '2026-09-30', 'reportDate': '2026-11-04', 'periodType': 'ttm'}
        prior = {'updatedAt': '2026-11-04T00:00:00+00:00', 'results': [], 'cashFlows': [row]}
        weaker = {**row, 'periodType': 'ytd'}
        now = datetime(2026, 11, 9, tzinfo=timezone.utc)
        self.assertIs(collector.prefer_cash_flow(row, weaker), row)
        self.assertIs(collector.result_feed(prior, {}, ['AMD'], now, {'AMD': row}, {}), prior)

    def test_verified_ciks_cover_dashboard_tickers_when_live_map_is_blocked(self):
        class Client:
            def json(self, url):
                raise HTTPError(url, 403, 'Forbidden', {}, None)

        ciks = collector.load_ciks(Client())
        self.assertEqual(set(ciks), {collector.ticker_key(symbol) for symbol in collector.tracked_symbols(collector.ROOT)})
        self.assertEqual(ciks['XOM'], 2115436)
        self.assertEqual(ciks['GOOG'], ciks['GOOGL'])

    def test_submissions_403_stops_batch_after_first_company(self):
        client = collector.SecClient('Test contact@example.com')
        attempted = []

        def blocked(request, timeout):
            url = request.full_url
            attempted.append(url)
            raise HTTPError(url, 403, 'Forbidden', {}, None)

        symbols = ['AMD', 'ARM', 'QCOM']
        now = datetime(2026, 11, 6, tzinfo=timezone.utc)
        with patch.object(collector, 'urlopen', side_effect=blocked):
            with self.assertRaisesRegex(RuntimeError, 'SEC submissions refused access.*Existing feed retained'):
                collector.update_feed(client, symbols, symbols, {'results': []}, now)
            with self.assertRaises(HTTPError):
                client.get(f'{collector.DATA}/submissions/CIK0001973239.json')
        self.assertEqual(attempted, [
            f'{collector.SEC}/files/company_tickers.json',
            f'{collector.DATA}/submissions/CIK0000002488.json',
        ])

    def test_xbrl_pairs_same_accession_period_and_currency(self):
        accession = '0000002488-26-000191'
        quarter = {'accn': accession, 'start': '2026-06-28', 'end': '2026-09-26', 'fy': 2026, 'fp': 'Q3'}
        ytd = {**quarter, 'start': '2025-12-28'}
        document = {'facts': {'us-gaap': {
            'RevenueFromContractWithCustomerExcludingAssessedTax': {'units': {'USD': [
                {**ytd, 'val': 32_000_000_000}, {**quarter, 'val': 13_377_000_000},
            ]}},
            'EarningsPerShareDiluted': {'units': {
                'USD/shares': [
                    {**ytd, 'val': 3.52}, {**quarter, 'accn': 'other', 'val': 2.09},
                    {**quarter, 'val': 1.46},
                ],
                'EUR/shares': [{**quarter, 'val': 1.17}],
            }},
        }}}
        result = collector.tagged_facts(document, accession, date(2026, 11, 4), date(2026, 9, 26))
        self.assertEqual(result, (date(2026, 9, 26), 'Q3 FY2026', 13_377_000_000, 1.46, 'USD', 'GAAP'))
        self.assertIsNone(collector.tagged_facts(document, accession, date(2026, 11, 4), date(2026, 9, 27)))

    def test_q4_release_prefers_gaap_quarter_over_fiscal_year_and_adjusted_values(self):
        report = '''<h1>Qualcomm Announces Fourth Quarter and Fiscal 2026 Results</h1>
          <p>Today announced results for its fiscal fourth quarter and year ended September 27, 2026.</p>
          <table><tr><td>GAAP</td><td>Non-GAAP</td></tr>
          <tr><td>(in millions, except per share data)</td><td>Q4 Fiscal 2026</td>
              <td>Q4 Fiscal 2025</td><td>Q4 Fiscal 2026</td></tr>
          <tr><td>Revenues</td><td>$</td><td>10,322</td><td>$11,270</td><td>$10,442</td></tr>
          <tr><td>Diluted earnings (loss) per share (EPS)</td><td>$</td><td>1.17</td><td>($2.89)</td><td>$2.17</td></tr></table>'''
        result = collector.press_metrics(report, date(2026, 11, 4), 'USD')
        self.assertEqual(result, (date(2026, 9, 27), 'Q4 FY2026', 10_322_000_000, 1.17, 'USD', 'GAAP', 'share'))
        adjusted_first = report.replace('<td>GAAP</td><td>Non-GAAP</td>', '<td>Non-GAAP</td><td>GAAP</td>')
        self.assertIsNone(collector.press_metrics(adjusted_first, date(2026, 11, 4), 'USD'))
        year_first = report.replace('Q4 Fiscal 2026</td>', 'Fiscal Year 2026</td>', 1)
        self.assertIsNone(collector.press_metrics(year_first, date(2026, 11, 4), 'USD'))

    def test_xbrl_accepts_sixteen_week_fourth_quarter_but_not_full_year(self):
        quarter = {'accn': 'costco', 'start': '2026-05-11', 'end': '2026-08-30', 'fy': 2026, 'fp': 'FY'}
        annual = {**quarter, 'start': '2025-09-01'}
        document = {'facts': {'us-gaap': {
            'Revenues': {'units': {'USD': [{**annual, 'val': 275_000_000_000}, {**quarter, 'val': 95_723_000_000}]}},
            'EarningsPerShareDiluted': {'units': {'USD/shares': [{**annual, 'val': 20.12}, {**quarter, 'val': 6.75}]}},
        }}}
        result = collector.tagged_facts(document, 'costco', date(2026, 9, 24), date(2026, 8, 30))
        self.assertEqual(result, (date(2026, 8, 30), 'Q4 FY2026', 95_723_000_000, 6.75, 'USD', 'GAAP'))

    def test_apple_statement_does_not_treat_diluted_share_count_as_eps(self):
        # Structure and values from the November 2, 2026 Apple 8-K earnings exhibit.
        report = '''<h1>Apple reports fourth quarter results</h1>
          <p>Results for its fiscal 2026 fourth quarter ended September 26, 2026.</p>
          <h2>Condensed Consolidated Statements of Operations (Unaudited)</h2>
          <p>(In millions, except number of shares, which are reflected in thousands, and per-share amounts)</p>
          <table><tr><td></td><td colspan="3">Three Months Ended</td><td colspan="3">Twelve Months Ended</td></tr>
          <tr><td></td><td>September 26,<br>2026</td><td>September 27,<br>2025</td>
            <td>September 26,<br>2026</td><td>September 27,<br>2025</td></tr>
          <tr><td>Total net sales<sup>(1)</sup></td><td>114,477</td><td>102,466</td><td>478,834</td></tr>
          <tr><td>Earnings per share:</td></tr>
          <tr><td>Basic</td><td>$</td><td>2.11</td><td>1.85</td><td>9.01</td></tr>
          <tr><td>Diluted</td><td>$</td><td>2.10</td><td>1.85</td><td>8.98</td></tr>
          <tr><td>Shares used in computing earnings per share:</td></tr>
          <tr><td>Basic</td><td>14,570,195</td><td>14,815,307</td></tr>
          <tr><td>Diluted</td><td>14,630,318</td><td>14,863,609</td></tr></table>'''
        result = collector.press_metrics(report, date(2026, 11, 2), 'USD')
        self.assertEqual(result, (date(2026, 9, 26), 'Q4 FY2026', 114_477_000_000, 2.10, 'USD', 'GAAP', 'share'))
        swapped = report.replace('September 26,<br>2026</td>', 'September 27,<br>2025</td>', 1)
        self.assertIsNone(collector.press_metrics(swapped, date(2026, 11, 2), 'USD'))

    def test_visa_uses_class_a_and_quarter_end_from_split_table_header(self):
        report = '''<h1>Visa Reports Fiscal Fourth Quarter and Full-Year 2026 Results</h1>
          <p>Payments volume for the three months ended June 30, 2026 increased.</p>
          <h2>Visa Consolidated Statements of Operations (unaudited)</h2>
          <table><tr><td></td><td>Three Months EndedSeptember 30,</td><td>Twelve Months EndedSeptember 30,</td></tr>
          <tr><td></td><td>2026</td><td>2025</td><td>2026</td><td>2025</td></tr>
          <tr><td>(in millions, except per share data)</td></tr>
          <tr><td>Net revenue</td><td>$</td><td>12,139</td><td>$</td><td>10,724</td></tr>
          <tr><td>Diluted Earnings Per Share</td></tr>
          <tr><td>Class A common stock</td><td>$</td><td>3.19</td></tr>
          <tr><td>Class B-1 common stock</td><td>$</td><td>4.60</td></tr>
          <tr><td>Diluted Weighted-average Shares Outstanding</td></tr>
          <tr><td>Class A common stock</td><td>1,880</td></tr></table>'''
        self.assertIsNone(collector.press_metrics(report, date(2026, 10, 27), 'USD'))
        result = collector.press_metrics(report, date(2026, 10, 27), 'USD', share_class='a')
        self.assertEqual(result, (date(2026, 9, 30), 'Q4 FY2026', 12_139_000_000, 3.19, 'USD', 'GAAP', 'share'))

    def test_consolidated_statement_can_report_loss_with_explicit_currency(self):
        report = '''<h1>Company Announces Third Quarter 2026 Results</h1>
          <h2>Condensed Consolidated Statements of Income</h2><p>In millions of euros, except per share data</p>
          <table><tr><td>Three Months Ended</td><td>Nine Months Ended</td></tr>
          <tr><td></td><td>September 30, 2026</td><td>September 30, 2025</td></tr>
          <tr><td>Total revenue</td><td>2,078.4</td><td>1,724.9</td><td>5,975.9</td></tr>
          <tr><td>Earnings per share:</td><td></td></tr>
          <tr><td>Basic</td><td>(0.25)</td></tr>
          <tr><td>Diluted</td><td>(</td><td>0.25</td><td>)</td></tr></table>'''
        result = collector.press_metrics(report, date(2026, 10, 28))
        self.assertEqual(result, (date(2026, 9, 30), 'Q3 FY2026', 2_078_400_000, -0.25, 'EUR', 'GAAP', 'share'))

    def test_failed_symbols_retain_seed_and_leave_sync_time_unchanged(self):
        class Client:
            def json(self, _):
                return {'0': {'ticker': 'AMD', 'cik_str': 2488}, '1': {'ticker': 'ARM', 'cik_str': 1973239}}

        seeded = {'symbol': 'AMD', 'periodEnd': '2026-09-26', 'reportDate': '2026-11-03'}
        feed = {'updatedAt': '2026-11-06T00:00:00Z', 'results': [seeded]}
        now = datetime(2026, 11, 6, tzinfo=timezone.utc)
        with patch.object(collector, 'latest_result', side_effect=[URLError('test outage'), None]):
            self.assertEqual(collector.update_feed(Client(), ['AMD', 'ARM'], ['AMD', 'ARM'], feed, now), feed)
        with patch.object(collector, 'latest_result', side_effect=URLError('test outage')):
            with self.assertRaisesRegex(RuntimeError, 'Existing feed retained'):
                collector.update_feed(Client(), ['AMD'], ['AMD'], feed, now)
        later_filing = {**seeded, 'reportDate': '2026-11-04'}
        self.assertEqual(collector.prefer_result(seeded, later_filing), seeded)

    def test_exhibit_index_only_uses_filing_directory(self):
        filing = {'accessionNumber': '0000804328-26-000127'}
        directory = collector.archive_dir(804328, filing['accessionNumber'])
        index = f'''<table><tr><td>Press release</td><td><a href="qcom.htm">qcom.htm</a></td><td>EX-99.1</td></tr>
        <tr><td>Other</td><td><a href="https://example.com/other.htm">other.htm</a></td><td>EX-99.2</td></tr>
        <tr><td>Cover</td><td><a href="cover.htm">cover.htm</a></td><td>8-K</td></tr></table>'''
        self.assertEqual(collector.exhibit_urls(804328, filing, index), [directory + 'qcom.htm'])

    def test_earnings_release_is_available_before_the_quarterly_filing(self):
        accession = '0000002488-26-000188'
        directory = collector.archive_dir(2488, accession)
        submissions = {'filings': {'recent': {
            'form': ['8-K'], 'filingDate': ['2026-11-03'], 'reportDate': ['2026-11-03'],
            'accessionNumber': [accession], 'primaryDocument': ['amd-20261103.htm'], 'items': ['2.02,9.01'],
        }}}
        exhibit = '''<h1>AMD Reports Third Quarter 2026 Financial Results</h1>
            <p>Financial results for the third quarter ended September 26, 2026.</p>
            <h2>GAAP Quarterly Financial Results</h2><table>
            <tr><td></td><td>Q3'26</td><td>Q3'25</td></tr>
            <tr><td>Revenue ($M)</td><td>$13,377</td><td>$9,246</td></tr>
            <tr><td>Diluted earnings per share</td><td>$1.46</td><td>$0.75</td></tr></table>'''

        class Client:
            def json(self, url):
                return submissions if '/submissions/' in url else {}

            def get(self, url):
                if url == directory + accession + '-index.html':
                    return '<table><tr><td>Press release</td><td><a href="q32026991.htm">q32026991.htm</a></td><td>EX-99.1</td></tr></table>'
                if url == directory + 'q32026991.htm':
                    return exhibit
                raise AssertionError(f'Unexpected URL: {url}')

        result = collector.latest_result(Client(), 'AMD', 2488, {}, date(2026, 11, 3))
        self.assertEqual(result['sourceUrl'], directory + 'q32026991.htm')
        self.assertEqual(result['reportDate'], '2026-11-03')
        self.assertEqual(result['periodEnd'], '2026-09-26')
        self.assertEqual(result['revenue'], 13_377_000_000)
        self.assertEqual(result['eps'], 1.46)


if __name__ == '__main__':
    unittest.main()
