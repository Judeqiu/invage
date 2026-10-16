"""Read-only comparisons on common terminal marked-wealth basis.

Only initial execution costs are charged; no assumed future liquidation. Quotes
are indicative and execution/funding is never promised.
"""
import time
import QuantLib as ql
from forecast import tail_metrics, sampling_interval, ALPHA


def compare(inputs, contracts, scenarios, end, price, paths, forecast, deadline=float('inf')):
    cost = inputs.get('costModel')
    if not cost:
        return []
    quotes = {r['contractId']: r['quote'] for r in inputs.get('executionQuotes', [])}
    hedges = {r['forContractId']: r for r in inputs.get('hedges', [])}
    actions = []
    for currency in sorted({c['currency'] for c in contracts}):
        base = {s['id']: next(r['combinedPnl'] for r in s['byCurrency'] if r['currency'] == currency) for s in scenarios}
        def metric(pnl):
            q, es = tail_metrics(-pnl)
            return dict(currency=currency, var=q, expectedShortfall=es, probabilityOfProfit=float((pnl>0).mean()),
                        expectedPnl=float(pnl.mean()), confidenceLevel=ALPHA, horizonTradingDays=inputs['horizonTradingDays'],
                        samplingInterval=sampling_interval(-pnl, forecast['seed']))
        # Action probabilistic comparisons require the entire priced currency scope.
        full = paths and all(c['id'] in paths['legs'] for c in contracts if c['currency']==currency)
        def row(kind, c=None):
            return dict(id=f"{kind}:{c['id'] if c else currency}", kind=kind, status='unavailable',
                        label=f"{kind.title()} {c['id'] if c else currency}", accountId=c['accountId'] if c else None,
                        contractId=c['id'] if c else None, currency=currency, reason='', initialCashFlow=None,
                        estimatedInitialFees=None, funding='unknown', liquidity='unknown', quote=None, costModel=cost,
                        scenarios=[], stressLoss=None, forecast=None)
        hold=row('hold');hold.update(status='ready',reason='Terminal marked wealth; no initial trade or future liquidation fees',initialCashFlow=0.,estimatedInitialFees=0.,funding='not-required',
                                    scenarios=[dict(id=k,pnl=v) for k,v in base.items()],stressLoss=max(0.,-min(base.values())),
                                    forecast=metric(paths['pnl'][currency]) if full else None)
        actions.append(hold)
        for c in contracts:
            if c['currency']!=currency:continue
            for kind in ['close']+(['hedge'] if c['side']=='short' else []):
                out=row(kind,c);actions.append(out)
                if time.monotonic()>deadline:
                    out['reason']='Comparison numerical budget exhausted; recalculate a narrower account scope';continue
                hedge=hedges.get(c['id']);quote=quotes.get(c['id']) if kind=='close' else hedge['quote'] if hedge else None
                if not quote:
                    out['reason']='A matching current bid/ask quote or verified further-OTM hedge is unavailable';continue
                buy=kind=='hedge' or c['side']=='short'
                px=quote['ask']*(1+cost['slippageBps']/10000) if buy else quote['bid']*(1-cost['slippageBps']/10000)
                fee=max(cost['minimumOrderFee'],cost['feePerContract']*c['quantity'])
                cash=(-1 if buy else 1)*px*c['quantity']*c['multiplier']-fee
                account=next((a for a in inputs['accounts'] if a['accountId']==c['accountId'] and a['currency']==currency),None)
                funding='not-required' if cash>=0 else 'unknown' if not account or account['cash'] is None else 'sufficient' if account['cash']>=-cash else 'insufficient'
                size=quote['askSize'] if buy else quote['bidSize']
                out.update(status='ready',quote=quote,initialCashFlow=cash,estimatedInitialFees=fee,funding=funding,
                           liquidity='unknown' if size is None else 'sufficient' if size>=c['quantity'] else 'insufficient',
                           reason='Indicative bid/ask with estimated fees and adverse slippage, charged once. Terminal marked wealth; future liquidation excluded. No fill or margin guarantee.')
                try:
                    for s in scenarios:
                        if kind=='close':
                            terminal=price(c,min(end,ql.DateParser.parseISO(c['expiryAt'][:10])),c['spot']*(1+s['spotShock']),max(.001,c['impliedVolatility']+s['volatilityPointShock']/100),grid=400)*c['multiplier']*c['quantity']
                            change=cash-terminal*(1 if c['side']=='long' else -1)
                        else:
                            h=hedge['contract']
                            terminal=price(h,min(end,ql.DateParser.parseISO(h['expiryAt'][:10])),h['spot']*(1+s['spotShock']),max(.001,h['impliedVolatility']+s['volatilityPointShock']/100),grid=400)*h['multiplier']*c['quantity']
                            change=cash+terminal
                        out['scenarios'].append(dict(id=s['id'],pnl=base[s['id']]+change))
                    out['stressLoss']=max(0.,-min(r['pnl'] for r in out['scenarios']))
                    if kind=='close' and full:
                        signed_mark=c['premiumPerContract']*c['quantity']*(1 if c['side']=='long' else -1)
                        out['forecast']=metric(paths['pnl'][currency]-paths['legs'][c['id']]+cash-signed_mark)
                    elif kind=='hedge' and full and c['id'] in paths.get('hedgeValues',{}):
                        out['forecast']=metric(paths['pnl'][currency]+cash+paths['hedgeValues'][c['id']]*c['quantity'])
                    elif kind=='hedge':
                        out['reason']+=' Hedge probabilities are unavailable without independently qualified hedge IV history.'
                except (ValueError,RuntimeError,TimeoutError):
                    out.update(status='unavailable',reason='Comparison pricing or sampling checks failed',scenarios=[],stressLoss=None,forecast=None)

    return actions
