import { escapeHtml } from '../report/html-kit.js';
import { ABOVE_STRIKE_PERCENT, knownSum, selectRollReferences, stockMovePercent, triggerCeiling, type ListedOption } from './decisions.js';
import { positionVerification, type PremarketScan } from './scan.js';
import { calendarReference, usSessionDate } from './session.js';

type Row = PremarketScan['rows'][number];
export const REPORT_ARCHIVE_NAME = 'full-options-decision-report.md';
const number = (value: number | null | undefined) => value == null ? 'Unknown' : value.toLocaleString('en-US', { maximumFractionDigits: 8 });
const money = (value: number | null | undefined, currency: string) => value == null ? 'Unknown' : `${currency} ${number(value)}`;
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
const calendarDate = (date: string) => dateFormat.format(new Date(date));
const quoteTime = (date: string) => `${calendarDate(date)} at ${timeFormat.format(new Date(date))} UTC`;
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

**${unverified.length ? 'Position needs verification' : 'Meets the scan criteria'}** · ${number(p.quantity)} contracts · account ${text(source.accountId)}

${fields([['Trigger ceiling', amount(triggerCeiling(p.strike))],
    ['Underlying quote', stockQuote(stock)],
    ['Distance from strike (%)', number(stock?.currency === p.currency ? stockMovePercent(stock.price, p.strike) : null)],
    ['Broker snapshot / native identity', `${source.asOf ?? 'Unknown'} · ${row.nativeId ?? 'Unknown'}`],
    ['Broker-reported settlement / shares per contract', `${row.recordedSettlement} / ${number(row.recordedShares)}`],
  ])}

${notes(unverified.map(issue => positionVerification[issue]))}

${details('Current put quote and terms', quote(p.listed))}

