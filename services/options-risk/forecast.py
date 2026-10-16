"""Joint EWMA filtered historical simulation, with rolling-origin qualification.

This validates observed risk factors, not a trading strategy or investment edge.
Publication fails closed for insufficient history, failed calibration or repricing.
"""
import hashlib
import math
import time
import numpy as np
import QuantLib as ql

ALPHA = .95
LAMBDA = .94
TRAIN = 126
VALIDATION_CASES = 40
HOLDOUT_CASES = 20
PATHS = 8192


def contract_key(c):
    return f"{c['underlying']}|{c['right']}|{c['strike']:g}|{c['expiryAt'][:10]}"


def tail_metrics(losses, confidence=ALPHA):
    """Empirical upper-tail ES with fractional boundary mass, including atoms."""
    values = np.sort(np.asarray(losses, dtype=float))
    if not len(values) or not np.all(np.isfinite(values)) or not 0 < confidence < 1:
        raise ValueError('Invalid tail sample')
    var = float(values[max(0, math.ceil(confidence * len(values)) - 1)])
    mass = (1 - confidence) * len(values)
    whole = int(math.floor(mass + 1e-10))
    fraction = max(0., mass - whole)
    total = float(values[-whole:].sum()) if whole else 0.
    if fraction > 1e-10:
        total += fraction * float(values[-whole - 1])
    return var, total / mass


def filtered_residuals(returns):
    returns = np.asarray(returns, dtype=float)
    variance = np.maximum(np.mean(returns[:30] ** 2, axis=0), 1e-10)
    residuals = []
    for row in returns[30:]:
        residuals.append(row / np.sqrt(variance))
        variance = LAMBDA * variance + (1 - LAMBDA) * row ** 2
    residuals = np.asarray(residuals)
    return residuals - residuals.mean(axis=0), variance


def simulate(residuals, variance, horizon, paths, rng, spot_dimensions=0, record_steps=()):
    totals = np.zeros((paths, len(variance)))
    variances = np.broadcast_to(variance, totals.shape).copy()
    recorded = {}
    # Same historical date/block for every factor preserves empirical dependence.
    starts = rng.integers(0, len(residuals), size=paths)
    for step in range(1, horizon + 1):
        if (step - 1) % 5 == 0:
            starts = rng.integers(0, len(residuals), size=paths)
        rows = residuals[(starts + (step - 1) % 5) % len(residuals)]
        move = rows * np.sqrt(variances)
        totals += move
        variances = LAMBDA * variances + (1 - LAMBDA) * move ** 2
        if step in record_steps:
            recorded[step] = totals[:, :spot_dimensions].copy()
    return totals, recorded


def _binomial_pvalue(hits, count, p):
    if count == 0:
        return 0.
    observed = hits / count
    def term(x, probability):
        return 0. if x == 0 else x * math.log(max(probability, 1e-15))
    null = term(hits, p) + term(count - hits, 1 - p)
    alternative = term(hits, observed) + term(count - hits, 1 - observed)
    return math.erfc(math.sqrt(max(0., alternative - null)))


def _independence_pvalue(hits):
    counts = np.zeros((2, 2), dtype=int)
    for a, b in zip(hits[:-1], hits[1:]):
        counts[int(a), int(b)] += 1
    if not counts.sum() or not counts[0].sum() or not counts[1].sum():
        return None
    p = counts[:, 1].sum() / counts.sum()
    log_null = log_alt = 0.
    for i in range(2):
        conditional = counts[i, 1] / counts[i].sum()
        for j in range(2):
            if counts[i, j]:
                log_null += counts[i, j] * math.log(max(p if j else 1-p, 1e-15))
                log_alt += counts[i, j] * math.log(max(conditional if j else 1-conditional, 1e-15))
    return math.erfc(math.sqrt(max(0., log_alt - log_null)))


def _tail_identification_z(actual, quantiles, tails):
    residual = np.asarray(tails) - quantiles - np.maximum(np.asarray(actual) - quantiles, 0) / (1 - ALPHA)
    error = float(np.std(residual, ddof=1)) / math.sqrt(len(residual))
    return abs(float(np.mean(residual))) / max(error, 1e-9)


