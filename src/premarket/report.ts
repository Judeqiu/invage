import { escapeHtml } from '../report/html-kit.js';
import { ABOVE_STRIKE_PERCENT, knownSum, stockMovePercent, triggerCeiling, type ListedOption } from './decisions.js';
import { positionVerification, type PremarketScan } from './scan.js';
import { calendarReference, usSessionDate } from './session.js';

type Row = PremarketScan['rows'][number];
export const REPORT_ARCHIVE_NAME = 'full-options-decision-report.md';
const number = (value: number | null | undefined) => value == null ? 'Unknown' : value.toLocaleString('en-US', { maximumFractionDigits: 8 });
const money = (value: number | null | undefined, currency: string) => value == null ? 'Unknown' : `${currency} ${number(value)}`;
const inline = (value: string) => escapeHtml(value.replace(/[\r\n]+/g, ' ')).replace(/[\\`*_\[\]|~$]/g, '\\$&');
const text = (value: string | null | undefined) => inline(value || 'Unknown');
const fields = (rows: Array<[string, string]>) => rows.map(([label, value]) =>
  `- **${inline(label)}** ${inline(value)}`).join('\n');
const notes = (items: string[]) => items.map(item => `- ${inline(item)}`).join('\n');
const stockQuote = (stock: Row['stock']) => stock
  ? `${money(stock.price, stock.currency)} · ${stock.field} · ${stock.asOf} · ${stock.source}`
  : 'Quote unavailable';

function details(summary: string, body: string) {
  return `<details>\n<summary>${escapeHtml(summary)}</summary>\n\n${body.trim()}\n\n</details>`;
}

function quote(option: ListedOption | null) {
  if (!option) return 'Exact option quote and contract terms are unavailable.';
  const q = option.quote;
  return fields([
    ['Listed contract', option.id], ['Strike and expiry', `${money(option.strike, option.currency)} · ${option.expiry}`],
    ['Exercise and delivery', `${option.exercise ?? 'Unknown'} · ${number(option.shares)} verified shares per contract`],
    ['Premium multiplier', number(option.premiumMultiplier)], ['Terms source', option.source],
    ['Reference bid / ask per unit', `${number(q.bid)} / ${number(q.ask)} ${option.currency}`],
    ['Bid / ask size in contracts', `${number(q.bidSize)} / ${number(q.askSize)}`],
    ['Volume / open interest', `${number(q.volume)} / ${number(q.openInterest)}`],
    ['IV (%) / delta / gamma / theta / vega / rho', [q.ivPercent, q.delta, q.gamma, q.theta, q.vega, q.rho].map(number).join(' / ')],
    ['Quotes collected / book as of / last trade', `${q.collectedAt} / ${q.bookAsOf ?? 'Unknown'} / ${q.lastTradeAt ?? 'Unknown'}`],
    ['Quote source', q.source], ...(q.greeksSource && q.greeksCollectedAt ? [['Greeks source and collection time',
      [q.greeksSource, q.greeksCollectedAt, q.snapshotAsOf && `snapshot updated ${q.snapshotAsOf}`,
        q.snapshotDate && `provider data date ${q.snapshotDate}`].filter(Boolean).join(' · ')] as [string, string]] : []),
  ]);
}

function positionEvidence(row: Row) {
  const { source, position: p, stock, unverified, history } = row;
  const { hold, close, calls, rolls, feeReference } = row.decision;
  const amount = (n: number | null | undefined) => money(n, p.currency);
  return `### ${text(source.label)} · ${text(p.expiry)} put · ${inline(amount(p.strike))}

**${unverified.length ? 'Trigger needs verification' : 'Triggered'}** · ${number(p.quantity)} contracts · account ${text(source.accountId)}

${fields([['Trigger ceiling', amount(triggerCeiling(p.strike))],
    ['Underlying quote', stockQuote(stock)],
    ['Distance from strike (%)', number(stock?.currency === p.currency ? stockMovePercent(stock.price, p.strike) : null)],
    ['Broker snapshot / native identity', `${source.asOf ?? 'Unknown'} · ${row.nativeId ?? 'Unknown'}`],
    ['Broker-reported settlement / shares per contract', `${row.recordedSettlement} / ${number(row.recordedShares)}`],
  ])}

${notes(unverified.map(issue => positionVerification[issue]))}

${details('Current put quote and terms', quote(p.listed))}

${details('Broker opening cash, actual fees and historical rolls', `
${fields([['Current opening proceeds', amount(history.cash.openGross)], ['Current actual opening fee cash / rebates', amount(history.cash.openFees)],
    ['Original opening proceeds for the reconciled quantity', amount(history.cash.originalGross)],
    ['Chain gross cash', amount(history.cash.chainGross)], ['Chain actual fee cash / rebates', amount(history.cash.chainFees)]])}

${notes(history.notices)}

${history.executions.map(fill => `Fill ${text(fill.execution_id)} · ${text(fill.executed_at)} broker clock · ${text(fill.contracts)} contracts · ${text(fill.currency)} ${text(fill.gross_premium)} gross · ${text(fill.commission)} fee cash. Full source fill quantities can include contracts already closed.`).join('\n\n')}

${history.rolls.map(roll => `#### ${text(roll.link.at)} · ${text(roll.link.evidence)} · ${text(roll.link.reason)}

${fields([['Rolled contract', `${roll.link.old.expiry} ${roll.link.old.strike} → ${roll.link.replacement.expiry} ${roll.link.replacement.strike}`],
    ['Old closing cash (signed)', amount(roll.buybackCash)], ['Replacement opening cash (signed)', amount(roll.replacementCash)],
    ['Actual fee cash / rebates', amount(roll.actualFees)], ['Recorded net or gross flow (' + roll.link.cash_basis + ')', roll.link.cash === null ? 'Unknown' : `${p.currency} ${roll.link.cash}`],
    ['Predecessor realized gross / net P&L', `${amount(roll.predecessorGross)} / ${amount(roll.predecessorNet)}`],
    ['Source archives', roll.link.sources.map(e => `${e.id} @ ${e.version}`).join(', ')],
    ['Closing and opening fill IDs', [...roll.link.closing_fills, ...roll.link.opening_fills].join(', ')]])}`).join('\n\n')}`)}

#### Hold and accept possible assignment

An American put can be assigned early. Check cash and confirm that you still want the shares even if the stock falls further. Expiry scenarios use the verified share deliverable and precede any future assignment fees.

${fields([['Shares received / exercise cash', `${number(hold.delivered)} / ${amount(hold.assignmentCash)}`],
    ['Days to contract expiry', number(hold.daysToExpiry)],
    ['Whole-strategy breakeven per share before future charges', amount(hold.breakeven)],
    ...(hold.breakeven === null && hold.currentPutBreakeven !== null
      ? [['Current put breakeven per share before future charges', amount(hold.currentPutBreakeven)] as [string, string]] : []),
    ['Cumulative net option cash to date', amount(hold.cumulativeNetCash)],
    ['Intrinsic / residual at the reference ask per unit', `${amount(hold.intrinsic)} / ${amount(hold.timeValueAtAsk)}`],
    ['Current leg / whole chain P&L at reference ask before new fees', `${amount(hold.currentLegPnlAtAsk)} / ${amount(hold.chainPnlAtAsk)}`],
    ['Whole-chain expiry P&L at strike', amount(hold.expiryAtStrike)],
    ['Whole-chain expiry P&L at scan stock price', amount(hold.expiryAtSpot)],
    ...(hold.expiryAtSpot === null && hold.currentPutExpiryAtSpot !== null
      ? [['Current put expiry P&L at scan stock price before future charges', amount(hold.currentPutExpiryAtSpot)] as [string, string]] : []),
    ['Whole-chain expiry P&L if stock goes to zero', amount(hold.expiryAtZero)]])}

#### Sell a covered call after assignment

Wait until the shares are delivered and available to cover the call. The reference bid is a conditional illustration. Refresh the option chain after assignment. Early call exercise can occur and can affect dividend entitlement. Stock remains exposed below the call strike. P&L includes assignment and the full option cash history, before dividends, taxes and unknown future costs.

${!calls.length ? 'Available covered-call candidates could not be established.' : calls.map(call => details(`${call.option.expiry} · ${amount(call.option.strike)} call · reference income ${amount(call.income)}`, `
${p.expiry >= call.option.expiry ? 'Requires assignment and share delivery before this call expires.' : ''}

${quote(call.option)}

${fields([['Call contracts / covered shares / shares left over', `${number(call.contracts)} / ${number(call.covered)} / ${number(call.leftover)}`],
      ['Call proceeds at reference bid / estimated call fee', `${amount(call.income)} / ${amount(call.feeEstimate)}`],
      ['Shares called away at strike (leftover shares valued at scan spot)', amount(call.ifCalled)],
      ['Called away including estimated call fee', amount(call.ifCalledWithEstimatedFee)],
      ['Not called away, shares marked at scan stock price', call.ifNotCalledAtScanSpotFeasibleAtExpiry === false ? 'Scan price is above the call strike at expiry' : amount(call.ifNotCalledAtScanSpot)],
      ['Not called away, shares fall to zero', amount(call.ifNotCalledAtZero)],
      ['Capped whole-chain P&L if all shares are covered', amount(call.upCap)]])}`)).join('\n\n')}

#### Roll the put

Buy back the current put and sell a different put on the same stock. Separate leg prices may change before a combined order can fill. A roll credit leaves past losses in the chain and the replacement can still be assigned early.

${fields([['Old put reference buyback / estimated fee', `${amount(close.buyback)} / ${amount(close.feeEstimate)}`],
    ['Old put P&L if closed at reference ask with estimated fee', amount(close.thisNetWithEstimatedFee)]])}

${!rolls.length ? 'Available replacement puts could not be established.' : rolls.map(roll => details(`${roll.option.expiry} · ${amount(roll.option.strike)} put · reference roll cash ${amount(roll.grossFlow)}`, `
${quote(roll.option)}

${fields([['New put proceeds at reference bid', amount(roll.newIncome)],
      ['Gross / estimated net roll cash', `${amount(roll.grossFlow)} / ${amount(roll.netFlowEstimate)}`],
      ['New exercise cash / shares received', `${amount(roll.assignmentCash)} / ${number(roll.shares)}`],
      ['Days to expiry / change in days', `${number(roll.daysToExpiry)} / ${number(roll.additionalDays)}`],
      ['Chain net cash after roll before future fees', amount(roll.chainNetBeforeFutureFees)],
      ['New economic breakeven / with estimated roll fees', `${amount(roll.breakeven)} / ${amount(roll.breakevenWithEstimatedFees)}`]])}`)).join('\n\n')}

#### Close the put

Buying back the full quantity removes this put's future assignment exposure after execution. The quoted debit and the profit or loss measure different cash flows.

${fields([['Reference buyback debit / estimated close fee', `${amount(close.buyback)} / ${amount(close.feeEstimate)}`],
    ['Current gross P&L before fees', amount(close.thisGrossBeforeFutureFees)], ['Current net P&L before future fee', amount(close.thisNetBeforeFutureFees)],
    ['Current net P&L with estimated close fee', amount(close.thisNetWithEstimatedFee)],
    ['Chain gross P&L before fees', amount(close.chainGrossBeforeFutureFees)], ['Chain net P&L before future fee', amount(close.chainNetBeforeFutureFees)],
    ['Chain net P&L with estimated close fee', amount(close.chainNetWithEstimatedFee)],
    ['Close preference, buyback strictly below', amount(close.preferredUnder)]])}

${feeReference ? `Fee estimate basis · ${text(feeReference)}.` : 'Future broker fees are unknown.'} Refresh actual fees, displayed size, prices and order terms before deciding.

`;
}

export type ReportTrigger = { kind: 'manual'; market: 'weekend' | 'holiday' | 'trading-day' | 'unknown' };
const manualMarkets = {
  weekend: 'U.S. weekend. The regular market is closed. Earlier quotes are references, and a prior-session stock quote cannot confirm a current trigger.',
  holiday: 'U.S. exchange holiday. The regular market is closed. Earlier quotes are references, and a prior-session stock quote cannot confirm a current trigger.',
  'trading-day': 'U.S. trading day. Outside regular hours, the latest quote may be from an earlier session. See the source timestamps and coverage notes.',
  unknown: 'The U.S. trading calendar is unavailable. Use the reported timestamps to assess quote freshness.',
};

export function reportCoverage(scan: PremarketScan) {
  const confirmed = scan.rows.filter(row => !row.unverified.length).length;
  const unverified = scan.rows.length - confirmed;
  return { confirmed, unverified, incomplete: !!(unverified || scan.notes.length || scan.sources.some(source => source.coverage.length)) };
}

function assignmentExposure(rows: Row[]) {
  const bySymbol = new Map<string, Map<string, Row[]>>();
  for (const row of rows) {
    const { stock, position } = row;
    if (!stock || stock.currency !== position.currency || stock.price >= position.strike) continue;
    const byCurrency = bySymbol.get(row.underlying) ?? new Map<string, Row[]>();
    const group = byCurrency.get(position.currency) ?? [];
    group.push(row);
    byCurrency.set(position.currency, group);
    bySymbol.set(row.underlying, byCurrency);
  }
  const exposures = [...bySymbol].flatMap(([symbol, byCurrency]) => [...byCurrency].map(([currency, group]) => {
    const amounts = group.map(row => row.decision.hold.assignmentCash).filter(value => value !== null);
    return { symbol, currency, group, cash: amounts.length ? knownSum(...amounts) : null, missing: group.length - amounts.length };
  }));
  if (!exposures.length) return '';
  exposures.sort((a, b) => a.currency.localeCompare(b.currency) || (b.cash ?? -Infinity) - (a.cash ?? -Infinity));
  return `## Assignment exposure\n\nGross cash if every displayed put with a stock reference below its strike is assigned. Figures use the recorded quantities and span the accounts named below. Verify the positions and available cash in each account.\n\n${fields(exposures.map(({ symbol, currency, group, cash, missing }) => {
    const total = cash === null ? 'Assignment cash unavailable'
      : missing ? `${money(cash, currency)} for positions with verified share deliverables · ${number(missing)} with unknown assignment cash` : money(cash, currency);
    const stock = group[0].stock!;
    return [symbol, `${total} · ${number(group.length)} below-strike positions · stock ${money(stock.price, currency)} as of ${stock.asOf}`];
  }))}`;
}

function optionPriceReference(option: ListedOption | null, date: string) {
  const quote = option?.quote;
  if (quote?.bookAsOf) {
    const label = usSessionDate(new Date(quote.bookAsOf)) === date ? 'Same-session book' : 'Historical book';
    return `${label} as of ${quote.bookAsOf}`;
  }
  if (quote?.priceFromSnapshot && quote.snapshotDate) return `Provider price snapshot dated ${quote.snapshotDate} · bid/ask time unavailable`;
  return 'Bid/ask time unavailable';
}

const rollReferenceLabels = {
  quoted: 'Quoted roll references',
  equalOrHigherCash: 'Rolls with equal or higher assignment cash',
  lowerCashLater: 'Lower assignment cash, later expiry',
  lowerCashSameOrEarlier: 'Lower assignment cash, same or earlier expiry',
};

function rollReferences(row: Row, date: string): Array<[string, string]> {
  if (!row.rollReferences.length) return [['Roll', 'Refresh the held put ask and replacement bids to compare roll cash and the new assignment exposure.']];
  const amount = (n: number | null) => money(n, row.position.currency);
  return row.rollReferences.map(({ kind, example, count, minDays, maxDays }) => {
    const { option, assignmentCash, additionalDays } = example;
    const cash = row.decision.rolls.find(roll => roll.option.id === option.id)?.grossFlow ?? null;
    const flow = cash === null ? 'gross roll cash unavailable' : `${amount(cash)} gross roll cash`;
    const quote = `${amount(option.quote.bid)} bid / ${amount(option.quote.ask)} ask per unit · ${optionPriceReference(option, date)}`;
    const change = minDays === maxDays ? number(minDays) : `${number(minDays)} to ${number(maxDays)}`;
    const contract = `${amount(option.strike)} put expiring ${option.expiry}`;
    const intro = count === 1 ? `${contract} calls for`
      : `Expiry changes range from ${change} days. The ${contract} has this group's lowest assignment cash at`;
    return [rollReferenceLabels[kind], `${intro} ${amount(assignmentCash)} if assigned, with ${flow} and an expiry change of ${number(additionalDays)} days. Replacement quote ${quote}.`];
  });
}

