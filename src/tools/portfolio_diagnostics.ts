import { readFileSync } from 'node:fs';
import { applyBrokerNav } from '../report/broker-nav.js';
import { Type } from 'typebox';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';
import { inspectPortfolioProjection, portfolioFingerprint, type PortfolioProjection } from '../state/projection-store.js';
import { refreshPortfolioAfterSync } from '../state/projection-events.js';
import { loadInvestor, saveInvestor, type InvestorSnapshot } from '../state/investor-store.js';
import { getPortfolio } from '../state/portfolio-state.js';
import { assertHolding } from '../market/position-value.js';
import { buildLivePositions, filterLiveByChannel, MERGED_CHANNEL_VIEW } from '../report/dashboard-model.js';

export const CALCULATION_GUIDE = `\nFor any displayed financial figure, call inspect_portfolio_calculation FIRST with the displayed calculated_at and account channel. It reads the dashboard's actual saved generation, not a daily snapshot or fresh quote. Use read_calculation_source to inspect the actual implementation and broker mapper when investigating a defect. Use section=positions to compare included rows against source holdings, section=issues for failures, section=replay to run the current production calculation using saved valuation inputs, and section=sources for broker account totals, currency and dates. Never claim a reconciliation unless arithmetic and scope match; never invent rounding adjustments or attribute NAV to cost basis (cost affects P/L, not NAV). A negative broker diluted cost is valid evidence, not permission to flip its sign. Prefer broker-reported values for the SAME metric/account/currency/time; do not substitute buying power, available funds or margin for NAV. Broker total NAV already includes its assets; never add cash, shares, options or fund assets again. Quote timestamps and source time can be unavailable; say so. Calculation bugs require code repair; do not change holdings to compensate. Bookkeeper can restore_broker_reported_values (preview/apply the latest successful archived account snapshot through the current parser, with no quantity/cost/cash/history changes), rebuild_portfolio_calculations and correct_holding with preview then apply, or use update_holding (including avg_price premium per CONTRACT), post_adjustment for cash, and sync_broker for broker refresh. Corrections require verified source evidence and user authorization; preserve original broker signs, zeroes, fees, multipliers and archives. A successful state write is not a verified dashboard fix: re-read the persisted holding and inspect the replacement calculation, report pending/failed rebuilds explicitly. Never report execution profit from broker diluted position cost.`;
const result = (details: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(details) }], details });
const failure = (e: unknown) => result({ error: e instanceof Error ? e.message : String(e) });