def validate_factors(returns, horizon, seed, deadline):
    """Disjoint horizon labels; every forecast uses only its historical prefix.

    The last 20 origins are an untouched reporting segment. Hyperparameters and
    tests are fixed before this segment; no fit/selection uses future outcomes.
    """
    origins = list(range(TRAIN, len(returns) - horizon + 1, horizon))
    report = dict(status='insufficient', reason='Insufficient non-overlapping validation/holdout observations',
                  observations=len(returns)+1, trainingObservations=TRAIN,
                  validationCases=max(0, len(origins)-HOLDOUT_CASES), holdoutCases=min(len(origins), HOLDOUT_CASES),
                  intervalCoverage=[], varExceedanceRate=None, varIndependencePValue=None,
                  jointTailScore=None, baselineTailScore=None,
                  calibrationTarget='Joint spot/log-IV factors and standardized equal-weight factor basket; not a historical trading-strategy or portfolio-return backtest')
    if len(origins) < VALIDATION_CASES + HOLDOUT_CASES:
        return report
    actual, quantiles, tails, baselines_q, baselines_es = [], [], [], [], []
    intervals = {level: [] for level in [.5, .8, .95]}
    for origin in origins:
        if time.monotonic() > deadline:
            raise TimeoutError('Forecast validation exceeded its numerical budget')
        past = returns[:origin]
        residuals, variance = filtered_residuals(past)
        rng = np.random.default_rng(seed + origin)
        samples, _ = simulate(residuals, variance, horizon, 1024, rng)
        scale = np.sqrt(np.maximum(variance * horizon, 1e-10))
        basket = samples / scale @ np.ones(len(scale)) / math.sqrt(len(scale))
        realized = float(np.sum(returns[origin:origin+horizon].sum(axis=0) / scale) / math.sqrt(len(scale)))
        loss = -realized
        q, es = tail_metrics(-basket)
        actual.append(loss); quantiles.append(q); tails.append(es)
        # Unfiltered synchronized historical blocks are the simple challenger.
        blocks = np.array([past[j:j+horizon].sum(axis=0) for j in range(30, len(past)-horizon+1, horizon)])
        baseline_loss = -(blocks / scale @ np.ones(len(scale))) / math.sqrt(len(scale))
        bq, bes = tail_metrics(baseline_loss)
        baselines_q.append(bq); baselines_es.append(bes)
        for level in intervals:
            low, high = np.quantile(basket, [(1-level)/2, (1+level)/2])
            intervals[level].append(bool(low <= realized <= high))
    hits = np.asarray(actual) > np.asarray(quantiles)
    z = _tail_identification_z(actual, np.asarray(quantiles), np.asarray(tails))
    bz = _tail_identification_z(actual, np.asarray(baselines_q), np.asarray(baselines_es))
    independence = _independence_pvalue(hits)
    report.update(status='passed', reason='Predeclared factor-calibration checks passed; option risk remains model-dependent',
                  intervalCoverage=[dict(level=level, observed=float(np.mean(rows)), cases=len(rows)) for level, rows in intervals.items()],
                  varExceedanceRate=float(np.mean(hits)), varIndependencePValue=independence,
                  jointTailScore=z, baselineTailScore=bz)
    # Two-sided unconditional coverage and dependence diagnostics, and joint
    # VaR/ES identification moments. No p-value is a guarantee of calibration.
    if (_binomial_pvalue(int(hits.sum()), len(hits), 1-ALPHA) < .01 or
        independence is not None and independence < .01 or z > 2.58 or z > max(2., bz * 1.5)):
        report.update(status='failed', reason='Tail coverage, clustering or joint VaR/ES diagnostic failed')
    for level, rows in intervals.items():
        if _binomial_pvalue(sum(rows), len(rows), level) < .01:
            report.update(status='failed', reason='Forecast interval coverage failed')
    # Report final holdout coverage separately and fail large final-period breaks.
    final_hits = hits[-HOLDOUT_CASES:]
    if _binomial_pvalue(int(final_hits.sum()), len(final_hits), 1-ALPHA) < .01:
        report.update(status='failed', reason='Untouched final-period coverage failed')
    return report


def _normal(x):
    shape = x.shape
    return .5 * (1 + np.fromiter((math.erf(v / math.sqrt(2)) for v in x.flat), float, count=x.size).reshape(shape))