function positionChecks(row: Row, date: string) {
  const checks = row.unverified.map(issue => {
    if (issue === 'broker' && row.source.asOf && row.source.asOf < date) {
      return `Broker positions dated ${row.source.asOf}. Check for fills and assignments since then.`;
    }
    return positionVerification[issue];
  });
  if (row.decision.hold.assignmentCash === null) checks.push('Confirm the share deliverable to calculate assignment cash.');
  if (row.decision.hold.cumulativeNetCash === null) checks.push(...row.history.notices);
  return checks.join(' ');
}

function positionSummary(scan: PremarketScan) {
  const labels = new Map<string, number>();
  for (const source of scan.sources) labels.set(source.label, (labels.get(source.label) ?? 0) + 1);
  const rows = [...scan.rows].sort((a, b) => a.position.expiry.localeCompare(b.position.expiry)).map(row => {
    const { position, source, stock, decision } = row;
    const { close, hold } = decision;
    const account = (labels.get(source.label) ?? 0) > 1 ? `${source.label} · ${source.accountId}` : source.label;
    const contract = `${row.underlying} ${money(position.strike, position.currency)} put`;
    const quantity = `${number(position.quantity)} ${position.quantity === 1 ? 'contract' : 'contracts'}`;
    const amount = (n: number | null) => money(n, position.currency);
    const compareStrike = stock?.currency === position.currency
      ? stock.price < position.strike ? 'below strike' : stock.price > position.strike ? 'above strike' : 'at strike'
      : '';
    const stockRef = stock ? [money(stock.price, stock.currency), compareStrike,
      `${usSessionDate(new Date(stock.asOf)) === scan.session.date ? 'as of' : 'historical quote as of'} ${stock.asOf}`].filter(Boolean).join(' · ') : 'Unavailable';
    const closePnl = close.chainNetBeforeFutureFees !== null ? `strategy P&L before close fee ${amount(close.chainNetBeforeFutureFees)}`
      : close.thisNetBeforeFutureFees !== null ? `current leg P&L before close fee ${amount(close.thisNetBeforeFutureFees)}` : 'P&L unavailable';
    const closeReference = close.buyback === null ? 'Buyback unavailable. Refresh the exact put ask.' : [
      `buyback ${amount(close.buyback)}`, closePnl, `estimated close fee ${amount(close.feeEstimate)}`,
      optionPriceReference(position.listed, scan.session.date),
      close.highlight ? `Reference buyback is below the closing preference of ${amount(close.preferredUnder)}` : '',
    ].filter(Boolean).join(' · ');
    const breakeven = hold.breakeven !== null ? `whole-strategy breakeven ${amount(hold.breakeven)} per share`
      : hold.currentPutBreakeven !== null ? `current put breakeven ${amount(hold.currentPutBreakeven)} per share` : '';
    const expiry = hold.expiryAtSpot !== null ? `whole-strategy expiry P&L ${amount(hold.expiryAtSpot)}`
      : hold.currentPutExpiryAtSpot !== null ? `current put expiry P&L ${amount(hold.currentPutExpiryAtSpot)}` : '';
    const unavailable = hold.breakeven === null && hold.expiryAtSpot === null ? 'whole-strategy breakeven and expiry P&L unavailable'
      : hold.breakeven === null ? 'whole-strategy breakeven unavailable' : hold.expiryAtSpot === null ? 'expiry P&L at the reference stock price unavailable' : '';
    const holdReference = [
      `cash if assigned ${amount(hold.assignmentCash)} for ${number(hold.delivered)} shares`,
      breakeven && `${breakeven} before future charges`,
      expiry && `${expiry} at the reference stock price before future charges`,
      unavailable,
    ].filter(Boolean).join(' · ');
    const checks = positionChecks(row, scan.session.date);
    const comparison: Array<[string, string]> = [
      ['Underlying', stockRef], ['Close', closeReference], ['Hold', holdReference], ...rollReferences(row, scan.session.date),
    ];
    if (checks) comparison.push(['Verify', checks]);
    return `### ${inline(contract)} · ${text(position.expiry)} · ${inline(account)} · ${inline(quantity)}\n\n${fields(comparison)}`;
  });
  return rows.join('\n\n');
}