${details('Opening trades, fees and earlier rolls', `
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

You can be assigned before expiry. If assigned, you buy the shares at the strike price. The expiry figures use the verified share count and exclude future assignment fees.

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

These examples assume you have received the shares and can use them to cover the call. A call brings in premium and caps gains on the shares it covers. The shares can still fall in value, and early exercise can affect dividends. The figures include assignment and the full option history, before dividends, taxes and future charges.

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

A roll buys back the current put and sells another put on the same stock. The two quotes can change before the order fills. Earlier gains and losses still count toward the strategy result, and the new put can be assigned early.

${fields([['Old put reference buyback / estimated fee', `${amount(close.buyback)} / ${amount(close.feeEstimate)}`],
    ['Old put P&L if closed at reference ask with estimated fee', amount(close.thisNetWithEstimatedFee)]])}

${!rolls.length ? 'Available replacement puts could not be established.' : rolls.map(roll => details(`${roll.option.expiry} · ${amount(roll.option.strike)} put · reference roll cash ${amount(roll.grossFlow)}`, `
${quote(roll.option)}

${fields([['New put proceeds at reference bid', amount(roll.newIncome)],
      ['Cash received or paid to roll, before fees / after estimated fees', `${amount(roll.grossFlow)} / ${amount(roll.netFlowEstimate)}`],
      ['New exercise cash / shares received', `${amount(roll.assignmentCash)} / ${number(roll.shares)}`],
      ['Days to expiry / change in days', `${number(roll.daysToExpiry)} / ${number(roll.additionalDays)}`],
      ['Chain net cash after roll before future fees', amount(roll.chainNetBeforeFutureFees)],
      ['New economic breakeven / with estimated roll fees', `${amount(roll.breakeven)} / ${amount(roll.breakevenWithEstimatedFees)}`]])}`)).join('\n\n')}

#### Close the put

Once the full buyback fills, you can no longer be assigned on this put. The buyback amount is what you pay now. The profit or loss also includes the premiums and fees already recorded.

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
  weekend: 'The regular U.S. market is closed for the weekend. Prices from the previous session are for comparison.',
  holiday: 'The regular U.S. market is closed for a holiday. Prices from the previous session are for comparison.',
  'trading-day': 'Check the quote times when comparing prices outside regular U.S. trading hours.',
  unknown: 'The U.S. trading calendar was unavailable. Check the reported quote times.',
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
  return `## Cash needed if assigned, by stock\n\nThis is what you would pay if every listed put whose stock price is below the strike were assigned. Totals span the accounts shown above.\n\n${fields(exposures.map(({ symbol, currency, group, cash, missing }) => {
    const total = cash === null ? 'Assignment cash unavailable'
      : missing ? `${money(cash, currency)} for positions with verified share deliverables · ${number(missing)} with unknown assignment cash` : money(cash, currency);
    const stock = group[0].stock!;
    return [symbol, `${total} across ${number(group.length)} ${group.length === 1 ? 'position' : 'positions'} below strike. Stock quoted at ${money(stock.price, currency)} on ${quoteTime(stock.asOf)}.`];
  }))}`;
}

function optionPriceReference(option: ListedOption | null, date: string) {
  const quote = option?.quote;
  if (quote?.bookAsOf) {
    const bookTime = new Date(quote.bookAsOf);
    const label = usSessionDate(bookTime) === date ? 'Same-session order book' : 'Historical order book';
    return `${label} from ${quoteTime(quote.bookAsOf)}`;
  }
  if (quote?.priceFromSnapshot && quote.snapshotDate) {
    return `Provider snapshot from ${calendarDate(quote.snapshotDate)}. Bid and ask time unavailable`;
  }
  return 'Bid and ask time unavailable';
}

const rollReferenceLabels = {
  quoted: 'Credit roll',
  equalOrHigherCash: 'Credit roll with the same or more cash due if assigned',
  lowerCashLater: 'Credit roll with less cash due if assigned and a later expiry',
  lowerCashSameOrEarlier: 'Credit roll with less cash due if assigned and the same or earlier expiry',
};

function rollReferences(row: Row, date: string): Array<[string, string]> {
  const references = selectRollReferences(row.decision);
  if (!references.length) return [['Roll', 'No credit roll was found in the available quotes. Other roll prices are in the appendix.']];
  const amount = (n: number | null) => money(n, row.position.currency);
  const buyback = row.decision.close.buyback;
  const currentAssignment = row.decision.hold.assignmentCash;
  return references.map(({ kind, example }) => {
    const { option, assignmentCash, additionalDays, grossFlow, netFlowEstimate, newIncome, shares } = example;
    const flow = netFlowEstimate === null ? `At these prices, the credit would be ${amount(grossFlow)} before fees. Fees are unknown.`
      : `At these prices, the credit would be ${amount(netFlowEstimate)} after estimated fees (${amount(grossFlow)} before fees).`;
    const contract = `${amount(option.strike)} put expiring ${calendarDate(option.expiry)}`;
    const days = Math.abs(additionalDays);
    const expiryChange = additionalDays === 0 ? 'The expiry date stays the same.'
      : `The new put expires ${number(days)} ${days === 1 ? 'day' : 'days'} ${additionalDays < 0 ? 'earlier' : 'later'} than the current put.`;
    const shareCount = shares === null ? '' : ` for ${number(shares)} shares`;
    const prior = currentAssignment === null ? '' : currentAssignment === assignmentCash ? ', the same cash as on the current put'
      : `, compared with ${amount(currentAssignment)} on the current put`;
    return [rollReferenceLabels[kind], [flow,
      `Buying back the current put would cost ${amount(buyback)}. Selling the ${contract} would bring in ${amount(newIncome)}.`,
      `If assigned on the new put, you would pay ${amount(assignmentCash)}${shareCount}${prior}.`, expiryChange,
      `The replacement quote was ${amount(option.quote.bid)} bid and ${amount(option.quote.ask)} ask per unit. ${optionPriceReference(option, date)}.`,
    ].filter(Boolean).join(' ')];
  });
}

function positionChecks(row: Row, date: string) {
  const checks = row.unverified.map(issue => {
    if (issue === 'broker' && row.source.asOf && row.source.asOf < date) {
      return `The broker last reported this position on ${calendarDate(row.source.asOf)}. Check for trades and assignments since then.`;
    }
    return positionVerification[issue];
  });
  if (row.decision.hold.assignmentCash === null) checks.push('Confirm how many shares the contract would deliver.');
  if (row.decision.hold.cumulativeNetCash === null) checks.push('Earlier trades or fees could not be fully verified.');
  return checks.join(' ');
}

function positionsInReviewOrder(rows: Row[]) {
  return rows.map(row => {
    const { stock, position } = row;
    const distance = stock?.currency === position.currency ? stockMovePercent(stock.price, position.strike) : NaN;
    const group = !Number.isFinite(distance) ? 1 : distance <= 0 ? 0 : 2;
    return { row, group, distance };
  }).sort((a, b) => a.group - b.group || (a.group === 1 ? 0 : a.distance - b.distance) ||
    a.row.position.expiry.localeCompare(b.row.position.expiry)).map(item => item.row);
}

function gainOrLoss(value: number, currency: string) {
  return value < 0 ? `a loss of ${money(-value, currency)}` : value > 0 ? `a gain of ${money(value, currency)}` : 'no gain or loss';
}

function positionSummary(scan: PremarketScan, positions: Row[]) {
  const labels = new Map<string, number>();
  for (const source of scan.sources) labels.set(source.label, (labels.get(source.label) ?? 0) + 1);
  const rows = positions.map(row => {
    const { position, source, stock, decision } = row;
    const { close, hold } = decision;
    const account = (labels.get(source.label) ?? 0) > 1 ? `${source.label} · ${source.accountId}` : source.label;
    const contract = `${row.underlying} ${money(position.strike, position.currency)} put`;
    const quantity = `${number(position.quantity)} ${position.quantity === 1 ? 'contract' : 'contracts'}`;
    const amount = (n: number | null) => money(n, position.currency);
    const compareStrike = stock?.currency === position.currency
      ? stock.price < position.strike ? 'below strike' : stock.price > position.strike ? 'above strike' : 'at strike'
      : '';
    const stockRef = stock ? `${money(stock.price, stock.currency)}${compareStrike ? `, ${compareStrike}` : ''}. ${
      usSessionDate(new Date(stock.asOf)) === scan.session.date ? 'Quoted' : 'Historical quote from'} ${quoteTime(stock.asOf)}.` : 'Stock quote unavailable.';
    const closeOutcome = close.chainNetBeforeFutureFees ?? close.thisNetBeforeFutureFees;
    const closeScope = close.chainNetBeforeFutureFees !== null ? 'for the whole strategy' : 'for the current put';
    const closeReference = close.buyback === null ? 'Buyback price unavailable.' : [
      `Buying back the puts would cost ${amount(close.buyback)} before fees.`,
      closeOutcome === null ? 'Profit or loss at that price is unavailable.'
        : `Closing at that price would mean ${gainOrLoss(closeOutcome, position.currency)} ${closeScope} before the closing fee.`,
      `Estimated fee ${amount(close.feeEstimate)}.`, `${optionPriceReference(position.listed, scan.session.date)}.`,
      close.highlight ? `The buyback is below your closing threshold of ${amount(close.preferredUnder)}.` : '',
    ].filter(Boolean).join(' ');
    const breakeven = hold.breakeven ?? hold.currentPutBreakeven;
    const expiry = hold.expiryAtSpot ?? hold.currentPutExpiryAtSpot;
    const breakevenScope = hold.breakeven !== null ? 'for the whole strategy' : 'for the current put';
    const expiryScope = hold.expiryAtSpot !== null ? 'for the whole strategy' : 'for the current put';
    const holdReference = [
      hold.assignmentCash === null ? 'Cash needed if assigned is unknown.' : `If assigned, you would pay ${amount(hold.assignmentCash)} for ${number(hold.delivered)} shares.`,
      breakeven === null ? 'Breakeven is unavailable.' : `Breakeven ${amount(breakeven)} per share ${breakevenScope}, before future charges.`,
      expiry === null ? 'Profit or loss at expiry at the quoted stock price is unavailable.'
        : `If the stock is still at the quoted price at expiry, that would mean ${gainOrLoss(expiry, position.currency)} ${expiryScope} before future charges.`,
      hold.cumulativeNetCash === null && (breakeven !== null || expiry !== null) ? 'Whole-strategy figures are unavailable.' : '',
    ].filter(Boolean).join(' ');
    const checks = positionChecks(row, scan.session.date);
    const comparison: Array<[string, string]> = [['Stock price', stockRef]];
    if (checks) comparison.push(['What to verify', checks]);
    comparison.push(['Close', closeReference], ['Hold', holdReference], ...rollReferences(row, scan.session.date));
    return `### ${inline(contract)} · expires ${text(calendarDate(position.expiry))} · ${inline(account)} · ${inline(quantity)}\n\n${fields(comparison)}`;
  });
  return rows.join('\n\n');
}

