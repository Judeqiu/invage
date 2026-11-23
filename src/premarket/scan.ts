import { createHash } from 'node:crypto';
import { readBrokerAccountModel, readBrokerPositionSnapshot } from '../brokers/accounts.js';
import { validDate } from '../brokers/option-executions.js';
import { normalizeBrokerOptionLot, formatBrokerSkip } from '../brokers/statement.js';
import { buildHoldingKey } from '../market/position-value.js';
import type { Holding } from '../market/types.js';
import { getPortfolio } from '../state/portfolio-state.js';
import type { InvestorSnapshot } from '../state/investor-store.js';
import { readOptionRiskCostModel } from '../webapp/dashboard-config.js';
import { attachOpenVerticalSpreads, openOptionTradeDetails } from '../webapp/option-dashboard-data.js';
import { prepareOptionRelationships } from '../webapp/option-relationships-data.js';
import { analyzeDecision, inCallStrikeBand, selectRollReferences, triggerCeiling, type ListedOption } from './decisions.js';
import { positionHistory } from './history.js';
import { matchListed, readChain, readReplacementBooks, readStock, type ChainEvidence, type UnderlyingEvidence } from './market.js';
import { usSessionDate } from './session.js';

type SnapshotOfPositions = Awaited<ReturnType<typeof readBrokerPositionSnapshot>>;
type ScanSource = { accountId: string; broker: string; label: string; asOf: string | null; capturedAt: string | null; reference: string | null; coverage: string[] };
export type Session = { date: string; windowEnd: string };
export const positionVerification = {
  listing: 'U.S. equity listing could not be verified.',
  broker: 'Latest account position evidence is incomplete or predates the trading session.',
  contract: 'Exercise style or exact contract terms could not be verified.',
  underlyingQuote: 'A same-session underlying quote in the contract currency is unavailable.',
  relatedLegs: 'Other same-account option legs exist. Confirm this put is held as a standalone position.',
};
const deps = { readBrokerPositionSnapshot, readStock, readChain, readReplacementBooks, prepareOptionRelationships, readOptionRiskCostModel };
export type ScanDependencies = Partial<typeof deps>;

function inWindow(h: Holding, session: Session) {
  return h.instrument === 'option' && h.option?.side === 'short' &&
    h.units > 0 && validDate(h.option.expiry) && h.option.expiry >= session.date && h.option.expiry <= session.windowEnd;
}

