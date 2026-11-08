/** Explicitly approved demo source records, separate from broker executions and books. */
import type { InvestorState } from '../state/portfolio-state.js';
import type { DashboardPayload } from '../webapp/dashboard-data.js';
import type { LivePosition } from '../report/dashboard-model.js';
import type { TradeJournalRow } from '../webapp/trades-v2-data.js';
import { buildDashboardModel, buildLivePositions } from '../report/dashboard-model.js';
import { addDecimals } from '../brokers/option-executions.js';

export interface DemoWorkbook {
  version: 1; asOf: string; currency: string; multiplier: string;
  source: { sha256: string; fileId: string };
  summary: Record<'premiumDaily' | 'premiumMtd' | 'premiumTotal' | 'feesMtd' | 'feesTotal' |
    'earnedMtd' | 'earnedTotal' | 'nav' | 'cash' | 'assignment' | 'riskCapital', string> & { earnedDaily: string | null };
  rows: Array<{ sheet: string; row: number; channel: string; brokerId: string; underlying: string;
    description: string; entryDate: string; expiry: string; strike: string; contracts: string;
    credit: string; debit: string; fees: string }>;
}
export function demoWorkbookForState(state: InvestorState): DemoWorkbook | undefined {
  return state.profile.contact_email === 'demo@velovest.ai' && state.synthetic_demo?.version === 1
    ? state.demo_workbook : undefined;
}
export function assertDemoWorkbook(raw: unknown): asserts raw is DemoWorkbook {
  const book = raw as DemoWorkbook;
  if (!book || book.version !== 1 || !Array.isArray(book.rows) || !book.rows.length || !book.summary ||
      !/^[a-f0-9]{64}$/.test(book.source?.sha256 ?? '') || typeof book.source?.fileId !== 'string' ||
      book.source.fileId !== 'imports/demo-workbook/Demo data.xlsx' || book.currency !== 'USD') throw Error('Invalid approved demo source schema');
  const date = (v: string) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
  const number = (v: string) => { if (typeof v !== 'string' || !Number.isFinite(Number(v))) throw Error('Invalid demo decimal'); addDecimals('0',v); };
  if (!date(book.asOf)) throw Error('Invalid source date');
  number(book.multiplier);
  for (const name of ['premiumDaily','premiumMtd','premiumTotal','feesMtd','feesTotal','earnedMtd','earnedTotal','nav','cash','assignment','riskCapital'] as const) number(book.summary[name]);
  if (book.summary.earnedDaily !== null) number(book.summary.earnedDaily);
  const identities = new Set<string>();
  for (const row of book.rows) {
    if (!row || !Number.isSafeInteger(row.row) || !date(row.entryDate) || !date(row.expiry) ||
        !['moomoo','ibkr','tiger'].includes(row.brokerId) || row.channel !== row.brokerId ||
        !row.sheet || !row.underlying || !row.description) throw Error('Invalid demo journal row');
    for (const name of ['strike','contracts','credit','debit','fees'] as const) number(row[name]);
    const identity = JSON.stringify([row.sheet,row.row]);
    if (identities.has(identity)) throw Error('Duplicate workbook source row');
    identities.add(identity);
  }
}
const negative = (value: string) => value.startsWith('-') ? value.slice(1) : '-' + value;
const cash = (row: DemoWorkbook['rows'][number]) => addDecimals(row.credit, negative(row.debit));
const key = (book: DemoWorkbook, row: DemoWorkbook['rows'][number]) => `demo:workbook:${book.source.sha256}:${row.sheet}:${row.row}`;
const sourceReason = 'User-approved workbook snapshot; summary figures are supplied independently of the journal. Quotes, opening cost and separate roll legs are not reported.';