export function renderPremarketReport(scan: PremarketScan, trigger?: ReportTrigger) {
  const positions = positionsInReviewOrder(scan.rows);
  const bySymbol = new Map<string, Row[]>();
  for (const row of positions) bySymbol.set(row.underlying, [...(bySymbol.get(row.underlying) ?? []), row]);
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
    ? 'Some broker or quote data is missing. The available records do not show whether any positions met the scan criteria.'
    : 'No positions met the scan criteria in the broker snapshots.';
  const marketNote = trigger?.market === 'weekend' ? 'U.S. weekend. Quotes are references from earlier sessions.'
    : trigger?.market === 'holiday' ? 'U.S. market holiday. Quotes are references from earlier sessions.'
    : trigger?.market === 'unknown' ? 'The U.S. trading calendar is unavailable. Check the quote times in the appendix.' : '';
  const body = [
    `**${number(confirmed)} ${confirmed === 1 ? 'position meets' : 'positions meet'} the scan criteria. ${number(unverified)} ${unverified === 1 ? 'needs' : 'need'} verification.** U.S. scan ${text(calendarDate(scan.session.date))}. Expiries through ${text(calendarDate(scan.session.windowEnd))}.`,
    marketNote,
    unverified && scan.rows.every(row => row.unverified.includes('underlyingQuote'))
      ? 'Same-session stock prices were unavailable for all positions shown. Earlier quotes are for comparison.' : '',
    notes(scan.notes),
    notes(scan.sources.filter(source => source.coverage.length).map(source => `${source.label} · account ${source.accountId} needs a broker position refresh or reconciliation.`)),
    positions.length ? `## Positions to review\n\nPuts with stock at or below strike come first, starting with the stock furthest below its strike in percentage terms. Positions without a comparable stock price come next, then puts with stock above strike.\n\n${positionSummary(scan, positions)}` : empty,
    assignmentExposure(positions),
    positions.length ? 'A buyback removes assignment risk once it fills. Holding can lead to early assignment, and the stock can fall further. The two prices in a roll may come from different times. A covered call after share delivery brings in premium and limits gains on the shares it covers.' : '',
    '## Appendix',
    `In **Note details**, download **${REPORT_ARCHIVE_NAME}** for quote times, broker records, and the full comparisons for holding, closing, rolling, and selling covered calls after assignment.`,
  ].filter(Boolean).join('\n\n');
  const completeBody = [`# ${inline(title)} · Appendix`, ...introduction, ...(sections.length ? sections : [empty])]
    .filter(Boolean).join('\n\n');
  return { title, body, completeBody };
}
