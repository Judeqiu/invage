import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { accessSync, constants } from 'node:fs';
import { validDate } from '../brokers/option-executions.js';
import { resolveDataRoot } from 'utarus';
import { readDashboardConfig, readOptionRiskCostModel } from '../webapp/dashboard-config.js';
import { readProductProfile } from '../agents/roster.js';
import { holdingBaseKey } from '../market/position-value.js';
import { getCashes, getPortfolio } from '../state/portfolio-state.js';
import type { InvestorSnapshot } from '../state/investor-store.js';
import { ENGINE_VERSION, SCENARIO_SET, riskContractKey, type RiskInputs, type RiskMarketSnapshot, type RiskRequest } from './types.js';

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const riskEnabled = () => readDashboardConfig().showOptionRiskModelView && readProductProfile() === 'consultant';
export function riskConfigured(): boolean {
  const binary = process.env.INVAGE_OPTION_RISK_PYTHON;
  if (!process.env.INVAGE_OPTION_RISK_CONTEXT_SECRET || !process.env.INVAGE_BOOKS_DATABASE_URL || !binary || !isAbsolute(binary)) return false;
  try { accessSync(binary, constants.X_OK); return true; } catch { return false; }
}
export function analysisContext(snapshot: InvestorSnapshot): string | null {
  const secret = process.env.INVAGE_OPTION_RISK_CONTEXT_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(JSON.stringify([snapshot.state.user.id, snapshot.revision, ENGINE_VERSION, readOptionRiskCostModel()])).digest('hex');
}
export class RiskError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function parseRiskRequest(raw: unknown): RiskRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RiskError(400, 'Invalid analysis request');
  const r = raw as RiskRequest;
  const keys = ['analysisContextId', 'accountScope', 'horizonTradingDays', 'scenarioSet', 'mode', 'refresh'];
  if (Object.keys(r).some(k => !keys.includes(k)) || Object.keys(r).length !== keys.length ||
      typeof r.analysisContextId !== 'string' || !/^[a-f0-9]{64}$/.test(r.analysisContextId) ||
      ![1, 5, 21].includes(r.horizonTradingDays) || r.mode !== 'conditional' || r.scenarioSet !== SCENARIO_SET || typeof r.refresh !== 'boolean' ||
      !r.accountScope || typeof r.accountScope !== 'object' || Object.keys(r.accountScope).sort().join() !== 'accountIds,kind' ||
      !['all', 'selected'].includes(r.accountScope.kind) || !Array.isArray(r.accountScope.accountIds) ||
      r.accountScope.accountIds.length > 50 || r.accountScope.accountIds.some(x => typeof x !== 'string' || !x || x.length > 120) ||
      new Set(r.accountScope.accountIds).size !== r.accountScope.accountIds.length ||
      (r.accountScope.kind === 'all' ? r.accountScope.accountIds.length !== 0 : r.accountScope.accountIds.length === 0)) throw new RiskError(400, 'Invalid analysis request');
  return { ...r, accountScope: { ...r.accountScope, accountIds: [...r.accountScope.accountIds].sort() } };
}
export async function readRiskMarketSnapshot(userId: string): Promise<RiskMarketSnapshot | null> {
  // A provider writes atomic, private snapshots. An absent feed is not permission to
  // infer contract metadata or turn the legacy probability quote into model data.
  try {
    const path = join(resolveDataRoot(), 'option-risk', 'market', digest(userId) + '.json');
    const { stat } = await import('node:fs/promises');
    if ((await stat(path)).size > 32 * 1024 * 1024) return null;
    return JSON.parse(await readFile(path, 'utf8'));
  } catch { return null; }
}
export function normalizeRiskInputs(snapshot: InvestorSnapshot, request: RiskRequest, market: RiskMarketSnapshot | null, now = Date.now()): RiskInputs {
  if (request.analysisContextId !== analysisContext(snapshot)) throw new RiskError(409, 'Portfolio context changed. Refresh the dashboard.');
  const portfolio = getPortfolio(snapshot.state);
  const accounts = [...new Set(Object.values(portfolio).map(h => h.channel || 'default'))];
  if (request.accountScope.accountIds.some(a => !accounts.includes(a))) throw new RiskError(400, 'Unknown account scope');
  const selected = request.accountScope.kind === 'all' ? accounts : request.accountScope.accountIds;
  const entries = Object.entries(portfolio).filter(([, h]) => h.instrument === 'option' && h.option && h.units !== 0 && selected.includes(h.channel || 'default'));
  const validTimestamp = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s)) && Date.parse(s) <= now + 60_000;
  const usable = market && typeof market.id === 'string' && !!market.id && typeof market.metadataVersion === 'string' && !!market.metadataVersion &&
    market.portfolioRevision === snapshot.revision && validTimestamp(market.capturedAt) && Array.isArray(market.contracts);
  const inputs: RiskInputs = { analysisContextId: request.analysisContextId, portfolioRevision: String(snapshot.revision),
    marketSnapshotId: usable ? market.id : 'unavailable', metadataVersion: usable ? market.metadataVersion : 'unavailable',
    marketAsOf: usable ? market.capturedAt : null, valuationDate: new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now), accountIds: selected, horizonTradingDays: request.horizonTradingDays, contracts: [], accounts: [],
    coverage: { totalContracts: entries.length, supportedContracts: 0, totalQuantity: entries.reduce((s, [, h]) => s + Math.abs(h.units), 0), supportedQuantity: 0, exclusions: [] } };
  for (const [id, h] of entries) {
    const o = h.option!;
    const matches = usable ? market.contracts.filter(c => c && c.id === id) : [];
    const c = matches.length === 1 ? matches[0] : undefined;
    let reason = '';
    if (!c) reason = market?.exclusions?.find(e=>e.id===id)?.reason || 'Validated contract metadata and market snapshot unavailable';
    else if (!/^[A-Z]{3}$/.test(c.currency || '') || c.underlying !== o.underlying || c.right !== o.right || c.strike !== o.strike || c.multiplier !== o.multiplier || c.currency !== h.currency ||
      c.expiryAt?.slice(0, 10) !== o.expiry || c.deliverable !== 'standard-shares' || c.multiplier !== 100 || o.settlement !== 'physical' ||
      c.expiryTimezone !== 'America/New_York' || !['american', 'european'].includes(c.exerciseStyle)) reason = 'Unsupported or mismatched contract metadata/deliverable';
    else if (!validTimestamp(c.quoteAsOf) || !validTimestamp(c.spotAsOf) ||
      !Number.isFinite(Date.parse(c.expiryAt)) || Date.parse(c.expiryAt) <= now ||
      ![c.source, c.rateReference, c.dividendReference].every(v => typeof v === 'string' && v.trim().length > 0 && v.length <= 500) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(c.expiryAt)) reason = 'Missing or invalid quote, rate, dividend or expiry provenance';
    else if (![c.spot, c.premiumPerContract, c.impliedVolatility, c.rate, h.units].every(Number.isFinite) || c.spot <= 0 || c.premiumPerContract < 0 ||
      Date.parse(c.expiryAt) - now > 10 * 366 * 86400_000 || c.impliedVolatility < 0.01 || c.impliedVolatility > 5 || Math.abs(c.rate) > 0.5 || !Number.isSafeInteger(h.units) || h.units <= 0 || h.units > 1_000_000 ||
      (c.dividendYield !== undefined && (!Number.isFinite(c.dividendYield) || c.dividendYield < 0 || c.dividendYield > 1)) ||
      !Array.isArray(c.dividends) || c.dividends.length > 100 || c.dividends.some(d => !d || !validDate(d.date) || !Number.isFinite(d.amount) || d.amount < 0)) reason = 'Invalid financial inputs';
    if (reason || !c) { inputs.coverage.exclusions.push({ id, quantity: Math.abs(h.units), reason }); continue; }
    // All related shares affect wealth; only free shares can cover delivery in this account.
    const shareLots = Object.entries(portfolio).filter(([key, p]) => (p.instrument === undefined || p.instrument === 'equity') &&
      (p.channel || 'default') === (h.channel || 'default') && p.currency === c.currency && holdingBaseKey(key) === o.underlying);
    const shares = shareLots.reduce((s, [, p]) => s + p.units, 0);
    const freeShares = shareLots.reduce((s, [, p]) => s + p.units - (p.encumbrance?.units || 0), 0);
    // Allowlist only model inputs: provider extensions/credentials are never copied.
    inputs.contracts.push({ id, underlying: c.underlying, right: c.right, strike: c.strike, multiplier: c.multiplier,
      currency: c.currency, exerciseStyle: c.exerciseStyle, expiryAt: c.expiryAt, expiryTimezone: c.expiryTimezone,
      deliverable: c.deliverable, spot: c.spot, premiumPerContract: c.premiumPerContract, impliedVolatility: c.impliedVolatility,
      rate: c.rate, dividendYield: c.dividendYield, dividends: c.dividends.map(d => ({ date: d.date, amount: d.amount })), quoteAsOf: c.quoteAsOf,
      spotAsOf: c.spotAsOf, source: c.source, rateReference: c.rateReference, dividendReference: c.dividendReference,
      accountId: h.channel || 'default', quantity: h.units, side: o.side, shares, freeShares });
  }
  if (inputs.contracts.length) inputs.marketAsOf = inputs.contracts.flatMap(c => [c.quoteAsOf, c.spotAsOf]).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  inputs.coverage.supportedContracts = inputs.contracts.length;
  inputs.coverage.supportedQuantity = inputs.contracts.reduce((s, c) => s + c.quantity, 0);
  for (const accountId of selected) for (const currency of new Set(inputs.contracts.filter(c => c.accountId === accountId).map(c => c.currency))) {
    const balances = getCashes(snapshot.state).filter(c => (c.channel || 'default') === accountId && c.currency === currency);
    inputs.accounts.push({ accountId, currency, cash: balances.length ? balances.reduce((s, c) => s + c.amount, 0) : null,
      cashAsOf: balances.length ? balances.map(c => c.updated_at).sort()[0] : null });
  }
  inputs.costModel = readOptionRiskCostModel();
  if (usable) {
    const validQuote=(q: import('./types.js').RiskExecutionQuote) => q&&[q.bid,q.ask].every(Number.isFinite)&&q.bid>=0&&q.ask>0&&q.ask>=q.bid&&
      [q.bidSize,q.askSize].every(v=>v===null||Number.isFinite(v)&&v>=0)&&validTimestamp(q.fetchedAt)&&now-Date.parse(q.fetchedAt)<=900000&&
      (q.quoteAsOf===null||validTimestamp(q.quoteAsOf))&&typeof q.source==='string'&&q.source.length>0&&q.source.length<=1000;
    const quoteCopy=(q: import('./types.js').RiskExecutionQuote) => ({bid:q.bid,ask:q.ask,bidSize:q.bidSize,askSize:q.askSize,fetchedAt:q.fetchedAt,quoteAsOf:q.quoteAsOf,source:q.source});
    const quotes=market.executionQuotes??[];
    inputs.executionQuotes=quotes.filter(e=>inputs.contracts.some(c=>c.id===e.contractId)&&quotes.filter(x=>x.contractId===e.contractId).length===1&&validQuote(e.quote))
      .map(e=>({contractId:e.contractId,quote:quoteCopy(e.quote)}));
    inputs.hedges=(market.hedges??[]).flatMap(h=>{
      const held=inputs.contracts.find(c=>c.id===h.forContractId),c=h.contract;
      if(!held||held.side!=='short'||!c||!validQuote(h.quote)||c.underlying!==held.underlying||c.right!==held.right||c.expiryAt!==held.expiryAt||
        c.currency!==held.currency||c.multiplier!==held.multiplier||c.exerciseStyle!==held.exerciseStyle||c.deliverable!==held.deliverable||
        !Number.isFinite(c.strike)||c.strike<=0||!(held.right==='put'?c.strike<held.strike:c.strike>held.strike)||
        !Number.isFinite(c.impliedVolatility)||c.impliedVolatility<.01||c.impliedVolatility>5||!Number.isFinite(c.premiumPerContract)||c.premiumPerContract<0||!validTimestamp(c.quoteAsOf))return [];
      // Rate/dividend/spot inputs are inherited from the verified same underlying.
      return [{forContractId:held.id,contract:{...held,id:c.id,strike:c.strike,impliedVolatility:c.impliedVolatility,premiumPerContract:c.premiumPerContract,quoteAsOf:c.quoteAsOf},quote:quoteCopy(h.quote)}];
    });
    const keys=new Set([...inputs.contracts,...(inputs.hedges??[]).map(h=>h.contract)].map(riskContractKey));
    const histories=market.histories??[];
    inputs.histories=histories.filter(h=>h&&keys.has(h.key)&&histories.filter(x=>x?.key===h.key).length===1&&
      typeof h.source==='string'&&h.source.length>0&&h.source.length<=1000&&Array.isArray(h.dates)&&Array.isArray(h.spots)&&Array.isArray(h.ivs)&&
      h.dates.length===h.spots.length&&h.dates.length===h.ivs.length&&h.dates.every((d,i)=>validDate(d)&&d<inputs.valuationDate!&&(i===0||d>h.dates[i-1]))&&
      h.spots.every(v=>Number.isFinite(v)&&v>0)&&h.ivs.every(v=>Number.isFinite(v)&&v>=.01&&v<=5))
      .map(h=>({key:h.key,dates:[...h.dates],spots:[...h.spots],ivs:[...h.ivs],source:h.source}));

  }
  return inputs;
}
