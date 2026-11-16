import unittest
from datetime import date

import sync_reported_earnings as sec
from quarterly_eps import _fourth_quarter_summary_eps


class QuarterlyEpsTest(unittest.TestCase):
    def test_fourth_quarter_summary_with_forward_guidance(self):
        release = '''
          <h1>Company Announces Fourth Quarter and Fiscal Year 2025 Financial Results</h1>
          <p>Reported its fourth quarter and fiscal year ended November 2, 2025.
             Guidance for Q1 '26 is $1.99 per share.</p>
          <table>
            <tr><td></td><td colspan="2">GAAP</td><td>Non-GAAP</td></tr>
            <tr><td>(Dollars in millions, except per share data)</td><td>Q4 25</td><td>Q4 24</td><td>Q4 25</td></tr>
            <tr><td>Net revenue</td><td>$18,015</td><td>$14,054</td><td>$18,015</td></tr>
            <tr><td>Earnings per common share - diluted</td><td>$1.74</td><td>$0.90</td><td>$1.95</td></tr>
          </table>'''
        end = date(2025, 11, 2)
        self.assertEqual(_fourth_quarter_summary_eps(sec, release, end, 'Q4 FY2025'), 1.74)
        self.assertIsNone(_fourth_quarter_summary_eps(sec, release, end, 'Q4 FY2024'))
        self.assertIsNone(_fourth_quarter_summary_eps(sec, release, date(2025, 11, 3), 'Q4 FY2025'))
        self.assertIsNone(_fourth_quarter_summary_eps(sec, release.replace('>GAAP<', '>Non-GAAP<'), end, 'Q4 FY2025'))
        self.assertIsNone(_fourth_quarter_summary_eps(sec, release.replace('(Dollars', '(Canadian dollars'), end, 'Q4 FY2025'))


if __name__ == '__main__':
    unittest.main()
