import { escapeHtml } from '../report/html-kit.js';
import { knownSum, stockMovePercent, triggerCeiling, type ListedOption } from './decisions.js';
import type { PremarketScan } from './scan.js';
import { calendarReference } from './session.js';

type Row = PremarketScan['rows'][number];
const number = (value: number | null | undefined) => value == null ? 'Unknown' : value.toLocaleString('en-US', { maximumFractionDigits: 8 });
const money = (value: number | null | undefined, currency: string) => value == null ? 'Unknown' : `${currency} ${number(value)}`;
const inline = (value: string) => escapeHtml(value.replace(/[\r\n]+/g, ' ')).replace(/[\\`*_\[\]|~$]/g, '\\$&');
const text = (value: string | null | undefined) => inline(value || 'Unknown');
const fields = (rows: Array<[string, string]>) => rows.map(([label, value]) =>
  `- **${inline(label)}** ${inline(value)}`).join('\n');
const notes = (items: string[]) => items.map(item => `- ${inline(item)}`).join('\n');

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
    ['Quote source', q.source], ...(q.greeksSource && q.greeksCollectedAt ? [['Greeks source and collection time', `${q.greeksSource} · ${q.greeksCollectedAt}`] as [string, string]] : []),
  ]);
}

function position(row: Row) {
  const { source, position: p, stock, unverified, history } = row;
  const { hold, close, calls, rolls, feeReference } = row.decision;
  const amount = (n: number | null | undefined) => money(n, p.currency);
  const check = unverified.length
    ? 'Verify the position, exact contract and current quotes before relying on the comparison.'
    : close.highlight
      ? 'Review closing first. The reference buyback is below your preference threshold. Recheck the ask and fees before trading.'
      : 'Compare holding with your willingness to own the shares at the economic breakeven. Review closing if that willingness or available cash changes. A roll needs a suitable new strike and expiry, and a covered call needs delivered shares and a suitable cap.';
  return `### ${text(source.label)} · ${text(p.expiry)} put · ${inline(amount(p.strike))}

**${unverified.length ? 'Trigger needs verification' : 'Triggered'}** · ${number(p.quantity)} contracts · account ${text(source.accountId)}

${fields([['Trigger ceiling', amount(triggerCeiling(p.strike))],
    ['Underlying quote', stock ? `${money(stock.price, stock.currency)} · ${stock.field} · ${stock.asOf} · ${stock.source}` : 'Unknown'],
    ['Distance from strike (%)', number(stock?.currency === p.currency ? stockMovePercent(stock.price, p.strike) : null)],
    ['Broker snapshot / native identity', `${source.asOf ?? 'Unknown'} · ${row.nativeId ?? 'Unknown'}`],
    ['Broker-reported settlement / shares per contract', `${row.recordedSettlement} / ${number(row.recordedShares)}`],
  ])}

${notes(unverified)}

**Decision note** ${inline(check)} Recheck after a quote move, a fill or assignment, a change in contract terms, or an issuer announcement.

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
    ['Economic breakeven per share before future charges', amount(hold.breakeven)],
    ['Cumulative net option cash to date', amount(hold.cumulativeNetCash)],
    ['Intrinsic / residual at the reference ask per unit', `${amount(hold.intrinsic)} / ${amount(hold.timeValueAtAsk)}`],
    ['Current leg / whole chain P&L at reference ask before new fees', `${amount(hold.currentLegPnlAtAsk)} / ${amount(hold.chainPnlAtAsk)}`],
    ['Whole-chain expiry P&L at strike', amount(hold.expiryAtStrike)],
    ['Whole-chain expiry P&L at scan stock price', amount(hold.expiryAtSpot)],
    ['Whole-chain expiry P&L if stock goes to zero', amount(hold.expiryAtZero)]])}

#### Sell a covered call after assignment

Wait until the shares are delivered and available to cover the call. Today's bid is a conditional illustration. Refresh the option chain after assignment. Early call exercise can occur and can affect dividend entitlement. Stock remains exposed below the call strike. P&L includes assignment and the full option cash history, before dividends, taxes and unknown future costs.