export function calculationEvidence(snapshot: InvestorSnapshot, saved: PortfolioProjection, section: string, channel = MERGED_CHANNEL_VIEW, scopeChannels?: string[]) {
  const whole = saved.dashboard.model?.live;
  if (!whole) throw new Error('Saved dashboard has no valuation model');
  const live = filterLiveByChannel(whole, channel);
  const owns = (h: { channel?: string }) => (channel === MERGED_CHANNEL_VIEW || (h.channel || 'default') === channel) && (!scopeChannels || scopeChannels.includes(h.channel || 'default'));
  const holdings = Object.fromEntries(Object.entries(getPortfolio(snapshot.state)).filter(([, h]) => owns(h)));
  const included = new Map(live.positions.map(p => [p.ticker, p]));
  const sourceMatches = saved.fingerprint === portfolioFingerprint(snapshot.state);
  const identity = { revision: snapshot.revision, calculated_at: saved.calculatedAt, fingerprint: saved.fingerprint, source_matches: sourceMatches, channel,
    reporting_currency: live.reportingCurrency, broker_as_of: saved.dashboard.brokerAsOf };
  if (section === 'positions') return { ...identity, rows: Object.entries(holdings).map(([key, h]) => ({ key, source_holding: h, included: included.has(key), saved_valuation: included.get(key) ?? null })) };
  if (section === 'issues') return { ...identity, issues: live.issues, warnings: saved.dashboard.warnings,
    omitted_keys: Object.keys(holdings).filter(key => !included.has(key)) };
  if (section === 'sources') return { ...identity, connection_metrics: Object.fromEntries(Object.entries(saved.dashboard.connectionMetrics ?? {}).filter(([key]) => channel === MERGED_CHANNEL_VIEW || key === channel)),
    equity_prices: saved.dashboard.equityPrices, fx_rates: live.fxRates, cash_balances: live.cashBalances, deposits: live.deposits,
    source_note: 'Raw broker responses: query_data raw_files -> source_records using exact file id/version. Stored prices are not fresh quotes; absent individual quote timestamps are unknown.' };
  if (section === 'replay') {
    if (!sourceMatches) throw new Error('Source changed since saved generation; replay cannot combine current holdings with old prices. Inspect saved rows or rebuild.');
    const portfolio = structuredClone(holdings);
    // Saved option prices are per CONTRACT, already multiplier-adjusted and still in native currency.
    for (const [key, h] of Object.entries(portfolio)) if (h.option && included.has(key)) h.option.mark = included.get(key)!.price;
    const replay = buildLivePositions(portfolio, saved.dashboard.equityPrices ?? {}, undefined,
      (whole.cashBalances ?? []).filter(owns), whole.deposits.filter(owns), saved.calculatedAt.slice(0, 10),
      whole.reportingCurrency ? { reportingCurrency: whole.reportingCurrency, fxRates: whole.fxRates ?? {} } : undefined,
      { resilient: true, allowEmpty: true });
    const replayItemized = replay.totalValue;
    applyBrokerNav(replay, saved.dashboard.connectionMetrics ?? {});
    return { ...identity, replay_itemized_total_value: replayItemized, saved_total_value: live.totalValue, replay_total_value: replay.totalValue,
      delta: replay.totalValue - live.totalValue, replay, note: 'Read-only replay with current code and saved valuation inputs; does not fetch prices, alter broker records, or publish a generation.' };
  }
  return { ...identity, total_value: live.totalValue, positions_value: live.positionsValue, equity_value: live.equityValue,
    cash_amount: live.cashAmount, deposits_amount: live.depositsAmount, position_count: live.positionCount, source_position_count: Object.keys(holdings).length,
    nav_sources: live.navSources, itemized_total_value: live.itemizedTotalValue,
    total_cost: live.totalCost, total_pl: live.totalPL, nav_complete: live.navComplete, omitted_keys: Object.keys(holdings).filter(key => !included.has(key)),
    formula: 'Itemized NAV = signed position market values + cash converted once + fixed-deposit principal. Unrealized P/L uses matching broker unrealized_pl when reported, otherwise market value minus recorded cost; broker position_pl and pl_ratio can include different diluted-cost treatment and are kept separate. Broker-reported account NAV takes precedence when available; do not add components to it.',
    fee_treatment: 'No extra NAV fee subtraction: retained broker cash and position cost carry their reported treatment. Execution fees and opening/roll cash are separate datasets, not extra NAV assets.',
    fund_treatment: 'Aggregate broker funds are excluded from itemized positions, included in broker total only as reported. Do not add them to broker NAV.',
    issues: live.issues };
}