def european(c, spot, vol, years):
    if years <= 0:
        return np.maximum(0, spot-c['strike'] if c['right']=='call' else c['strike']-spot)
    q = c.get('dividendYield', 0.)
    root = vol * math.sqrt(years)
    d1 = (np.log(spot/c['strike']) + (c['rate']-q+.5*vol**2)*years) / root
    d2 = d1-root
    if c['right']=='call':
        return spot*math.exp(-q*years)*_normal(d1)-c['strike']*math.exp(-c['rate']*years)*_normal(d2)
    return c['strike']*math.exp(-c['rate']*years)*_normal(-d2)-spot*math.exp(-q*years)*_normal(-d1)


def reprice_paths(c, end, spots, ivs, price, deadline):
    """Analytic European base + checked FD correction for American/dividends.

    No tail extrapolation: all sampled points lie within the grid. Direct prices
    at stratified/tail points validate the interpolation, with refinement.
    """
    expiry = ql.DateParser.parseISO(c['expiryAt'][:10])
    years = max(0., (expiry-end)/365.)
    if not years:
        return european(c, spots, ivs, years)
    base = european(c, spots, ivs, years)
    if c['exerciseStyle']=='european' and not c['dividends']:
        return base
    for grid in [5, 9, 17]:
        if time.monotonic() > deadline:
            raise TimeoutError('Forecast repricing exceeded its numerical budget')
        xs = np.linspace(float(np.log(spots).min())-1e-9, float(np.log(spots).max())+1e-9, grid)
        vs = np.linspace(float(np.log(ivs).min())-1e-9, float(np.log(ivs).max())+1e-9, grid)
        correction = np.zeros((grid, grid))
        for i, x in enumerate(xs):
            for j, v in enumerate(vs):
                if time.monotonic() > deadline:
                    raise TimeoutError('Forecast repricing exceeded its numerical budget')
                s, iv = math.exp(x), math.exp(v)
                correction[i,j] = price(c,end,s,iv,grid=200)-float(european(c,np.array([s]),np.array([iv]),years)[0])
        x=np.log(spots);v=np.log(ivs)
        ix=np.clip(np.searchsorted(xs,x)-1,0,grid-2);iv=np.clip(np.searchsorted(vs,v)-1,0,grid-2)
        wx=(x-xs[ix])/(xs[ix+1]-xs[ix]);wv=(v-vs[iv])/(vs[iv+1]-vs[iv])
        adjustment=((1-wx)*(1-wv)*correction[ix,iv]+wx*(1-wv)*correction[ix+1,iv]+(1-wx)*wv*correction[ix,iv+1]+wx*wv*correction[ix+1,iv+1])
        values=base+adjustment
        checks=np.unique(np.concatenate([np.argsort(values)[[0,1,-2,-1]],np.linspace(0,len(values)-1,12,dtype=int)]))
        error=0.
        for k in checks:
            exact=price(c,end,float(spots[k]),float(ivs[k]),grid=400)
            error=max(error,abs(exact-values[k])/max(.01,abs(exact)))
        if error<=.005:
            return np.maximum(0.,values)
    raise ValueError('Forecast pricing interpolation did not converge to 0.5%')


def sampling_interval(losses, seed):
    rng=np.random.default_rng(seed)
    estimates=[]
    for _ in range(128):
        estimates.append(tail_metrics(losses[rng.integers(0,len(losses),len(losses))])[1])
    low,high=np.quantile(estimates,[.025,.975])
    return dict(lower=float(low),upper=float(high),confidence=.95,
                method='Percentile bootstrap of model-generated paths; Monte Carlo sampling error only, excludes parameter and model uncertainty')


