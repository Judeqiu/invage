"""Bounded, one-portfolio JSON worker. No credentials, network or accounting writes."""
import datetime as dt
import json
import math
import sys
import time
import QuantLib as ql

VERSION = 'risk-ql-fhs-v4'
from forecast import forecast
from actions import compare
SCENARIOS = [('down-20', -.20, .20), ('down-10', -.10, .10),
             ('flat', 0., 0.), ('up-10', .10, -.05), ('up-20', .20, .05)]


def date(value):
    d = dt.date.fromisoformat(value[:10])
    return ql.Date(d.day, d.month, d.year)


def horizon_date(start, days):
    # US exchange holidays, including observed holidays; no weekend approximation.
    return ql.UnitedStates(ql.UnitedStates.NYSE).advance(date(start), days, ql.Days)


def price(c, today, spot=None, vol=None, grid=200):
    spot = c['spot'] if spot is None else spot
    vol = c['impliedVolatility'] if vol is None else vol
    expiry = date(c['expiryAt'])
    if today >= expiry:
        return max(0., spot - c['strike'] if c['right'] == 'call' else c['strike'] - spot)
    ql.Settings.instance().evaluationDate = today
    dc = ql.Actual365Fixed()
    process = ql.BlackScholesMertonProcess(
        ql.QuoteHandle(ql.SimpleQuote(spot)),
        ql.YieldTermStructureHandle(ql.FlatForward(today, c.get('dividendYield', 0.), dc)),
        ql.YieldTermStructureHandle(ql.FlatForward(today, c['rate'], dc)),
        ql.BlackVolTermStructureHandle(ql.BlackConstantVol(today, ql.NullCalendar(), max(.001, vol), dc)))
    dividends = [ql.FixedDividend(d['amount'], date(d['date'])) for d in c['dividends']
                 if today < date(d['date']) <= expiry]
    payoff = ql.PlainVanillaPayoff(ql.Option.Call if c['right'] == 'call' else ql.Option.Put, c['strike'])
    exercise = ql.AmericanExercise(today, expiry) if c['exerciseStyle'] == 'american' else ql.EuropeanExercise(expiry)
    option = ql.VanillaOption(payoff, exercise)
    option.setPricingEngine(ql.FdBlackScholesVanillaEngine(process, dividends, grid, grid, 2))
    return option.NPV()


