import { mkdir, rename, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { resolveDataRoot } from 'utarus';
import { readBrokerAccountModel, combinedCredentials } from '../brokers/accounts.js';
import { getPortfolio } from '../state/portfolio-state.js';
import { moomooMarketData } from '../moomoo/moomoo-client.js';
import { parseSignAlg } from '../moomoo/moomoo-sign.js';
import type { MooMooCredentials } from '../moomoo/moomoo-client.js';
import type { InvestorSnapshot } from '../state/investor-store.js';
import { validDate } from '../brokers/option-executions.js';
import { digest } from './context.js';
import type { RiskMarketContract, RiskMarketSnapshot } from './types.js';

const day = 86400_000;
export const RATE_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
type Row = Record<string, any>;
type Rate = { date: string; percent: number; rate: number; reference: string };

/** Published constant-maturity yield as a disclosed flat-rate proxy. Never zero-fill. */
export function fredRate(csv: string, asOf: string, now = Date.now()): Rate {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.shift() !== 'observation_date,DGS1') throw new Error('Unexpected official rate series');
  const values = lines.flatMap(line => {
    const [date, raw] = line.split(',');
    const percent = raw?.trim() ? Number(raw) : NaN;
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= asOf && Number.isFinite(percent) && percent > -5 && percent < 50 ? [{ date, percent }] : [];
  }).sort((a,b) => b.date.localeCompare(a.date));
  const value = values[0];
  if (!value || now - Date.parse(value.date + 'T00:00:00Z') > 7 * day || Date.parse(value.date) > now) throw new Error('Official rate observation missing or stale');
  return { ...value, rate: 2 * Math.log1p(value.percent / 200),
    reference: `FRED DGS1 ${value.date}: ${value.percent}% investment-basis yield; semiannual-to-continuous flat 1-year proxy` };
}

/** NY offset at this date; this provider admits standard stock/ETF options. */
export function equityExpiry(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error('Invalid expiry date');
  const part = new Intl.DateTimeFormat('en', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
    .formatToParts(new Date(date + 'T16:00:00Z')).find(p => p.type === 'timeZoneName')!.value;
  return date + 'T16:00:00' + part.replace('GMT','');
}

/** Known forward cash amounts where available; otherwise a disclosed trailing-yield estimate. */
export function cashDividendInputs(stock: Row, data: Row | null | undefined, spot: number, now: number) {
  const today = new Date(now).toISOString().slice(0,10);
  const announced = Array.isArray(data?.dividend_list) ? data.dividend_list.flatMap((d: Row) => {
    const date = typeof d.ex_date === 'string' ? d.ex_date.replaceAll('/','-') : '';
    return validDate(date) && date > today && Date.parse(date) <= now + 10*366*day && d.currency === 'USD' && Number.isFinite(d.dividend_per_share) && d.dividend_per_share > 0
      ? [{date,amount:d.dividend_per_share as number}] : [];
  }) : [];
  // Duplicate corporate-action records cannot double the cash amount.
  const dividends = [...new Map(announced.map((d: {date:string;amount:number}) => [JSON.stringify(d),d])).values()] as {date:string;amount:number}[];
  if (dividends.length) return {dividends,dividendYield:0,reference:'Announced future cash dividends; assumes no additional unannounced distributions'};
  if (!Number.isFinite(stock.dividend_ttm) || stock.dividend_ttm < 0 || stock.dividend_ttm > spot) return null;
  const dividendYield = stock.dividend_ttm / spot;
  return {dividends:[],dividendYield,reference:`Estimated continuous distribution yield ${(dividendYield*100).toFixed(6)}% from reported TTM cash distributions ${stock.dividend_ttm} USD / underlying price ${spot} USD; trailing proxy, not a verified forward schedule`};
}

async function limitedMap<T, R>(items: T[], fn: (item:T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    for (;;) { const i = index++; if (i >= items.length) return; results[i] = await fn(items[i]); }
  }));
  return results;
}

/** Uses only this investor's connected source, including for their other custodians.
 * Network collection runs in the leased queue, never in dashboard rendering. */
