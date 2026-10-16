import time
import unittest
import numpy as np
from forecast import tail_metrics, filtered_residuals, simulate, validate_factors, forecast, reprice_paths
from engine import analyze, date, price
from test_engine import contract, inputs

COST=dict(basis='estimate',currency='USD',feePerContract=.65,minimumOrderFee=1.,slippageBps=25.,reference='test estimate')
QUOTE=dict(bid=4.,ask=5.,bidSize=10,askSize=10,fetchedAt='2026-10-16T15:00:00Z',quoteAsOf=None,source='indicative test')

class ForecastTests(unittest.TestCase):
    def test_es_fractional_tail_and_atoms(self):
        self.assertEqual(tail_metrics([0]*19+[100])[0],0.)
        self.assertAlmostEqual(tail_metrics([0]*19+[100])[1],100.)
        self.assertAlmostEqual(tail_metrics([0]*98+[100,200],.975)[1],120.)
        with self.assertRaises(ValueError):tail_metrics([float('nan')])

    def test_joint_resampling_preserves_dependence_and_seed(self):
        rng=np.random.default_rng(9)
        x=rng.normal(0,.01,400);r=np.column_stack([x,-2*x])
        residuals,variance=filtered_residuals(r)
        a,recorded=simulate(residuals,variance,5,1000,np.random.default_rng(1),1,[2])
        b,_=simulate(residuals,variance,5,1000,np.random.default_rng(1))
        np.testing.assert_allclose(a[:,1],-2*a[:,0]);np.testing.assert_array_equal(a,b)
        self.assertEqual(recorded[2].shape,(1000,1))

    def test_insufficient_history_does_not_publish_probabilities(self):
        c=contract();i=inputs([c]);i['costModel']=COST
        out=analyze(i)
        self.assertEqual(out['forecast']['status'],'unavailable')
        self.assertFalse(out['capabilities']['forecast'])
        self.assertIsNone(out['metrics']['expectedShortfall']['value'])
        self.assertTrue(out['capabilities']['stress'])

    def test_validation_rejects_future_regime_break(self):
        rng=np.random.default_rng(90)
        returns=np.vstack([rng.normal(0,.005,(126,2)),np.full((80,2),-.08)])
        report=validate_factors(returns,1,5,time.monotonic()+20)
        self.assertEqual(report['status'],'failed')

    def test_future_rows_do_not_enter_direct_worker_forecast(self):
        # Normalization rejects future history; test direct simulation with too few observations.
        c=contract();i=inputs([c]);i['histories']=[dict(key='AAPL|call|100|2027-01-15',dates=['2027-01-01'],spots=[100],ivs=[.2])]
        f,_=forecast(i,[c],date('2026-10-16'),date('2026-10-23'),price,time.monotonic()+10)
        self.assertFalse(f['metrics'])

    def test_qualified_history_publishes_reproducible_portfolio_es(self):
        c=contract();i=inputs([c]);i['horizonTradingDays']=1
        cal=__import__('QuantLib').UnitedStates(__import__('QuantLib').UnitedStates.NYSE)
        d=date('2025-01-01');dates=[]
        while d<date('2026-10-16'):
            if cal.isBusinessDay(d):dates.append(d.ISO())
            d+=1
        rng=np.random.default_rng(10)
        levels=np.array([100.,.2])*np.exp(np.cumsum(rng.normal(0,[.01,.025],(len(dates),2)),axis=0))
        i['histories']=[dict(key='AAPL|call|100|2027-01-15',dates=dates,spots=levels[:,0].tolist(),ivs=levels[:,1].tolist(),source='synthetic test only')]
        a=analyze(i);b=analyze(i)
        self.assertEqual(a['forecast']['status'],'ready')
        self.assertEqual(a['forecast'],b['forecast'])
        self.assertGreaterEqual(a['metrics']['expectedShortfall']['value'],a['forecast']['metrics'][0]['var'])
        self.assertEqual(a['forecast']['paths'],8192)

    def test_close_costs_once_and_forward_basis_long_and_short(self):
        for side in ['long','short']:
            c=contract(side=side);i=inputs([c]);i['costModel']=COST;i['executionQuotes']=[dict(contractId=c['id'],quote=QUOTE)]
            out=analyze(i);close=next(a for a in out['actions'] if a['kind']=='close')
            cash=(-5*1.0025*100 if side=='short' else 4*.9975*100)-1
            expected=cash+(500 if side=='short' else -500)
            for row in close['scenarios']:self.assertAlmostEqual(row['pnl'],expected)
            self.assertEqual(close['estimatedInitialFees'],1)
            self.assertEqual(close['funding'],'unknown' if side=='short' else 'not-required')
            self.assertIsNone(close['forecast'])

    def test_hedge_cost_funding_liquidity_and_missing_quotes(self):
        c=contract(side='short');i=inputs([c]);i['costModel']=COST
        h=contract(id='hedge',strike=110)
        i['hedges']=[dict(forContractId=c['id'],contract=h,quote=dict(QUOTE,askSize=0))]
        i['accounts'][0]['cash']=100
        out=analyze(i);hedge=next(a for a in out['actions'] if a['kind']=='hedge');close=next(a for a in out['actions'] if a['kind']=='close')
        self.assertEqual(close['status'],'unavailable');self.assertEqual(hedge['funding'],'insufficient');self.assertEqual(hedge['liquidity'],'insufficient')
        for scenario,row in zip(out['scenarios'],hedge['scenarios']):
            terminal=price(h,date('2026-10-23'),h['spot']*(1+scenario['spotShock']),max(.001,h['impliedVolatility']+scenario['volatilityPointShock']/100),grid=400)*100
            self.assertAlmostEqual(row['pnl']-scenario['combinedPnl'],terminal+hedge['initialCashFlow'])

    def test_european_path_prices_match_direct_quantlib(self):
        c=contract();spots=np.linspace(70,140,100);ivs=np.linspace(.15,.4,100)
        values=reprice_paths(c,date('2026-10-23'),spots,ivs,price,time.monotonic()+10)
        for j in [0,49,99]:self.assertAlmostEqual(values[j],price(c,date('2026-10-23'),float(spots[j]),float(ivs[j]),grid=400),delta=.01)

if __name__=='__main__':unittest.main()
