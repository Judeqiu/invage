import type { InvestorState } from '../state/portfolio-state.js';
import type { DashboardPayload } from './dashboard-data.js';
import { readBrokerAccountModel } from '../brokers/accounts.js';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const day = (value: string) => Date.parse(value.slice(0,10) + 'T00:00:00Z');
const age = (date: string | undefined, now: Date) => date && Number.isFinite(day(date)) ? Math.floor((now.getTime() - day(date)) / 86400000) : null;
export function buildAccountRisk(state: InvestorState, payload: DashboardPayload, now = new Date()) {
  const live = payload.model?.live;
  const connections = Object.values(readBrokerAccountModel(state).connections);
  const channels = [...new Set([...connections.map(c => c.channel),...(live?.channels ?? []),...(live?.positions ?? []).map(p => p.channel)])];
  const reportingCurrency = live?.reportingCurrency ?? live?.cashCurrency ?? null;
  const accounts = channels.map(channel => {
    const connection = connections.find(c => c.channel === channel);
    const totals = live?.byChannel.find(row => row.channel === channel);
    const positions = (live?.positions ?? []).filter(p => p.channel === channel);
    const metrics = connection?.metrics ?? payload.connectionMetrics?.[channel];
    const asOf = payload.brokerAsOf?.[channel] ?? connection?.last_sync?.as_of ?? null;
    const holdingsAge = age(asOf ?? undefined,now), metricsAge = age(metrics?.as_of,now);
    const holdingsFresh = holdingsAge !== null && holdingsAge >= 0 && holdingsAge <= 4;
    const metricsFresh = metricsAge !== null && metricsAge >= 0 && metricsAge <= 4;
    const ccy = reportingCurrency;
    const convert = (amount: number, currency: string | undefined) => {
      if (!finite(amount) || !currency || !ccy) return null;
      if (currency === ccy) return amount;
      const rate = live?.fxApplied ? live.fxRates?.[currency] : null;
      return finite(rate) && rate > 0 ? amount * rate : null;
    };
    const shortOptions = positions.filter(p => p.instrument === 'option' && p.option?.side === 'short');
    const puts = shortOptions.filter(p => p.option?.right === 'put' && p.option.settlement === 'physical');
    const lines = puts.map(p => {
      const o = p.option!;
      const valid = finite(p.units) && p.units > 0 && finite(o.strike) && o.strike > 0 && finite(o.multiplier) && o.multiplier > 0;
      return {ticker:p.ticker,underlying:o.underlying,expiry:o.expiry,strike:o.strike,contracts:p.units,
        nativeCurrency:p.currency ?? null,obligation:valid ? convert(o.strike * o.multiplier * p.units,p.currency) : null};
    });
    const skipped = connection?.last_sync?.not_imported ?? [];
    const complete = skipped.length === 0 && lines.every(p => p.obligation !== null);
    const grossPutObligation = complete ? lines.reduce((total,p) => total + p.obligation!,0) : null;
    const cash = finite(totals?.cashAmount) ? convert(totals.cashAmount,totals.cashCurrency ?? undefined) : null;
    const groups = new Map<string,number>();
    for (const p of lines) if (p.obligation !== null) groups.set(p.underlying,(groups.get(p.underlying) ?? 0) + p.obligation);
    const concentration = grossPutObligation !== null && grossPutObligation > 0 ? [...groups].map(([underlying,amount]) => ({underlying,amount,share:amount/grossPutObligation})).sort((a,b) => b.amount-a.amount) : [];
    const upcoming = shortOptions.flatMap(p => {
      const dte = Math.round((day(p.option!.expiry) - day(now.toISOString())) / 86400000);
      return Number.isFinite(dte) && dte >= 0 && dte <= 14 ? [{ticker:p.ticker,underlying:p.option!.underlying,expiry:p.option!.expiry,right:p.option!.right,contracts:p.units,dte,settlement:p.option!.settlement}] : [];
    }).sort((a,b) => a.dte-b.dte);
    const excess = finite(metrics?.excess_liquidity) ? metrics.excess_liquidity : null;
    const buyingPower = finite(metrics?.buying_power) ? metrics.buying_power : null;
    const findings: Array<{kind:string;title:string;body:string;priority:number}> = [];
    if (metricsFresh && excess !== null && excess <= 0) findings.push({kind:'margin',title:'No reported margin cushion',body:'The broker snapshot reports no excess liquidity. Check the live broker account before adding exposure; its requirements may have changed.',priority:100});
    else if (metricsFresh && buyingPower === 0) findings.push({kind:'margin',title:'No reported buying power',body:'The broker reports zero buying power. A cash balance does not establish capacity to open new positions.',priority:90});
    if (holdingsFresh && grossPutObligation !== null && cash !== null && grossPutObligation > cash) findings.push({kind:'assignment',title:'Put purchase obligations exceed recorded cash',body:'If every recorded physical short put were assigned, gross purchases would exceed cash in this account. This excludes hedge offsets and is not a margin-call forecast.',priority:80});
    if (holdingsFresh && upcoming.length) findings.push({kind:'expiry',title:'Short options expire within 14 days',body:'Review settlement and funding before expiry. Assignment can occur before expiry; this list does not predict whether it will happen.',priority:75});
    if (holdingsFresh && concentration[0]?.share >= .5 && lines.length > 1) findings.push({kind:'concentration',title:`${concentration[0].underlying} dominates put purchase obligations`,body:'Different strikes and expiries still depend on the same underlying. This measures gross put obligations, not portfolio loss or delta exposure.',priority:60});
    const coverage = [
      ...skipped.map(reason => `Broker import is incomplete: ${reason}`),
      ...(connection?.last_sync?.ok === false ? ['The most recent broker sync failed. Displayed figures come from the last available snapshot.'] : []),
      ...(live?.issues ?? []).filter(issue => issue.key === channel || positions.some(p => p.ticker === issue.key)).map(issue => issue.message),
      ...(!holdingsFresh ? ['Holdings are undated, future-dated, or more than four calendar days old. Structural findings need a current broker sync.'] : []),
      ...(!metricsFresh ? ['Current broker margin data is unavailable. Margin headroom cannot be assessed.'] : []),
      ...(excess === null ? ['Excess liquidity is not supplied by this connection.'] : []),
      ...(!complete ? ['A complete put obligation total is unavailable: some positions were not imported, or currency, FX, contract size, or quantity is missing.'] : []),
      ...(cash === null ? ['Account cash is unavailable in the reporting currency.'] : []),
      'Broker risk status, equity with loan value, and warning thresholds are not supplied. The exact broker warning trigger cannot be confirmed.',
    ];
    return {channel,label:connection?.label || payload.brokerChannels?.[channel]?.label || channel,
      brokerId:connection?.broker_id ?? payload.brokerChannels?.[channel]?.brokerId ?? null,
      asOf,holdingsFresh,metricsAsOf:metrics?.as_of ?? null,metricsFresh,metricsCurrency:metrics?.currency ?? null,
      excess,buyingPower,maintenanceMargin:finite(metrics?.maintenance_margin) ? metrics.maintenance_margin : null,
      currency:ccy,cash,grossPutObligation,putLines:lines,concentration,upcoming,
      nav:totals?.navComplete === true && finite(totals.totalValue) ? totals.totalValue : null,
      findings:findings.sort((a,b) => b.priority-a.priority),coverage,
      status:findings.some(f => f.priority === 100) ? 'urgent' : findings.length ? 'review' : 'unassessed'};
  }).sort((a,b) => (b.findings[0]?.priority ?? 0) - (a.findings[0]?.priority ?? 0));
  const overlap = new Map<string,Set<string>>();
  for (const account of accounts) for (const p of account.putLines) {
    if (!overlap.has(p.underlying)) overlap.set(p.underlying,new Set());
    overlap.get(p.underlying)!.add(account.channel);
  }
  return {generatedAt:now.toISOString(),calculatedAt:payload.generatedAt,currency:reportingCurrency,accounts,
    overlaps:[...overlap].filter(([,channels]) => channels.size > 1).map(([underlying,channels]) => ({underlying,channels:[...channels]}))};
}