export async function collectConnectedRiskMarket(snapshot: InvestorSnapshot, accountIds: string[], options: {
  fetchImpl?: typeof fetch; now?: number;
} = {}): Promise<RiskMarketSnapshot> {
  const now = options.now ?? Date.now(), baseFetch = options.fetchImpl ?? fetch;
  const deadline = AbortSignal.timeout(45_000);
  const fetchImpl: typeof fetch = async (url, init) => {
    const response = await baseFetch(url, { ...init, signal: AbortSignal.any([deadline, AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]) });
    // Bound the provider's body before any JSON/CSV parsing.
    const reader = response.body?.getReader(); if (!reader) return response;
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('Market response too large'); } chunks.push(value); }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  };
  const holdings = Object.entries(getPortfolio(snapshot.state)).filter(([,h]) => h.instrument === 'option' && h.option && h.units !== 0 && accountIds.includes(h.channel || 'default'));
  if (holdings.length > 100) throw new Error('Too many option positions');
  const market: RiskMarketSnapshot = { id: '', portfolioRevision: snapshot.revision, capturedAt: new Date(now).toISOString(),
    metadataVersion: 'futu-standard-us-equity-v2', contracts: [], exclusions: [] };
  const exclude = (id: string, reason: string) => market.exclusions!.push({ id, reason });
  const model = readBrokerAccountModel(snapshot.state);
  const source = Object.values(model.connections).find(c => c.enabled && ['futubull','moomoo'].includes(c.broker_id) && !!combinedCredentials(model,c).app_key && !!combinedCredentials(model,c).private_key);
  if (!source) { holdings.forEach(([id]) => exclude(id,'No connected Cloud market-data source')); market.id = digest(market); return market; }
  const saved = combinedCredentials(model,source);
  const credentials: MooMooCredentials = { broker: source.broker_id as 'futubull'|'moomoo', app_key:saved.app_key, private_key:saved.private_key, sign_alg:parseSignAlg(saved.sign_alg) };
  const query = (path: string, body?: Row, params?: Record<string,string>) => moomooMarketData({path, body, query:params?new URLSearchParams(params).toString():undefined, credentials, fetchImpl});
  const eligible = holdings.filter(([id,h]) => {
    const o=h.option!;
    if (h.currency !== 'USD' || o.multiplier !== 100 || o.settlement !== 'physical' || !/^[A-Z][A-Z0-9]{0,14}$/.test(o.underlying) || !Number.isFinite(o.strike) || o.strike<=0) {
      exclude(id,'Connected provider currently verifies standard USD stock options only'); return false;
    }
    return true;
  });
  const code = (h: typeof eligible[number][1]) => { const o=h.option!; return `US.${o.underlying}${o.expiry.replaceAll('-','').slice(2)}${o.right==='put'?'P':'C'}${Math.round(o.strike*1000)}`; };
  const codes = [...new Set(eligible.flatMap(([,h]) => [code(h), 'US.'+h.option!.underlying]))];
  if (!codes.length) { market.id=digest(market); return market; }
  let quotes: Row[], snapshots: Row[], basics: Row[], csv: string;
  try {
    const start=new Date(now-20*day).toISOString().slice(0,10);
    const [q,s,b,rate] = await Promise.all([
      query('/api/v1.0/quote/stock-quote',{code_list:codes}), query('/api/v1.0/quote/snapshot',{code_list:codes}),
      query('/api/v1.0/quote/stock-basicinfo',{code_list:codes}),
      fetchImpl(`${RATE_URL}?id=DGS1&cosd=${start}`).then(async r => {if(!r.ok)throw new Error('Rate source unavailable');return r.text();}),
    ]);
    if (!Array.isArray(q.quote_list) || !Array.isArray(s.snapshot_list) || !Array.isArray(b.basic_list)) throw new Error('Malformed quote data');
    quotes=q.quote_list; snapshots=s.snapshot_list; basics=b.basic_list;csv=rate;
  } catch { eligible.forEach(([id])=>exclude(id,'Connected broker quotes or official interest-rate source unavailable')); market.id=digest(market); return market; }
  const unique = (rows:Row[], symbol:string) => { const found=rows.filter(r=>r.code===symbol);return found.length===1?found[0]:undefined; };
  const groups = [...new Set(eligible.map(([,h])=>`${h.option!.underlying}|${h.option!.expiry}`))];
  const chains = new Map(await limitedMap(groups,async key => {
    const [underlying,expiry]=key.split('|');
    try {return [key,await query(`/api/v1.0/quote/US.${underlying}/option-chain`,undefined,{start:expiry,end:expiry})] as const;}
    catch {return [key,null] as const;}
  }));
  const names=[...new Set(eligible.map(([,h])=>h.option!.underlying))];
  const dividends = new Map(await limitedMap(names,async name => {
    try {return [name,await query(`/api/v1.0/quote/US.${name}/corporate-actions/dividends`)] as const;}
    catch {return [name,null] as const;}
  }));
  for (const [id,h] of eligible) {
    const o=h.option!, symbol='US.'+o.underlying, optionCode=code(h);
    const q=unique(quotes,optionCode),spot=unique(quotes,symbol),stock=unique(snapshots,symbol),basic=unique(basics,symbol);
    const chain=chains.get(`${o.underlying}|${o.expiry}`)?.option_chain;
    const matches=Array.isArray(chain)?chain.filter((r:Row)=>r.code===optionCode&&r.stock_owner===symbol&&r.strike_time===o.expiry&&r.strike_price===o.strike&&r.option_type===o.right.toUpperCase()):[];
    const terms=matches.length===1?matches[0]:undefined,ex=q?.option_ex_data;
    if (!q || !spot || !stock || !['STOCK','ETF'].includes(basic?.stock_type) || !terms || terms.option_standard_type!=='STANDARD' || terms.lot_size!==100 || ex?.contract_size!==100 || ex.contract_multiplier!==100 || ex.option_area_type!=='AMERICAN' || ex.strike_price!==o.strike || ex.option_type!==o.right.toUpperCase()) {
      exclude(id,'Exact standard stock-option contract or exercise terms could not be verified');continue;
    }
    if (q.suspension || spot.suspension || ![q.data_time,spot.data_time,q.last_price,spot.last_price,ex.implied_volatility].every(Number.isFinite) || q.last_price<=0 || spot.last_price<=0 || ex.implied_volatility<1 || ex.implied_volatility>500 ||
        Math.min(q.data_time,spot.data_time)<=0 || Math.max(q.data_time,spot.data_time)>now+60_000) {
      exclude(id,'Option price, underlying price, implied volatility or quote timestamp is missing or invalid');continue;
    }
    const dividend = cashDividendInputs(stock,dividends.get(o.underlying),spot.last_price,now);
    if (!dividend) {exclude(id,'No announced dividend schedule or reported trailing cash-distribution amount is available');continue;}
    let rate:Rate;
    try {rate=fredRate(csv,new Date(now).toISOString().slice(0,10),now);}
    catch {exclude(id,'A recent official rate observation at or before valuation is unavailable');continue;}
    const contract: RiskMarketContract = { id, underlying:o.underlying,right:o.right,strike:o.strike,multiplier:100,currency:'USD',exerciseStyle:'american',
      expiryAt:equityExpiry(o.expiry),expiryTimezone:'America/New_York',deliverable:'standard-shares',spot:spot.last_price,
      premiumPerContract:q.last_price*100,impliedVolatility:ex.implied_volatility/100,rate:rate.rate,dividends:dividend.dividends,dividendYield:dividend.dividendYield,
      quoteAsOf:new Date(q.data_time).toISOString(),spotAsOf:new Date(spot.data_time).toISOString(),
      source:`${source.broker_id} Cloud stock-quote last trade; exact option-chain STANDARD + AMERICAN; OCC stock-option settlement/cutoff`,
      rateReference:rate.reference,dividendReference:`${source.broker_id} ${dividend.reference}; checked ${market.capturedAt}` };
    market.contracts.push(contract);
  }
  market.id=digest(market);return market;
}