const unknownStock: UnderlyingEvidence = { stock: null, isUsEquity: false, earnings: null };
export async function scanPremarket(snapshot: InvestorSnapshot, session: Session, startedAt: Date,
  archive: (raw: SnapshotOfPositions['raw'], sha256: string) => Promise<string>, overrides: ScanDependencies = {}) {
  const runtime = { ...deps, ...overrides };
  const state = snapshot.state, { connections } = readBrokerAccountModel(state);
  const accounts = Object.entries(connections).filter(([, connection]) => connection.enabled && connection.account_id);
  const sources: ScanSource[] = [];
  const positions: Record<string, Holding> = {};
  const sourceByChannel = new Map<string, ScanSource>();
  const notes: string[] = [];
  if (!accounts.length) notes.push('No enabled, bound broker account is available for the scan.');
  for (const connection of Object.values(connections)) {
    if (connection.enabled && !connection.account_id) notes.push(`${connection.label} has no verified account binding.`);
  }
  await Promise.all(accounts.map(async ([id, connection]) => {
    const source: ScanSource = { accountId: connection.account_id!, broker: connection.broker_id, label: connection.label,
      asOf: null, capturedAt: null, reference: null, coverage: [] };
    sourceByChannel.set(connection.channel, source);
    sources.push(source);
    try {
      const { statement, raw } = await runtime.readBrokerPositionSnapshot(state, id);
      source.asOf = statement.as_of;
      source.capturedAt = new Date().toISOString();
      source.reference = await archive(raw, createHash('sha256').update(raw.body).digest('hex'));
      source.coverage.push(...statement.skipped.filter(skip => skip.kind === 'position' && skip.blocking !== false).map(formatBrokerSkip));
      if (statement.as_of < session.date) source.coverage.push('The broker snapshot predates this trading session. Check for intervening fills or assignments.');
      const duplicates = new Set<string>();
      for (const lot of statement.lots.map(normalizeBrokerOptionLot)) {
        const key = buildHoldingKey(lot.ticker, connection.channel);
        if (duplicates.has(key)) continue;
        if (positions[key]) {
          duplicates.add(key);
          delete positions[key];
          source.coverage.push(`Duplicate account position identity for ${lot.ticker}.`);
          continue;
        }
        positions[key] = { ...lot.holding, currency: lot.currency, channel: connection.channel };
      }
    } catch {
      source.coverage.push('The current broker position snapshot is unavailable. Positions from the last saved sync are shown as unverified.');
      for (const [key, holding] of Object.entries(getPortfolio(state))) {
        if (holding.channel === connection.channel) positions[key] = holding;
      }
    }
  }));
  const candidates = Object.entries(positions).filter(([, h]) => inWindow(h, session));
  const symbols = [...new Set(candidates.map(([, h]) => h.option!.underlying))];
  const stocks = new Map(await Promise.all(symbols.map(async symbol =>
    [symbol, await runtime.readStock(symbol).catch(() => unknownStock)] as const)));
  const retained = candidates.filter(([, h]) => {
    const option = h.option!;
    const quote = stocks.get(option.underlying)?.stock;
    if (!quote || quote.currency !== h.currency || usSessionDate(new Date(quote.asOf)) !== session.date) return true;
    return option.right === 'call' ? inCallStrikeBand(quote.price, option.strike) : quote.price <= triggerCeiling(option.strike);
  });
  const chains = new Map<string, ChainEvidence>();
  const relationshipsTask = retained.length ? runtime.prepareOptionRelationships(state).catch(() => null) : Promise.resolve(null);
  await Promise.all([...new Set(retained.map(([, h]) => h.option!.underlying))].map(async symbol => {
    const stock = stocks.get(symbol) ?? unknownStock;
    if (!stock.isUsEquity) return;
    try {
      const held = retained.flatMap(([, h]) => h.option!.underlying === symbol ? [h] : []);
      chains.set(symbol, await runtime.readChain(state, symbol, session.date, held, stock));
    } catch { chains.set(symbol, { options: [], events: [], notices: ['The option chain could not be retrieved.'] }); }
  }));
  const relationships = await relationshipsTask;
  const accountIds = Object.fromEntries(accounts.map(([, c]) => [c.channel, c.account_id!]));
  const details = openOptionTradeDetails(positions, (state.option_executions ?? []).filter(row => !row.spreadsheet_source), accountIds, state.option_events);
  attachOpenVerticalSpreads(positions, details, relationships?.spreads ?? [], accountIds);
  const fee = runtime.readOptionRiskCostModel();
  const rows = retained.flatMap(([key, h]) => {
    const option = h.option!, source = sourceByChannel.get(h.channel!)!;
    const stock = stocks.get(option.underlying) ?? unknownStock;
    const chain = chains.get(option.underlying);
    const listed = matchListed(h, chain?.options ?? []);
    if ((option.right === 'put' && details[key]?.spread) || listed?.exercise === 'european') return [];
    const unverified: (keyof typeof positionVerification)[] = [];
    if (!stock.isUsEquity) unverified.push('listing');
    if (source.coverage.length) unverified.push('broker');
    if (listed?.exercise !== 'american' || (option.right === 'call' && !listed.shareOnly)) unverified.push('contract');
    if (stock.stock?.currency !== h.currency || !stock.stock || usSessionDate(new Date(stock.stock.asOf)) !== session.date)
      unverified.push('underlyingQuote');
    const otherLegs = Object.entries(positions).flatMap(([otherKey, other]) =>
      otherKey !== key && other.channel === h.channel && other.units > 0 && other.option?.underlying === option.underlying
        ? [{ option: other.option, quantity: other.units, currency: other.currency }] : []);
    if (option.right === 'put' && otherLegs.some(leg => leg.option.side === 'long' || leg.option.right === 'call')) {
      unverified.push('relatedLegs');
    }
    const stockHolding = positions[buildHoldingKey(option.underlying, h.channel)];
    const accountShares = stockHolding?.instrument === 'equity' ? stockHolding.units
      : !stockHolding && !source.coverage.length ? 0 : null;
    const history = positionHistory(state, relationships, h, source.accountId, details[key]);
    const position = { currency: h.currency ?? 'Unknown', right: option.right, strike: option.strike, expiry: option.expiry, quantity: h.units, listed };
    const decision = analyzeDecision(position, history.cash, stock.stock, chain?.options ?? [], session.date, fee);
    return [{ key, underlying: option.underlying, source, position, stock: stock.stock, nativeId: h.broker_ref?.native_id ?? null,
      recordedShares: option.multiplier, recordedSettlement: option.settlement, unverified, history, decision,
      accountShares, otherLegs, inSpread: Boolean(details[key]?.spread) }];
  });
  await Promise.all([...chains].map(async ([symbol, chain]) => {
    const scopedRows = rows.filter(row => row.underlying === symbol);
    const checked = new Set<ListedOption>();
    // If an exact book removes the quoted credit, check the next eligible example.
    while (true) {
      const replacements = [...new Set(scopedRows.flatMap(row =>
        selectRollReferences(row.decision).map(ref => ref.example.option)))].filter(option => !checked.has(option));
      if (!replacements.length) break;
      for (const option of replacements) checked.add(option);
      chain.notices.push(...await runtime.readReplacementBooks(state, replacements));
      for (const row of scopedRows) {
        row.decision = analyzeDecision(row.position, row.history.cash, row.stock, chain.options, session.date, fee);
      }
    }
  }));
  sources.sort((a, b) => a.label.localeCompare(b.label) || a.accountId.localeCompare(b.accountId));
  rows.sort((a, b) => a.underlying.localeCompare(b.underlying) || a.position.expiry.localeCompare(b.position.expiry) || a.key.localeCompare(b.key));
  return { session, startedAt: startedAt.toISOString(), collectedAt: new Date().toISOString(), revision: snapshot.revision, sources, notes,
    rows, market: chains, stocks, inspected: {
      puts: candidates.filter(([, h]) => h.option!.right === 'put').length,
      calls: candidates.filter(([, h]) => h.option!.right === 'call').length,
    } };
}
export type PremarketScan = Awaited<ReturnType<typeof scanPremarket>>;
