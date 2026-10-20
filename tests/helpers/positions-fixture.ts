export function positionsFixture(): any {
  const stock = (channel: string, units: number, avg: number) => ({ ticker:'AAPL@' + channel, channel, units, instrument:'equity', currency:'USD', avgCost:avg, price:100, cost:units * avg, value:units * 100, pl:units * (100 - avg), pricingMode:'live' });
  const option = (right: string, strike: number, units: number, mark: number) => ({ ticker:'AAPL-' + right, channel:'ibkr', units, instrument:'option', currency:'USD', pricingMode:'option',
    option:{ underlying:'AAPL', right, side:'short', strike, expiry:'2026-11-20', multiplier:100, settlement:'physical', mark },
    probabilityQuote:{ spot:100, mark, spotAsOf:'2026-10-20T20:00:00Z' },
    cost:-500 * units, value:-mark * units, pl:(500 - mark) * units,
    contingentCashObligation:right === 'put' ? strike * 100 * units : 0,
    contingentShareObligation:right === 'call' ? units * 100 : 0 });
  return { generatedAt:'2026-10-20T22:00:00Z', empty:false, brokerAsOf:{ ibkr:'2026-10-20', tiger:'2026-10-20' }, equityPrices:{ AAPL:100 },
    optionTradeDetails:{ 'AAPL-put':{ stoGrossPremium:500, currency:'USD' }, 'AAPL-call':{ stoGrossPremium:1000, currency:'USD' } },
    model:{ live:{ positions:[stock('ibkr', 100, 80), stock('tiger', 200, 90), option('put',120,1,2100),option('call',90,2,1100)],
      channels:['ibkr','tiger'], reportingCurrency:'USD', navComplete:true, totalValue:25000, cashAmount:3000,
      byChannel:[{ channel:'ibkr', totalValue:9000, cashAmount:1000 },{ channel:'tiger', totalValue:16000, cashAmount:2000 }], issues:[] } } };
}