export async function writeRiskMarketSnapshot(owner: string, market: RiskMarketSnapshot): Promise<void> {
  const dir=join(resolveDataRoot(),'option-risk','market');await mkdir(dir,{recursive:true,mode:0o700});
  const path=join(dir,digest(owner)+'.json'), temporary=path+'.'+randomUUID()+'.tmp';
  try {await writeFile(temporary,JSON.stringify(market),{flag:'wx',mode:0o600});await rename(temporary,path);}
  finally {await unlink(temporary).catch(()=>{});}
}

export async function deleteRiskMarketSnapshot(owner: string): Promise<void> {
  await unlink(join(resolveDataRoot(),'option-risk','market',digest(owner)+'.json')).catch(error=>{if(error.code!=='ENOENT')throw error;});
}
let lastPrune = 0;
export async function pruneRiskMarketSnapshots(now = Date.now()): Promise<void> {
  if (now-lastPrune < 3600_000) return;
  lastPrune=now;
  const dir=join(resolveDataRoot(),'option-risk','market');
  let names:string[];
  try {names=await readdir(dir);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  for(const name of names)if(/^[a-f0-9]{64}\.json$/.test(name)) {
    const path=join(dir,name);
    if(now-(await stat(path)).mtimeMs>30*day)await unlink(path);
  }
}