${calls.length ? calls.map(call => details(`${call.option.expiry} · ${amount(call.option.strike)} call · reference income ${amount(call.income)}`, `
${p.expiry >= call.option.expiry ? 'Requires assignment and share delivery before this call expires.' : ''}

${quote(call.option)}

${fields([['Call contracts / covered shares / shares left over', `${number(call.contracts)} / ${number(call.covered)} / ${number(call.leftover)}`],
      ['Call proceeds at reference bid / estimated call fee', `${amount(call.income)} / ${amount(call.feeEstimate)}`],
      ['Shares called away at strike (leftover shares valued at scan spot)', amount(call.ifCalled)],
      ['Called away including estimated call fee', amount(call.ifCalledWithEstimatedFee)],
      ['Not called away, shares marked at scan stock price', call.ifNotCalledAtScanSpotFeasibleAtExpiry === false ? 'Scan price is above the call strike at expiry' : amount(call.ifNotCalledAtScanSpot)],
      ['Not called away, shares fall to zero', amount(call.ifNotCalledAtZero)],
      ['Capped whole-chain P&L if all shares are covered', amount(call.upCap)]])}`)).join('\n\n') : 'Available covered-call candidates could not be established.'}

#### Roll the put

Buy back the current put and sell a different put on the same stock. Separate leg prices may change before a combined order can fill. A roll credit leaves past losses in the chain and the replacement can still be assigned early.

${fields([['Old put reference buyback / estimated fee', `${amount(close.buyback)} / ${amount(close.feeEstimate)}`],
    ['Old put P&L if closed at reference ask with estimated fee', amount(close.thisNetWithEstimatedFee)]])}

${rolls.length ? rolls.map(roll => details(`${roll.option.expiry} · ${amount(roll.option.strike)} put · reference roll cash ${amount(roll.grossFlow)}`, `
${quote(roll.option)}

${fields([['New put proceeds at reference bid', amount(roll.newIncome)],
      ['Gross / estimated net roll cash', `${amount(roll.grossFlow)} / ${amount(roll.netFlowEstimate)}`],
      ['New exercise cash / shares received', `${amount(roll.assignmentCash)} / ${number(roll.shares)}`],
      ['Days to expiry / change in days', `${number(roll.daysToExpiry)} / ${number(roll.additionalDays)}`],
      ['Chain net cash after roll before future fees', amount(roll.chainNetBeforeFutureFees)],
      ['New economic breakeven / with estimated roll fees', `${amount(roll.breakeven)} / ${amount(roll.breakevenWithEstimatedFees)}`]])}`)).join('\n\n') : 'Available replacement puts could not be established.'}

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

export function renderPremarketReport(scan: PremarketScan) {
  const bySymbol = new Map<string, Row[]>();
  for (const row of scan.rows) bySymbol.set(row.underlying, [...(bySymbol.get(row.underlying) ?? []), row]);
  const confirmed = scan.rows.filter(row => !row.unverified.length).length;
  const title = `Premarket options · ${scan.session.date}`;
  const sections = [...bySymbol].map(([symbol, rows]) => {
    const currencies = [...new Set(rows.map(row => row.position.currency))];
    const totals = currencies.flatMap(currency => {
      const matching = rows.filter(row => row.position.currency === currency && !row.unverified.length);
      if (!matching.length) return [];
      return [`${number(matching.length)} confirmed positions · assignment cash across these positions ${money(knownSum(...matching.map(row => row.decision.hold.assignmentCash)), currency)} · chain net cash to date ${money(knownSum(...matching.map(row => row.decision.hold.cumulativeNetCash)), currency)}`];
    });
    const chain = scan.market.get(symbol);
    return [`## ${text(symbol)}`, ...totals.map(inline),
      ...(chain ? [notes([...chain.events.map(event => `${event.date} · ${event.kind} · ${event.detail} · ${event.source}`), ...chain.notices])] : []),
      ...rows.map(position)].filter(Boolean).join('\n\n');
  });
  const body = [
    `${number(confirmed)} confirmed triggers · ${number(scan.rows.length - confirmed)} need verification`,
    fields([['U.S. trading session', scan.session.date], ['Last included expiry', scan.session.windowEnd],
      ['Scan start / collection completed (UTC)', `${scan.startedAt} / ${scan.collectedAt}`],
      ['Saved execution history revision', number(scan.revision)], ['Trading calendar', calendarReference]]),
    'All comparisons use the same underlying observation per symbol and option prices collected during this scan. Books without a source timestamp can carry prior-session prices. Reference bid and ask calculations do not establish trade execution. Values are kept in broker currency. Economic breakeven reflects strategy cash flows without establishing a tax basis.',
    notes(scan.notes),
    '## Broker position evidence',
    ...scan.sources.map(source => details([source.label, source.broker, source.accountId].join(' · '), [
      fields([['Positions as of / captured at', `${source.asOf ?? 'Unknown'} / ${source.capturedAt ?? 'Unknown'}`],
        ['Raw snapshot reference and checksum', source.reference ?? 'Unknown']]),
      notes(source.coverage),
    ].filter(Boolean).join('\n\n'))),
    ...(sections.length ? sections : ['No position met the scan criteria in the available broker snapshots.']),
  ].filter(Boolean).join('\n\n');
  return { title, body };
}