export function renderPremarketReport(scan: PremarketScan, trigger?: ReportTrigger) {
  const bySymbol = new Map<string, Row[]>();
  for (const row of scan.rows) bySymbol.set(row.underlying, [...(bySymbol.get(row.underlying) ?? []), row]);
  const { confirmed, unverified, incomplete } = reportCoverage(scan);
  const title = trigger?.kind === 'manual'
    ? `Options decision report · ${scan.startedAt}` : `Premarket options · ${scan.session.date}`;
  const additionalQuotes = trigger
    ? [...scan.stocks].filter(([symbol]) => !bySymbol.has(symbol)).map(([symbol, evidence]): [string, string] =>
      [symbol, stockQuote(evidence.stock)])
    : [];
  const sections = [...bySymbol].map(([symbol, rows]) => {
    const currencies = [...new Set(rows.map(row => row.position.currency))];
    const totals = currencies.flatMap(currency => {
      const matching = rows.filter(row => row.position.currency === currency && !row.unverified.length);
      if (!matching.length) return [];
      return [`${number(matching.length)} confirmed positions · assignment cash across these positions ${money(knownSum(...matching.map(row => row.decision.hold.assignmentCash)), currency)} · chain net cash to date ${money(knownSum(...matching.map(row => row.decision.hold.cumulativeNetCash)), currency)}`];
    });
    const chain = scan.market.get(symbol);
    const heading = [`## ${text(symbol)}`, ...totals.map(inline),
      ...(chain ? [notes([...chain.events.map(event => `${event.date} · ${event.kind} · ${event.detail} · ${event.source}`), ...chain.notices])] : [])];
    return [...heading, ...rows.map(positionEvidence)].filter(Boolean).join('\n\n');
  });
  const introduction = [
    trigger?.kind === 'manual' ? `**Generated on demand** · ${manualMarkets[trigger.market]}` : '',
    `${number(confirmed)} confirmed triggers · ${number(unverified)} need verification`,
    fields([[trigger ? 'U.S. scan date' : 'U.S. trading session', scan.session.date], ['Last included expiry', scan.session.windowEnd],
      ['Scan start / collection completed (UTC)', `${scan.startedAt} / ${scan.collectedAt}`],
      ...(trigger ? [['Short puts checked before eligibility filters', number(scan.inspected)] as [string, string]] : []),
      ['Saved execution history revision', number(scan.revision)], ['Trading calendar', calendarReference]]),
    trigger ? `The scan covers open short American puts expiring from the scan date through the last included expiry. The underlying price can be at most ${ABOVE_STRIKE_PERCENT}% above the strike.` : '',
    'All comparisons use the same underlying observation per symbol and option prices collected during this scan. Books without a source timestamp can carry prior-session prices. Reference bid and ask calculations do not establish trade execution. Values are kept in broker currency. Economic breakeven reflects strategy cash flows without establishing a tax basis.',
    notes(scan.notes),
    '## Broker position evidence',
    ...scan.sources.map(source => details([source.label, source.broker, source.accountId].join(' · '), [
      fields([['Positions as of / captured at', `${source.asOf ?? 'Unknown'} / ${source.capturedAt ?? 'Unknown'}`],
        ['Raw snapshot reference and checksum', source.reference ?? 'Unknown']]),
      notes(source.coverage),
    ].filter(Boolean).join('\n\n'))),
    ...(additionalQuotes.length ? ['## Other underlying quotes checked', fields(additionalQuotes)] : []),
  ];
  const empty = incomplete
    ? 'Coverage is incomplete. The available records cannot establish whether any positions met the scan criteria.'
    : 'No position met the scan criteria in the available broker snapshots.';
  const marketNote = trigger?.market === 'weekend' ? 'U.S. weekend. Quotes are references from earlier sessions.'
    : trigger?.market === 'holiday' ? 'U.S. market holiday. Quotes are references from earlier sessions.'
    : trigger?.market === 'unknown' ? 'The U.S. trading calendar is unavailable. Check the quote times in the appendix.' : '';
  const body = [
    `**${number(confirmed)} confirmed triggers · ${number(unverified)} need verification** · U.S. scan ${text(scan.session.date)} · expiries through ${text(scan.session.windowEnd)}`,
    marketNote,
    unverified && scan.rows.every(row => row.unverified.includes('underlyingQuote'))
      ? 'A same-session stock quote was unavailable for every position shown. Use the comparisons as reference scenarios and refresh quotes for a current decision.' : '',
    notes(scan.notes),
    notes(scan.sources.filter(source => source.coverage.length).map(source => `${source.label} · account ${source.accountId} needs a broker position refresh or reconciliation.`)),
    assignmentExposure(scan.rows),
    scan.rows.length ? `## Positions to review\n\n${positionSummary(scan)}` : empty,
    scan.rows.length ? 'A filled close removes assignment exposure on that put. Holding keeps exposure to further stock declines and can result in early assignment. Before rolling, get a combined order quote. Roll cash uses reference bids and asks that may come from different times. Negative roll cash is a debit. After assignment and share delivery, a covered call can earn premium and caps upside on the covered shares.' : '',
    '## Appendix',
    `In **Note details**, download **${REPORT_ARCHIVE_NAME}** for quote times, broker records, and the full comparisons for holding, closing, rolling, and selling covered calls after assignment.`,
  ].filter(Boolean).join('\n\n');
  const completeBody = [`# ${inline(title)} · Appendix`, ...introduction, ...(sections.length ? sections : [empty])]
    .filter(Boolean).join('\n\n');
  return { title, body, completeBody };
}
