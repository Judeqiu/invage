import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { accessSync, constants } from 'node:fs';
import { validDate } from '../brokers/option-executions.js';
import { resolveDataRoot } from 'utarus';
import { readDashboardConfig } from '../webapp/dashboard-config.js';
import { readProductProfile } from '../agents/roster.js';
import { holdingBaseKey } from '../market/position-value.js';
import { getCashes, getPortfolio } from '../state/portfolio-state.js';
import type { InvestorSnapshot } from '../state/investor-store.js';
import { ENGINE_VERSION, SCENARIO_SET, type RiskInputs, type RiskMarketSnapshot, type RiskRequest } from './types.js';

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
  return createHmac('sha256', secret).update(JSON.stringify([snapshot.state.user.id, snapshot.revision, ENGINE_VERSION])).digest('hex');
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
    if ((await stat(path)).size > 2 * 1024 * 1024) return null;
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
  if (entries.length > 100) throw new RiskError(400, 'Analysis supports at most 100 contract positions');
  const recent = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s)) && Date.parse(s) <= now + 60_000 && now - Date.parse(s) <= 24 * 3600_000;
  const usable = market && typeof market.id === 'string' && !!market.id && typeof market.metadataVersion === 'string' && !!market.metadataVersion &&
    market.portfolioRevision === snapshot.revision && recent(market.capturedAt) && Array.isArray(market.contracts);
  const inputs: RiskInputs = { analysisContextId: request.analysisContextId, portfolioRevision: String(snapshot.revision),
    marketSnapshotId: usable ? market.id : 'unavailable', metadataVersion: usable ? market.metadataVersion : 'unavailable',
    marketAsOf: usable ? market.capturedAt : null, accountIds: selected, horizonTradingDays: request.horizonTradingDays, contracts: [], accounts: [],
    coverage: { totalContracts: entries.length, supportedContracts: 0, totalQuantity: entries.reduce((s, [, h]) => s + Math.abs(h.units), 0), supportedQuantity: 0, exclusions: [] } };
  for (const [id, h] of entries) {
    const o = h.option!;
    const matches = usable ? market.contracts.filter(c => c && c.id === id) : [];
    const c = matches.length === 1 ? matches[0] : undefined;
    let reason = '';
    if (!c) reason = 'Validated contract metadata and market snapshot unavailable';
    else if (!/^[A-Z]{3}$/.test(c.currency || '') || c.underlying !== o.underlying || c.right !== o.right || c.strike !== o.strike || c.multiplier !== o.multiplier || c.currency !== h.currency ||
      c.expiryAt?.slice(0, 10) !== o.expiry || c.deliverable !== 'standard-shares' || c.multiplier !== 100 || o.settlement !== 'physical' ||
      c.expiryTimezone !== 'America/New_York' || !['american', 'european'].includes(c.exerciseStyle)) reason = 'Unsupported or mismatched contract metadata/deliverable';
    else if (!recent(c.quoteAsOf) || !recent(c.spotAsOf) || Math.abs(Date.parse(c.quoteAsOf) - Date.parse(c.spotAsOf)) > 900_000 ||
      !Number.isFinite(Date.parse(c.expiryAt)) || Date.parse(c.expiryAt) <= now ||
      ![c.source, c.rateReference, c.dividendReference].every(v => typeof v === 'string' && v.trim().length > 0 && v.length <= 500) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(c.expiryAt)) reason = 'Missing or stale quote, rate, dividend or expiry provenance';
    else if (![c.spot, c.premiumPerContract, c.impliedVolatility, c.rate, h.units].every(Number.isFinite) || c.spot <= 0 || c.premiumPerContract < 0 ||
      Date.parse(c.expiryAt) - now > 10 * 366 * 86400_000 || c.impliedVolatility < 0.01 || c.impliedVolatility > 5 || Math.abs(c.rate) > 0.5 || !Number.isSafeInteger(h.units) || h.units <= 0 || h.units > 1_000_000 ||
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
      rate: c.rate, dividends: c.dividends.map(d => ({ date: d.date, amount: d.amount })), quoteAsOf: c.quoteAsOf,
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
  return inputs;
}