export function workbookJournal(book: DemoWorkbook) {
  const daily = book.rows.map(row => ({ date: row.entryDate, channel: row.channel, account_id: row.channel, currency: book.currency,
    gross_premium: cash(row), net_premium: addDecimals(cash(row), negative(row.fees)) }));
  const cumulative = [...new Set(daily.map(row => row.channel))].map(channel => ({ channel, account_id: channel, currency: book.currency,
    gross_premium: addDecimals('0', ...daily.filter(row => row.channel === channel).map(row => row.gross_premium)),
    net_premium: addDecimals('0', ...daily.filter(row => row.channel === channel).map(row => row.net_premium)) }));
  return { available: true, executions: [], daily, cumulative };
}
export function workbookPortfolioEvidence(state: InvestorState) {
  const book=demoWorkbookForState(state);
  if(!book) return undefined;
  return { source:'user_approved_demo_workbook', as_of:book.asOf, currency:book.currency,
    source_file:book.source, summary:book.summary, count:book.rows.length,
    current_positions:book.rows.map(row=>({...row, right:'put', side:'short', multiplier:book.multiplier,
      opening_cost:null, market_price:null, unrealized_pnl:null})),
    limitations:[sourceReason, 'Entry dates are worksheet dates. Row cash is combined journal cash, not verified opening execution cash. Summary totals do not establish individual completed-trade profits.'] };
}

/** Legacy dashboard numeric slots serialize unavailable values as null. Never substitute zero. */
const unreported = null as unknown as number;
export function workbookDashboard(state: InvestorState): DashboardPayload {
  const book = demoWorkbookForState(state);
  if (!book) throw Error('No approved demo workbook');
  const channels = [...new Set(book.rows.map(row => row.channel))];
  const positions: LivePosition[] = book.rows.map(row => ({
    ticker: key(book, row), label: row.description, instrument: 'option', channel: row.channel,
    currency: book.currency, units: Number(row.contracts), avgCost: unreported, price: unreported,
    cost: unreported, value: unreported, pl: unreported, plPct: unreported, weightPct: unreported,
    premiumAbsolute: unreported, contingentCashObligation: Number(row.strike) * Number(row.contracts) * Number(book.multiplier),
    contingentShareObligation: 0, category: 'option', markSource: 'manual', markNote: sourceReason,
    option: { underlying: row.underlying, right: 'put', side: 'short', strike: Number(row.strike),
      expiry: row.expiry, multiplier: Number(book.multiplier), settlement: 'physical', mark: unreported, quote_source: 'manual' },
  }));
  const live = buildLivePositions({}, {}, undefined, [], null, book.asOf, undefined, { reportingCurrency: book.currency, allowEmpty: true });
  const channelTotals = (channel: string) => ({ ...live, channel,
    positions: undefined, byChannel: undefined, channels: undefined,
    positionCount: positions.filter(p => p.channel === channel).length,
    optionCount: positions.filter(p => p.channel === channel).length,
    totalValue: unreported, positionsValue: unreported, totalCost: unreported, totalPL: unreported,
    totalPLPct: unreported, cashAmount: null, cashCurrency: null, cashWeightPct: null,
    optionsPremiumCollected: unreported, contingentCashObligation: positions.filter(p => p.channel === channel).reduce((sum, p) => sum + p.contingentCashObligation, 0), navComplete: false });
  Object.assign(live, { positions, channels, byChannel: channels.map(channelTotals), positionCount: positions.length,
    optionCount: positions.length, totalValue: Number(book.summary.nav), cashAmount: Number(book.summary.cash),
    cashCurrency: book.currency, totalCost: unreported, totalPL: unreported, totalPLPct: unreported,
    positionsValue: unreported, optionsPremiumCollected: unreported, contingentCashObligation: Number(book.summary.assignment),
    navComplete: true, cashWeightPct: Number(book.summary.cash) / Number(book.summary.nav) * 100 });
  const {daily} = workbookJournal(book);
  return { slug: state.user.id, displayName: state.profile.display_name, generatedAt: book.asOf + 'T00:00:00Z',
    empty: false, model: buildDashboardModel(live, []), benchmark: null, equityPrices: {},
    premiumJournal: { available: true, daily, channels }, premiumSupportedChannels: channels,
    optionAnalytics: { executions: [], profits: [], gaps: [] }, optionTradeDetails: {},
    productProfile: 'consultant', productName: 'Velovest', demoWorkbook: book,
    brokerAsOf: Object.fromEntries(channels.map(channel => [channel, book.asOf])),
    brokerChannels: Object.fromEntries(book.rows.map(row => [row.channel, { brokerId: row.brokerId, label: row.sheet }])),
    warnings: [{ code: 'synthetic_demo', severity: 'warning', message: sourceReason + ' As of ' + book.asOf + '. No broker accounts are connected.' }] };
}