export function createCalculationTools(write = false): AgentTool[] {
  const read: AgentTool = {
    name: 'inspect_portfolio_calculation', label: 'Inspect Portfolio Calculation',
    description: 'Trace the exact saved dashboard generation: totals/formula, included and omitted source holdings, issues, broker totals, FX, quote provenance, or read-only replay using saved marks. No fresh quotes or writes. A requested timestamp mismatch fails explicitly.',
    parameters: Type.Object({ ...channelIdParams, section: Type.Optional(Type.Union(['summary','positions','issues','sources','replay'].map(x => Type.Literal(x)))), channel: Type.Optional(Type.String()), broker_id: Type.Optional(Type.String()), calculated_at: Type.Optional(Type.String()), snapshot_date: Type.Optional(Type.String()) }),
    async execute(_id, raw) { try {
      const p = raw as ChannelIds & { section?: string; channel?: string; broker_id?: string; calculated_at?: string; snapshot_date?: string };
      const snapshot = await resolveInvestorFromChannel(p); const { entry } = inspectPortfolioProjection(snapshot.state);
      if (p.calculated_at && p.calculated_at !== entry.calculatedAt) throw new Error(`Requested generation ${p.calculated_at} is not retained as the current dashboard; retained generation is ${entry.calculatedAt}. Do not substitute it for the selected snapshot. Query raw_files/source_records for retained reconciliation receipts or the original valuation snapshot.`);
      if (p.channel && p.channel !== MERGED_CHANNEL_VIEW && !entry.dashboard.model?.live.channels.includes(p.channel)) throw new Error('Unknown saved account channel');
      if (p.snapshot_date) {
        if (p.broker_id) throw new Error('Historical broker totals are not retained as a combined broker scope; inspect its exact account channels for this date instead');
        const row=entry.dashboard.model?.history.find(row=>row.date===p.snapshot_date);
        if (!row) throw new Error('Requested historical snapshot is not retained');
        const scope=entry.dashboard.aggregatedViews?.[p.snapshot_date]?.[p.channel??MERGED_CHANNEL_VIEW] as {view?:unknown}|undefined;
        if (!scope?.view) throw new Error('Requested historical account scope is not retained; do not substitute current data');
        return result({calculated_at:entry.calculatedAt,snapshot_date:p.snapshot_date,channel:p.channel??MERGED_CHANNEL_VIEW,source:'saved_historical_snapshot',view:scope.view,broker_as_of:row.brokerAsOf,nav_sources:row.navSources,note:'These are stored historical values. Current holdings, fresh prices and live broker totals are not substituted.'});
      }
      const broker = p.broker_id ? entry.brokers[p.broker_id] : undefined;
      if (p.broker_id && !broker) throw new Error('Unknown saved broker scope');
      return result({...calculationEvidence(snapshot, broker ? {...entry,dashboard:broker.dashboard} : entry, p.section ?? 'summary', p.channel, broker?.channels), ...(p.broker_id ? {broker_id:p.broker_id} : {})});
    } catch (e) { return failure(e); } },
  };
  const source: AgentTool = {
    name: 'read_calculation_source', label: 'Read Calculation Implementation',
    description: 'Read the running release implementation for a named calculation component. Fixed application source files only, no arbitrary filesystem access, secrets or execution. Use with saved evidence to verify a formula or code defect before diagnosing it.',
    parameters: Type.Object({ component: Type.Union(['position_valuation','dashboard_totals','broker_nav','moomoo_mapper','tiger_mapper','webull_mapper','ibkr_mapper','ibkr_parser','futubull_mapper','option_tables','stock_tables','projection_builder'].map(x => Type.Literal(x))) }),
    async execute(_id, raw) { try {
      const files: Record<string,string> = { position_valuation: '../market/position-value.ts', dashboard_totals: '../report/dashboard-model.ts', broker_nav: '../report/broker-nav.ts', moomoo_mapper: '../moomoo/moomoo-map.ts', tiger_mapper:'../tiger/tiger-map.ts', webull_mapper:'../webull/webull-map.ts', ibkr_mapper:'../ibkr/flex-map.ts', ibkr_parser:'../ibkr/flex-parse.ts', futubull_mapper:'../futubull/futubull-map.ts', option_tables:'../../webui/option-position.js', stock_tables:'../../webui/positions/model.js', projection_builder: '../state/portfolio-projections.ts' };
      const component = (raw as {component:string}).component;
      if (!Object.hasOwn(files,component)) throw new Error('Unknown calculation component');
      // Production may run src via tsx or dist via node; source is shipped with both.
      return result({ component, file: 'src/' + files[component].slice(3), source: readFileSync(new URL(files[component].replace(/\.ts$/,'.ts'), new URL('../../src/tools/', import.meta.url)), 'utf8') });
    } catch (e) { return failure(e); } },
  };
  if (!write) return [read, source];
  return [read, source, {
    name: 'rebuild_portfolio_calculations', label: 'Rebuild Portfolio Calculations',
    description: 'Rebuild derived dashboard/account/broker views through production code. Leaves source holdings, cash and broker archives intact. Fetches current quotes; it does not rewrite the selected old snapshot. Requires the revision from inspection; returns persisted before/after and explicit rebuild status.',
    parameters: Type.Object({ ...channelIdParams, expected_revision: Type.Integer(), reason: Type.String() }),
    async execute(_id, raw) { try {
      const p = raw as ChannelIds & { expected_revision: number; reason: string }; const snapshot = await resolveInvestorFromChannel(p);
      if (snapshot.revision !== p.expected_revision) throw new Error('Source revision changed; inspect again');
      if (!p.reason?.trim()) throw new Error('Repair reason required');
      const before = inspectPortfolioProjection(snapshot.state).entry;
      const status = await refreshPortfolioAfterSync(snapshot.state.user.id, true);
      const after = await loadInvestor(snapshot.state.user.id);
      return result({ status: status.status, reason: p.reason, before: calculationEvidence(snapshot, before, 'summary'),
        after: status.status === 'ready' ? calculationEvidence(after, inspectPortfolioProjection(after.state).entry, 'summary') : null });
    } catch (e) { return failure(e); } },
  }, {
    name: 'correct_holding', label: 'Correct Holding From Evidence',
    description: 'Bookkeeping correction, not a trade: preview/apply signed avg_price, units, currency and option/fund mark on an exact lot key, with evidence and reason. Preserves cash, archives, contract identity and all unspecified fields. Never flip broker signs based on plausibility. For new fills use trade/sync tools; for cash use post_adjustment. Apply requires the unchanged revision and preview token. Books reconciliation and audit run on save; persisted readback and rebuild status are returned.',
    parameters: Type.Object({ ...channelIdParams, mode: Type.Union([Type.Literal('preview'), Type.Literal('apply')]), key: Type.String(), expected_revision: Type.Integer(),
      patch: Type.Object({ avg_price: Type.Optional(Type.Number()), units: Type.Optional(Type.Number()), currency: Type.Optional(Type.String()), mark: Type.Optional(Type.Number()) }, { additionalProperties: false }),
      evidence: Type.String(), reason: Type.String(), preview_token: Type.Optional(Type.String()) }),
    async execute(_id, raw) { try {
      const p = raw as ChannelIds & { mode: string; key: string; expected_revision: number; patch: { avg_price?: number; units?: number; currency?: string; mark?: number }; evidence: string; reason: string; preview_token?: string };
      if (!['preview','apply'].includes(p.mode)) throw new Error('mode must be preview or apply');
      if (!p.evidence?.trim() || !p.reason?.trim()) throw new Error('Verified source evidence and correction reason required');
      const snapshot = await resolveInvestorFromChannel(p);
      if (snapshot.revision !== p.expected_revision) throw new Error('Source revision changed; preview again');
      const before = getPortfolio(snapshot.state)[p.key]; if (!before) throw new Error('Exact holding key not found');
      if (!p.patch || !Object.keys(p.patch).length || Object.keys(p.patch).some(k => !['avg_price','units','currency','mark'].includes(k))) throw new Error('Unsupported or empty correction');
      const next = structuredClone(before); const { mark, ...fields } = p.patch; Object.assign(next, fields);
      if (mark !== undefined) {
        if (next.option) next.option.mark = mark;
        else if (next.fund) next.fund.mark = mark;
        else throw new Error('Equity market marks require broker sync/quotes, not a holding mark');
      }
      delete next.broker_values; // Explicit correction supersedes retained broker economics until the next sync.
      assertHolding(p.key, next);
      const preview_token = createHash('sha256').update(JSON.stringify([snapshot.state.user.id, snapshot.revision, p.key, before, next, p.evidence, p.reason])).digest('hex');
      if (p.mode === 'preview') return result({ preview_token, revision: snapshot.revision, before, after: next, cash_changed: false });
      if (p.preview_token !== preview_token) throw new Error('Correction differs from preview; preview again');
      snapshot.state.portfolio = { ...getPortfolio(snapshot.state), [p.key]: next };
      snapshot.state.log.push({ ts: new Date().toISOString(), action: 'holding_corrected', ticker: p.key, before: structuredClone(before), after: structuredClone(next), evidence: p.evidence, reason: p.reason });
      await saveInvestor(snapshot);
      const persisted = await loadInvestor(snapshot.state.user.id);
      if (!isDeepStrictEqual(getPortfolio(persisted.state)[p.key], next)) throw new Error('Correction saved but persisted readback differs; investigate before retrying');
      const rebuilt = await refreshPortfolioAfterSync(snapshot.state.user.id);
      return result({ applied: true, revision: persisted.revision, before, after: getPortfolio(persisted.state)[p.key], cash_changed: false, calculation_status: rebuilt.status });
    } catch (e) { return failure(e); } },
  }];
}