def analyze(inputs):
    started = time.monotonic()
    contracts = inputs['contracts']
    cache = {}
    def cached_price(c, at, spot=None, vol=None, grid=200):
        key = (c['underlying'],c['right'],c['strike'],c['expiryAt'],c['exerciseStyle'],c['rate'],c.get('dividendYield',0),tuple((d['date'],d['amount']) for d in c['dividends']),at.serialNumber(),c['spot'] if spot is None else spot,c['impliedVolatility'] if vol is None else vol,grid)
        if key not in cache: cache[key] = price(c,at,spot,vol,grid)
        return cache[key]
    today = date(inputs.get('valuationDate') or inputs['marketAsOf']) if inputs.get('valuationDate') or inputs['marketAsOf'] else ql.Date.todaysDate()
    end = horizon_date(today.ISO(), inputs['horizonTradingDays'])
    coverage = dict(inputs['coverage'])
    coverage['exclusions'] = list(coverage['exclusions'])
    coverage['supportedContracts'] = len(contracts)
    coverage['supportedQuantity'] = sum(c['quantity'] for c in contracts)
    currencies = sorted({c['currency'] for c in contracts})
    contributors = []
    max_diff = 0.
    def checked_price(c, at, spot=None, vol=None, grid=400):
        nonlocal max_diff
        coarse = cached_price(c, at, spot, vol, grid=200)
        fine = cached_price(c, at, spot, vol, grid=400)
        max_diff = max(max_diff, abs(coarse - fine))
        if abs(coarse - fine) > max(.03, .005 * fine):
            raise ValueError('Pricing grid did not converge')
        return fine
    for c in contracts:
        sign_qty = c['quantity'] * c['multiplier'] * (1 if c['side'] == 'long' else -1)
        p = cached_price(c, today)
        ds, dv = c['spot'] * .001, .001
        delta = (cached_price(c, today, c['spot'] + ds) - cached_price(c, today, c['spot'] - ds)) / (2 * ds)
        vega = (cached_price(c, today, vol=c['impliedVolatility'] + dv) - cached_price(c, today, vol=max(.001, c['impliedVolatility'] - dv))) / (2 * dv) / 100
        theta = cached_price(c, today + 1) - p
        contributors.append(dict(id=c['id'], accountId=c['accountId'], currency=c['currency'],
                                 dollarDelta=delta * c['spot'] * sign_qty, vega=vega * sign_qty, theta=theta * sign_qty))
    # Each underlying share lot is included once even when several option legs refer to it.
    shares = {}
    for c in contracts:
        key = (c['accountId'], c['currency'], c['underlying'])
        prior = shares.get(key)
        if prior and (prior['shares'] != c['shares'] or prior['freeShares'] != c['freeShares'] or abs(prior['spot'] - c['spot']) > .01):
            raise ValueError('Underlying snapshots disagree across legs')
        shares[key] = c
    scenarios = []
    for name, shock, iv in SCENARIOS:
        rows = []
        for currency in currencies:
            option_pnl = 0.
            for c in contracts:
                if c['currency'] != currency:
                    continue
                sign_qty = c['quantity'] * (1 if c['side'] == 'long' else -1)
                value = checked_price(c, min(end,date(c['expiryAt'])), c['spot'] * (1 + shock), max(.001, c['impliedVolatility'] + iv)) * c['multiplier']
                option_pnl += (value - c['premiumPerContract']) * sign_qty
            stock_pnl = sum(c['shares'] * (c['spot'] * shock + sum(d['amount'] for d in c['dividends']
                            if today < date(d['date']) <= end) + c['spot'] * c.get('dividendYield', 0.) * ((end-today)/365.)) for c in shares.values() if c['currency'] == currency)
            rows.append(dict(currency=currency, optionPnl=option_pnl, combinedPnl=option_pnl + stock_pnl))
        scenarios.append(dict(id=name, spotShock=shock, volatilityPointShock=iv * 100,
                              optionPnl=sum(r['optionPnl'] for r in rows) if len(currencies) == 1 else None,
                              combinedPnl=sum(r['combinedPnl'] for r in rows) if len(currencies) == 1 else None, byCurrency=rows))
    payoff_bounds = []
    groups = {}
    for c in contracts:
        groups.setdefault((c['accountId'], c['currency'], c['underlying'], c['expiryAt']), []).append(c)
    for (account, currency, underlying, expiry), legs in groups.items():
        def pnl(spot):
            return sum((max(0., spot - c['strike'] if c['right'] == 'call' else c['strike'] - spot) * c['multiplier'] - c['premiumPerContract']) * c['quantity'] * (1 if c['side'] == 'long' else -1) for c in legs)
        points = [pnl(spot) for spot in {0., *(c['strike'] for c in legs)}]
        slope = sum(c['quantity'] * c['multiplier'] * (1 if c['side'] == 'long' else -1) for c in legs if c['right'] == 'call')
        payoff_bounds.append(dict(accountId=account, currency=currency, underlying=underlying, expiryAt=expiry,
            minPnl=None if slope < 0 else min(points), maxPnl=None if slope > 0 else max(points),
            unlimitedLoss=slope < 0, unlimitedGain=slope > 0))
    funding = []
    for a in inputs['accounts']:
        cs = [c for c in contracts if c['accountId'] == a['accountId'] and c['currency'] == a['currency'] and c['side'] == 'short']
        puts = sum(c['strike'] * c['multiplier'] * c['quantity'] for c in cs if c['right'] == 'put')
        calls = sum(c['multiplier'] * c['quantity'] for c in cs if c['right'] == 'call')
        available = sum(max(0., c['freeShares']) for c in shares.values() if c['accountId'] == a['accountId'] and c['currency'] == a['currency'])
        funding.append(dict(**a, grossPutFunding=puts, callShares=calls, availableShares=available,
                            fundingGap=None if a['cash'] is None else max(0., puts - a['cash']),
                            delivery=[dict(underlying=u, requiredShares=sum(c['quantity'] * c['multiplier'] for c in cs if c['right'] == 'call' and c['underlying'] == u),
                              availableShares=max(0., shares[(a['accountId'], a['currency'], u)]['freeShares'])) for u in sorted({c['underlying'] for c in cs if c['right'] == 'call'})]))
    covered = coverage['supportedContracts']
    partial = covered != coverage['totalContracts']
    single = len(currencies) == 1
    currency = currencies[0] if single else 'multiple currencies'
    loss = max([0.] + [-s['combinedPnl'] for s in scenarios]) if covered and single else None
    physical, paths = forecast(inputs, contracts, today, end, cached_price, started+48)
    comparisons = compare(inputs, contracts, scenarios, end, checked_price, paths, physical, started+55)
    es = physical['metrics'][0]['expectedShortfall'] if single and physical['status']=='ready' and physical['metrics'] else None
    return dict(coverage=coverage, payoffBounds=payoff_bounds, status='unavailable' if not covered else 'partial' if partial else 'ready',
        capabilities=dict(stress=bool(covered), greeks=bool(covered), forecast=bool(physical['metrics']), actions=any(a['status']=='ready' and a['kind']!='hold' for a in comparisons)),
        scope=dict(accountIds=inputs['accountIds'], currencies=currencies, horizonTradingDays=inputs['horizonTradingDays']),
        metrics=dict(stressLoss=dict(value=loss, unit=currency, reason='Covered positions only' if partial else 'Conditional stress; positive loss magnitude'),
                     dollarDelta=dict(value=sum(c['dollarDelta'] for c in contributors) if covered and single else None, unit=currency,
                                      reason='Standalone option dollar delta; shares excluded'),
                     expectedShortfall=dict(value=es, unit=currency, reason=physical['reason'])),
        scenarios=scenarios if covered else [], contributors=contributors, funding=funding, actions=comparisons, forecast=physical,
        assumptions=['Conditional scenarios, without forecast probabilities.',
          'European/American finite-difference pricing with announced cash dividends or an estimated trailing distribution yield; flat supplied rate and IV.',
          'Signed P/L: scenario option value less latest available starting mark. Includes related shares and announced or estimated distributions once.',
          'IV shocks are floored at 0.1% annual volatility; labels describe requested changes.',
          'Assumes no early assignment before horizon; gross assignment obligations are separate branches, not expected loss.',
          'Conditional hold scenarios exclude costs. Comparisons use the same terminal marked-wealth basis with initial estimated fees/slippage charged once; future liquidation, cash interest and borrow costs are excluded.',
          'All related shares affect P/L; only free shares cover delivery. Cash and delivery remain account-specific; no cross-account collateral netting.',
          'No cross-currency aggregation without a validated FX snapshot.',
          'Daily pricing grid; expiry-day Greeks use intrinsic value and omit remaining intraday time value. For contracts expiring by the horizon, the full spot shock applies at expiry and intrinsic cash-equivalent proceeds are held unchanged to the horizon; post-expiry delivery shares are not retained.'] + inputs.get('providerAssumptions', []),
        diagnostics=dict(maxPricingDifference=max_diff, grid=400, elapsedMs=round((time.monotonic() - started) * 1000)))


if __name__ == '__main__':
    try:
        raw = sys.stdin.read(32 * 1024 * 1024 + 1)
        if len(raw) > 32 * 1024 * 1024:
            raise ValueError('Input limit exceeded')
        result = analyze(json.loads(raw))
        print(json.dumps(result, allow_nan=False))
    except Exception:
        # Portfolio/worker exception details are deliberately not logged.
        print(json.dumps({'error': 'Risk worker could not validate or price these inputs'}))
        sys.exit(1)