/** Current positions are approved worksheet rows, not invented fills or completed cycles. */
export function workbookOpenTrades(state: InvestorState) {
  const book = demoWorkbookForState(state);
  if (!book) throw Error('No approved demo workbook');
  const rows: TradeJournalRow[] = book.rows.map(row => ({
    id: key(book,row), optionId: key(book,row), underlying: row.underlying, right: 'put', side: 'short',
    strike: row.strike, expiry: row.expiry, multiplier: book.multiplier, currency: book.currency,
    channel: row.channel, accountId: row.channel, entryDate: row.entryDate, entryThrough: row.entryDate,
    contracts: row.contracts, premium: null, netCash: null, returnsPct: null, status: 'Open',
    lastTrade: row.entryDate, paidToClose: null, realizedPnl: null, feeBasis: 'unknown', brokerDate: book.asOf,
    observedSince: book.asOf, executions: [], orderFees: [], events: [], rolled: false, thesis: '', noteUpdatedAt: null,
    notes: [row.description, `Source: ${book.source.fileId}, ${row.sheet}, row ${row.row}.`,
      `Worksheet cash: credit ${row.credit}; debit ${row.debit}; fees ${row.fees} ${book.currency}. Row cash is not allocated to opening fills or roll legs.`],
  }));
  return { rows, identityVersion: 1, identityMigrated: false };
}

/** Override only the approved merged snapshot. Account scopes retain source journal totals. */
export function applyWorkbookScopes(payload: DashboardPayload, scopes: Record<string, Record<string, any>>) {
  const book = payload.demoWorkbook;
  if (!book || !scopes.live) return;
  for (const [channel, scope] of Object.entries(scopes.live)) {
    const members = new Set(payload.model?.live.channels ?? []);
    const rows = book.rows.filter(row => members.has(row.channel) && (channel === 'merged' || row.channel === channel) && row.entryDate <= book.asOf);
    const mtd = rows.filter(row => row.entryDate.slice(0, 7) === book.asOf.slice(0, 7));
    const sum = (list: typeof rows, amount: (row: typeof rows[number]) => string) => Number(addDecimals('0', ...list.map(amount)));
    Object.assign(scope.premium, { fees: sum(mtd, r => r.fees), totalFees: sum(rows, r => r.fees), missingFees: 0, totalMissingFees: 0 });
    // These charts show actual worksheet rows; never synthesize missing historical
    // trades to force their sum to equal the independently supplied headline.
    const grouped = (dimension: (row: typeof rows[number]) => string) => [...new Set(rows.map(dimension))]
      .map(name => [name, sum(rows.filter(row => dimension(row) === name), cash)]);
    scope.monthly.byMonth = grouped(row => row.entryDate.slice(0,7));
    scope.monthly.byUnderlying = grouped(row => row.underlying);
    if (channel !== 'merged' || payload.demoWorkbookScope === 'broker') continue;
    Object.assign(scope.premium, { daily: Number(book.summary.premiumDaily), mtd: Number(book.summary.premiumMtd),
      total: Number(book.summary.premiumTotal), fees: Number(book.summary.feesMtd), totalFees: Number(book.summary.feesTotal),
      partial: false, source: 'workbook_snapshot', reason: sourceReason, totalReason: sourceReason });
    const date = book.asOf;
    scope.realized[''] = { value: Number(book.summary.earnedTotal), reason: sourceReason };
    scope.realized[date.slice(0, 7) + '-01'] = { value: Number(book.summary.earnedMtd), reason: sourceReason };
    scope.realized[scope.premium.dailyFrom] = { value: book.summary.earnedDaily === null ? null : Number(book.summary.earnedDaily), reason: sourceReason };
    scope.assignmentObligation = Number(book.summary.assignment);
    scope.workbookRiskCapital = { value: Number(book.summary.riskCapital), reason: sourceReason };
    for (const view of [scope.view, scope.legacyView]) {
      view.totalValue = Number(book.summary.nav); view.cashAmount = Number(book.summary.cash);
      view.cashCurrency = book.currency; view.navComplete = true;
    }
  }
}