def forecast(inputs, contracts, today, end, price, deadline):
    seed=int(hashlib.sha256((inputs.get('analysisContextId','')+inputs.get('marketSnapshotId','')+str(inputs['horizonTradingDays'])).encode()).hexdigest()[:8],16)
    validation=dict(status='insufficient',reason='Synchronized spot and exact-contract IV history unavailable',observations=0,trainingObservations=TRAIN,
                    validationCases=0,holdoutCases=0,intervalCoverage=[],varExceedanceRate=None,varIndependencePValue=None,jointTailScore=None,baselineTailScore=None,
                    calibrationTarget='Joint spot/log-IV factors and standardized factor basket')
    output=dict(status='unavailable',reason=validation['reason'],model=dict(id='joint-ewma-fhs',measure='physical',version='1'),seed=seed,paths=0,
                coverage=dict(totalPositions=len(contracts),supportedPositions=0,exclusions=[]),validation=validation,metrics=[],assumptions=[
                    'Empirical synchronized residual blocks preserve observed cross-factor dependence; EWMA lambda 0.94, zero log drift, no synthetic normal shocks.',
                    'Exact-contract historical IV changes are modeled jointly with spot returns. No historical IV is replaced by realized stock volatility.',
                    'Calibration tests risk factors, not historical strategy returns; current-portfolio valuation and American pricing add separate model risk.',
                    'Sampling intervals measure Monte Carlo error only. Parameter uncertainty, unseen crises and model misspecification remain.',
                    'Related shares and cash-equivalent expiry settlement are included; assumes no early assignment and unchanged cash interest.',
                    'Forecast P/L is terminal model wealth before future liquidation fees. Action comparisons separately include estimated transaction costs.'])
    horizon=inputs['horizonTradingDays'];required=max(252,TRAIN+(VALIDATION_CASES+HOLDOUT_CASES)*horizon+1)
    histories={h['key']:h for h in inputs.get('histories',[])};eligible=[]
    for c in contracts:
        h=histories.get(contract_key(c))
        if not h or len(h['dates'])<required:
            output['coverage']['exclusions'].append(dict(id=c['id'],reason=f'Needs at least {required} observed daily spot/IV pairs for this horizon'))
        else:
            eligible.append(c)
    if not eligible:
        output['reason']=f'Insufficient observed spot/IV history for {horizon}-day validation; no forecast probabilities or ES published'
        return output, None
    try:
        keys=list(dict.fromkeys(contract_key(c) for c in eligible));assets=list(dict.fromkeys(c['underlying'] for c in eligible))
        common=sorted(set.intersection(*(set(histories[k]['dates']) for k in keys)))
        calendar=ql.UnitedStates(ql.UnitedStates.NYSE)
        # Keep a contiguous trading-day segment, never forward-fill missing IV.
        begin=0
        for i in range(1,len(common)):
            a,b=ql.DateParser.parseISO(common[i-1]),ql.DateParser.parseISO(common[i])
            if calendar.businessDaysBetween(a,b,False,True)!=1:begin=i
        common=[d for d in common[begin:] if d<today.ISO()]
        if len(common)<required:raise ValueError('Insufficient contiguous common trading dates across the portfolio')
        last=ql.DateParser.parseISO(common[-1])
        if calendar.businessDaysBetween(last,today,False,True)>5:raise ValueError('Historical factor data is not current enough for forecasting')
        # Optional hedge factors join the same calibrated paths only when their
        # observed histories cover every held-portfolio date. Missing hedges do
        # not shorten or otherwise change the held portfolio's history window.
        optional=[]
        for h in inputs.get('hedges',[]):
            c=h['contract'];k=contract_key(c);history=histories.get(k)
            if history and set(common).issubset(history['dates']) and c['underlying'] in assets:
                optional.append(h)
                if k not in keys:keys.append(k)
        by_key={k:{d:(s,v) for d,s,v in zip(histories[k]['dates'],histories[k]['spots'],histories[k]['ivs'])} for k in keys}
        levels=[]
        for asset in assets:
            asset_keys=[k for k in keys if k.startswith(asset+'|')]
            first=np.array([by_key[asset_keys[0]][d][0] for d in common])
            for k in asset_keys[1:]:
                if not np.allclose(first,[by_key[k][d][0] for d in common],rtol=1e-6):raise ValueError('Historical underlying series disagree across contracts')
            levels.append(first)
        levels.extend(np.array([by_key[k][d][1] for d in common]) for k in keys)
        returns=np.diff(np.log(np.array(levels).T),axis=0)
        if not np.all(np.isfinite(returns)) or np.any(np.abs(returns[:,:len(assets)])>math.log(1.5)):
            raise ValueError('Unresolved corporate action or invalid historical return; no tail truncation applied')
        validation=validate_factors(returns,horizon,seed,deadline);output['validation']=validation
        if validation['status']!='passed':output['reason']=validation['reason'];return output,None
        residuals,variance=filtered_residuals(returns)
        expiry_steps={}
        for c in eligible:
            expiry=ql.DateParser.parseISO(c['expiryAt'][:10])
            expiry_steps[c['id']]=min(horizon,max(0,calendar.businessDaysBetween(today,expiry,False,True)))
        record_steps={s for s in expiry_steps.values() if 0<s<horizon}
        moves,recorded=simulate(residuals,variance,horizon,PATHS,np.random.default_rng(seed),len(assets),record_steps)
        per_currency={};leg_paths={};end_prices={};shares={}
        for c in eligible:
            if time.monotonic()>deadline:raise TimeoutError('Forecast exceeded its numerical budget')
            ai=assets.index(c['underlying']);ki=len(assets)+keys.index(contract_key(c));step=expiry_steps[c['id']]
            spot_moves=recorded[step][:,ai] if 0<step<horizon else np.zeros(PATHS) if step==0 else moves[:,ai]
            spots=c['spot']*np.exp(spot_moves);ivs=c['impliedVolatility']*np.exp(moves[:,ki])
            if not np.all(np.isfinite(spots)) or not np.all(np.isfinite(ivs)) or np.any(ivs>5) or np.any(ivs<.001):
                raise ValueError('Simulated IV escaped the validated pricing domain; no silent tail clipping')
            expiry=ql.DateParser.parseISO(c['expiryAt'][:10])
            values=reprice_paths(c,min(end,expiry),spots,ivs,price,deadline)*c['multiplier']
            pnl=(values-c['premiumPerContract'])*c['quantity']*(1 if c['side']=='long' else -1)
            per_currency.setdefault(c['currency'],np.zeros(PATHS));per_currency[c['currency']]+=pnl
            leg_paths[c['id']]=pnl;end_prices[c['id']]=values
            share_key=(c['accountId'],c['currency'],c['underlying'])
            if share_key not in shares:
                shares[share_key]=True
                final_spot=c['spot']*np.exp(moves[:,ai])
                distributions=sum(d['amount'] for d in c['dividends'] if today<ql.DateParser.parseISO(d['date'])<=end)+c['spot']*c.get('dividendYield',0.)*((end-today)/365.)
                per_currency[c['currency']]+=c['shares']*(final_spot-c['spot']+distributions)
        for currency,pnl in per_currency.items():
            q,es=tail_metrics(-pnl);interval=sampling_interval(-pnl,seed)
            if interval['upper']-interval['lower']>max(1.,abs(es)*.5):raise ValueError('Expected-shortfall Monte Carlo uncertainty is too large')
            output['metrics'].append(dict(currency=currency,var=q,expectedShortfall=es,probabilityOfProfit=float(np.mean(pnl>0)),expectedPnl=float(np.mean(pnl)),
                                          confidenceLevel=ALPHA,horizonTradingDays=horizon,samplingInterval=interval))
        hedge_values={}
        for h in optional:
            c=h['contract'];ai=assets.index(c['underlying']);ki=len(assets)+keys.index(contract_key(c))
            held_id=h['forContractId'];step=expiry_steps.get(held_id,horizon)
            spot_moves=recorded[step][:,ai] if 0<step<horizon else np.zeros(PATHS) if step==0 else moves[:,ai]
            spots=c['spot']*np.exp(spot_moves);ivs=c['impliedVolatility']*np.exp(moves[:,ki])
            if np.any(ivs>5) or np.any(ivs<.001):continue
            try:
                hedge_values[held_id]=reprice_paths(c,min(end,ql.DateParser.parseISO(c['expiryAt'][:10])),spots,ivs,price,deadline)*c['multiplier']
            except (ValueError,RuntimeError,TimeoutError):pass
        output.update(status='ready' if len(eligible)==len(contracts) else 'partial',reason='Factor-qualified physical simulation; covered positions only',paths=PATHS)
        output['coverage']['supportedPositions']=len(eligible)
        return output,dict(hedgeValues=hedge_values,pnl=per_currency,legs=leg_paths,endPrices=end_prices,contracts=eligible,moves=moves,assets=assets,keys=keys,recorded=recorded,expirySteps=expiry_steps)
    except (ValueError,TimeoutError,RuntimeError) as error:
        output.update(status='unavailable',reason=str(error),metrics=[],paths=0)
        return output,None
