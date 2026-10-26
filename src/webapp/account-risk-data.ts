import type { InvestorState } from '../state/portfolio-state.js';
import type { DashboardPayload } from './dashboard-data.js';
import { readBrokerAccountModel } from '../brokers/accounts.js';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const day = (value: string) => {
  const date = value.slice(0,10);
  const parsed = Date.parse(date + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10) === date ? parsed : NaN;
};
const age = (date: string | undefined, now: Date) => date && Number.isFinite(day(date)) ? Math.floor((now.getTime() - day(date)) / 86400000) : null;
export function buildAccountRisk(state: InvestorState, payload: DashboardPayload, now = new Date()) {
  const live = payload.model?.live;
  const valuationDate = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
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
    const options = positions.filter(p => p.instrument === 'option' && p.option);
    const shortOptions = options.filter(p => p.option?.side === 'short');
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
    const expiries = options.flatMap(p => {
      const o = p.option!;
      const dte = Math.round((day(o.expiry) - day(valuationDate)) / 86400000);
      return Number.isFinite(dte) && dte >= 0 && dte <= 14 ? [{ticker:p.ticker,underlying:o.underlying,expiry:o.expiry,right:o.right,side:o.side,strike:o.strike,contracts:p.units,dte,settlement:o.settlement}] : [];
    }).sort((a,b) => a.dte-b.dte || a.ticker.localeCompare(b.ticker));
    const upcoming = expiries.filter(p => p.side === 'short');
    const callDeliveries = shortOptions.filter(p => p.option!.right === 'call' && p.option!.settlement === 'physical').map(p => ({
      ticker:p.ticker,underlying:p.option!.underlying,expiry:p.option!.expiry,
      shares:finite(p.units) && p.units > 0 && finite(p.option!.multiplier) && p.option!.multiplier > 0 ? p.units * p.option!.multiplier : null,
    }));
    const assignmentCashGap = grossPutObligation !== null && cash !== null ? grossPutObligation > 0 ? Math.max(0,grossPutObligation-cash) : 0 : null;
    const excess = finite(metrics?.excess_liquidity) ? metrics.excess_liquidity : null;
    const buyingPower = finite(metrics?.buying_power) ? metrics.buying_power : null;
    const findings: Array<{kind:string;title:string;body:string;action:string;priority:number}> = [];
    if (metricsFresh && excess !== null && excess <= 0) findings.push({kind:'margin',title:'No reported margin cushion',body:'Excess liquidity is at or below zero in the broker snapshot.',action:'Check live margin and liquidation notices with your broker now.',priority:100});
    else if (metricsFresh && buyingPower === 0) findings.push({kind:'margin',title:'No reported buying power',body:'The broker snapshot reports zero capacity for new trades.',action:'Check live buying power before adding exposure.',priority:90});
    if (holdingsFresh && expiries.some(p => p.dte <= 1)) findings.push({kind:'expiry',title:expiries[0].dte === 0 ? 'Options expire today' : 'Options expire tomorrow',body:`${expiries.filter(p => p.dte <= 1).length} option lines need a settlement decision.`,action:'Confirm the broker’s last trading time, exercise cutoff and settlement instructions.',priority:95});
    if (holdingsFresh && assignmentCashGap !== null && assignmentCashGap > 0 && lines.length) findings.push({kind:'assignment',title:'Put assignment exceeds cash',body:'Gross purchases exceed recorded cash if all physical short puts are assigned.',action:'Review cash or closing alternatives in the broker’s margin preview.',priority:80});
    if (holdingsFresh && callDeliveries.length) findings.push({kind:'delivery',title:'Verify short-call share delivery',body:`${callDeliveries.length} physical short-call lines require shares if assigned.`,action:'Confirm deliverable shares and protective legs in this account.',priority:78});
    if (holdingsFresh && upcoming.length && !findings.some(f => f.kind === 'expiry')) findings.push({kind:'expiry',title:'Short options expire within 14 days',body:`${upcoming.length} short-option lines; nearest expiry in ${upcoming[0].dte} calendar days.`,action:'Review settlement funding and any protective leg before expiry.',priority:75});
    if (holdingsFresh && expiries.some(p => p.side === 'long') && !findings.some(f => f.kind === 'expiry')) findings.push({kind:'expiry',title:'Long options expire within 14 days',body:'Remaining option value can expire; exercise may create a stock or cash obligation.',action:'Review close, exercise and do-not-exercise instructions with your broker.',priority:70});
    if (holdingsFresh && concentration[0]?.share >= .5 && lines.length > 1) findings.push({kind:'concentration',title:`${concentration[0].underlying}: ${Math.round(concentration[0].share*100)}% of put obligations`,body:'Different strikes and expiries share the same underlying.',action:'Review combined exposure before adding another position in this name.',priority:60});
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
      currency:ccy,cash,grossPutObligation,assignmentCashGap,putLines:lines,concentration,upcoming,expiries,callDeliveries,
      nav:totals?.navComplete === true && finite(totals.totalValue) ? totals.totalValue : null,
      findings:findings.sort((a,b) => b.priority-a.priority),coverage,
      status:findings.some(f => f.priority === 100) ? 'urgent' : findings.length ? 'review' : 'unassessed'};
  }).sort((a,b) => (b.findings[0]?.priority ?? 0) - (a.findings[0]?.priority ?? 0));
  const overlap = new Map<string,Set<string>>();
  for (const account of accounts) for (const p of account.putLines) {
    if (!overlap.has(p.underlying)) overlap.set(p.underlying,new Set());
    overlap.get(p.underlying)!.add(account.channel);
  }
  return {generatedAt:now.toISOString(),valuationDate,calculatedAt:payload.generatedAt,currency:reportingCurrency,accounts,
    overlaps:[...overlap].filter(([,channels]) => channels.size > 1).map(([underlying,channels]) => ({underlying,channels:[...channels]}))};
}
