import copy
import math
import unittest
import QuantLib as ql
from engine import analyze, price, date, horizon_date


def contract(**patch):
    c = dict(id='AAPL-C', underlying='AAPL', accountId='ibkr', currency='USD', right='call',
             side='long', strike=100., multiplier=100, quantity=1, spot=100., premiumPerContract=500.,
             impliedVolatility=.2, rate=.05, dividends=[], expiryAt='2027-01-15T16:00:00-05:00',
             exerciseStyle='european', shares=0., freeShares=0.)
    c.update(patch)
    return c


def inputs(cs):
    return dict(contracts=cs, accountIds=sorted({c['accountId'] for c in cs}), marketAsOf='2026-10-16T15:00:00Z', horizonTradingDays=5,
                coverage=dict(totalContracts=len(cs), supportedContracts=len(cs), totalQuantity=sum(c['quantity'] for c in cs), supportedQuantity=sum(c['quantity'] for c in cs), exclusions=[]),
                accounts=[dict(accountId='ibkr', currency='USD', cash=None, cashAsOf=None)])


class EngineTests(unittest.TestCase):
    def test_trading_horizon_observes_exchange_holidays(self):
        self.assertEqual(horizon_date('2026-12-24',1).ISO(),'2026-12-28')

    def test_european_call_matches_analytic_black_scholes(self):
        c = contract()
        today = date('2026-10-16')
        t = (date(c['expiryAt']) - today) / 365
        d1 = (math.log(c['spot']/c['strike']) + (c['rate']+.5*c['impliedVolatility']**2)*t)/(c['impliedVolatility']*math.sqrt(t))
        d2 = d1-c['impliedVolatility']*math.sqrt(t)
        normal = lambda x: .5*(1+math.erf(x/math.sqrt(2)))
        exact = c['spot']*normal(d1)-c['strike']*math.exp(-c['rate']*t)*normal(d2)
        self.assertAlmostEqual(price(c,today,grid=400),exact,delta=.005)

    def test_american_put_at_least_european_and_intrinsic(self):
        c=contract(right='put',spot=80,exerciseStyle='american')
        american=price(c,date('2026-10-16'),grid=400)
        self.assertGreaterEqual(american,20-.001)
        self.assertGreaterEqual(american,price(dict(c,exerciseStyle='european'),date('2026-10-16'))-.001)

    def test_discrete_dividend_reduces_call_value(self):
        c=contract()
        p=price(c,date('2026-10-16'))
        c['dividends']=[dict(date='2026-11-02',amount=2)]
        self.assertLess(price(c,date('2026-10-16')),p)

    def test_contract_premium_units_and_short_signs(self):
        long=analyze(inputs([contract()]))
        short=analyze(inputs([contract(side='short')]))
        for a,b in zip(long['scenarios'],short['scenarios']):
            self.assertAlmostEqual(a['optionPnl'],-b['optionPnl'])
        for key in ['dollarDelta','vega','theta']:
            self.assertAlmostEqual(long['contributors'][0][key],-short['contributors'][0][key])
        self.assertEqual(short['metrics']['expectedShortfall']['value'],None)
        self.assertGreater(long['contributors'][0]['vega'],0)

    def test_spread_bounds_and_unlimited_loss_are_explicit(self):
        spread=analyze(inputs([contract(),contract(id='upper',strike=110,side='short')]))
        bound=spread['payoffBounds'][0]
        self.assertFalse(bound['unlimitedLoss'])
        self.assertFalse(bound['unlimitedGain'])
        self.assertAlmostEqual(bound['maxPnl']-bound['minPnl'],1000)
        naked=analyze(inputs([contract(side='short')]))
        self.assertTrue(naked['payoffBounds'][0]['unlimitedLoss'])
        self.assertIsNone(naked['payoffBounds'][0]['minPnl'])

    def test_share_hedge_is_not_duplicated_across_legs(self):
        out=analyze(inputs([contract(shares=100),contract(id='other',strike=110,shares=100)]))
        down=out['scenarios'][0]
        self.assertAlmostEqual(down['combinedPnl']-down['optionPnl'],-2000)

    def test_encumbered_shares_affect_wealth_but_not_delivery(self):
        out=analyze(inputs([contract(side='short', shares=100, freeShares=0)]))
        down=out['scenarios'][0]
        self.assertAlmostEqual(down['combinedPnl']-down['optionPnl'],-2000)
        self.assertEqual(out['funding'][0]['delivery'][0]['availableShares'],0)

    def test_cash_unknown_is_not_zero_and_delivery_stays_per_account(self):
        out=analyze(inputs([contract(side='short',right='put',quantity=2)]))
        f=out['funding'][0]
        self.assertEqual(f['grossPutFunding'],20000)
        self.assertIsNone(f['cash'])
        self.assertIsNone(f['fundingGap'])
        data=inputs([contract(side='short',right='put')]);data['accounts'][0]['cash']=3000
        self.assertEqual(analyze(data)['funding'][0]['fundingGap'],7000)

    def test_cross_expiry_uses_intrinsic_and_keeps_every_contract(self):
        c=contract(expiryAt='2026-10-19T16:00:00-04:00')
        out=analyze(inputs([c,contract(id='other')]))
        self.assertEqual(out['status'],'ready')
        self.assertEqual(out['coverage']['supportedQuantity'],2)
        only=analyze(inputs([c]))
        self.assertAlmostEqual(only['scenarios'][0]['optionPnl'],-500)
        self.assertAlmostEqual(only['scenarios'][-1]['optionPnl'],1500)
        self.assertEqual(len(only['contributors']),1)

    def test_trailing_distribution_yield_matches_analytic_call(self):
        c=contract(dividendYield=.03)
        today=date('2026-10-16');t=(date(c['expiryAt'])-today)/365
        d1=(math.log(c['spot']/c['strike'])+(c['rate']-.03+.5*c['impliedVolatility']**2)*t)/(c['impliedVolatility']*math.sqrt(t))
        d2=d1-c['impliedVolatility']*math.sqrt(t)
        normal=lambda x:.5*(1+math.erf(x/math.sqrt(2)))
        exact=c['spot']*math.exp(-.03*t)*normal(d1)-c['strike']*math.exp(-c['rate']*t)*normal(d2)
        self.assertAlmostEqual(price(c,today,grid=400),exact,delta=.005)
        out=analyze(inputs([dict(c,shares=100)]))
        days=horizon_date('2026-10-16',5)-today
        flat=out['scenarios'][2]
        self.assertAlmostEqual(flat['combinedPnl']-flat['optionPnl'],100*100*.03*days/365)

    def test_old_quotes_do_not_move_the_valuation_clock_backwards(self):
        c=contract(expiryAt='2026-10-19T16:00:00-04:00')
        data=inputs([c]);data['marketAsOf']='2026-09-01T20:00:00Z';data['valuationDate']='2026-10-16'
        out=analyze(data)
        self.assertAlmostEqual(out['scenarios'][2]['optionPnl'],-500)

    def test_more_than_100_positions_contribute_to_the_whole_portfolio(self):
        single=analyze(inputs([contract()]))
        many=analyze(inputs([contract(id=f'position-{i}') for i in range(137)]))
        self.assertEqual(many['status'],'ready')
        self.assertEqual(many['coverage']['supportedContracts'],137)
        self.assertEqual(many['coverage']['supportedQuantity'],137)
        self.assertEqual(len(many['contributors']),137)
        for one,all_positions in zip(single['scenarios'],many['scenarios']):
            self.assertAlmostEqual(all_positions['optionPnl'],137*one['optionPnl'],places=5)
        self.assertAlmostEqual(many['metrics']['dollarDelta']['value'],137*single['metrics']['dollarDelta']['value'])

    def test_no_currency_aggregation_without_fx(self):
        out=analyze(inputs([contract(),contract(id='HK',currency='HKD')]))
        self.assertIsNone(out['metrics']['stressLoss']['value'])
        self.assertEqual(len(out['scenarios'][0]['byCurrency']),2)


if __name__=='__main__': unittest.main()
