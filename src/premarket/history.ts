import type { OptionExecution } from '../brokers/option-executions.js';
import type { OptionRelationship, RollContract } from '../brokers/option-relationships.js';
import { partialCloseSummary } from '../brokers/partial-close.js';
import type { Holding } from '../market/types.js';
import type { InvestorState } from '../state/portfolio-state.js';
import type { OpenOptionTradeDetail } from '../webapp/option-dashboard-data.js';
import type { prepareOptionRelationships } from '../webapp/option-relationships-data.js';
import { knownSum, type PositionCash } from './decisions.js';

type Relationships = Awaited<ReturnType<typeof prepareOptionRelationships>>;
export interface RollCashEvidence {
  link: OptionRelationship;
  buybackCash: number | null;
  replacementCash: number | null;
  actualFees: number | null;
  predecessorGross: number | null;
  predecessorNet: number | null;
}
function sameTerms(terms: RollContract, option: NonNullable<Holding['option']>, currency: string) {
  return terms.underlying === option.underlying && terms.expiry === option.expiry && terms.right === option.right &&
    Number(terms.strike) === option.strike && Number(terms.multiplier) === option.multiplier && terms.currency === currency;
}
function sameFillTerms(row: OptionExecution, t: RollContract) {
  return sameTerms(t, { ...row, strike: Number(row.strike), multiplier: Number(row.multiplier),
    side: 'short', mark: 0, settlement: 'physical' }, row.currency);
}
const exactIds = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const add = (rows: OptionExecution[], field: 'gross_premium' | 'commission') =>
  rows.length ? knownSum(...rows.map(row => row[field] === null ? null : Number(row[field]))) : null;

function actualRoll(link: OptionRelationship, executions: OptionExecution[], preceding?: OptionRelationship) {
  const fills = (ids: string[]) => ids.map(id => executions.find(row => row.execution_id === id || row.execution_id === `order:${id}`));
  const old = executions.filter(row => sameFillTerms(row, link.old) &&
    (row.effect === 'open' && row.side === 'sell' || row.effect === 'close' && row.side === 'buy'));
  const closes = fills(link.closing_fills).filter((row): row is OptionExecution => !!row && old.includes(row) && row.effect === 'close');
  const opens = fills(link.opening_fills).filter((row): row is OptionExecution =>
    !!row && sameFillTerms(row, link.replacement) && row.effect === 'open' && row.side === 'sell');
  const closure = closes.length === link.closing_fills.length ? partialCloseSummary(
    old.filter(row => row.executed_at <= closes.reduce((last, row) => row.executed_at > last ? row.executed_at : last, '')),
  ) : undefined;
  const realizations = closure?.realizations.filter(row => closes.some(close => close.execution_id === row.executionId)) ?? [];
  const openingIds = [...new Set(realizations.flatMap(row => row.openingExecutionIds))];
  const linked = (link.evidence === 'order' || link.evidence === 'execution') &&
    !!closes.length && closes.length === link.closing_fills.length &&
    !!opens.length && opens.length === link.opening_fills.length && !closure?.rounded && closure?.remaining !== undefined &&
    realizations.length === closes.length && Number(link.closed_quantity) === Number(link.opened_quantity) &&
    (!preceding || exactIds(openingIds, fills(preceding.opening_fills).flatMap(row => row ? [row.execution_id] : [])));
  const number = (field: 'gross' | 'net' | 'openingPremium') =>
    linked ? knownSum(...realizations.map(row => row[field] === null ? null : Number(row[field]))) : null;
  const predecessorGross = number('gross'), predecessorNet = number('net');
  const record: RollCashEvidence = { link,
    buybackCash: closes.length === link.closing_fills.length ? add(closes, 'gross_premium') : null,
    replacementCash: opens.length === link.opening_fills.length ? add(opens, 'gross_premium') : null,
    actualFees: closes.length === link.closing_fills.length && opens.length === link.opening_fills.length
      ? add([...closes, ...opens], 'commission') : null,
    predecessorGross, predecessorNet };
  return { record, originalGross: number('openingPremium'), linked };
}

export function positionHistory(state: InvestorState, relationships: Relationships | null,
  holding: Holding, accountId: string, detail: OpenOptionTradeDetail | undefined) {
  const id = holding.channel!, currency = holding.currency!;
  const matchingRows = (state.option_executions ?? []).filter(row => row.channel === id && row.account_id === accountId &&
    row.currency === currency && !row.spreadsheet_source);
  const executions = detail?.currency === currency ? matchingRows.filter(row => detail.openingExecutionIds.includes(row.execution_id)) : [];
  const openGross = executions.length ? detail?.stoGrossPremium ?? null : null;
  const openNet = executions.length ? detail?.stoNetPremium ?? null : null;
  const openFees = openGross !== null && openNet !== null ? openNet - openGross : null;
  const cash: PositionCash = { openGross, openFees, chainGross: null, chainFees: null, originalGross: null };
  const current = holding.option!;
  const groups = (relationships?.groups ?? []).filter(group => group.channel === id && group.account_id === accountId &&
    group.relationships[0]?.side === 'short' && sameTerms(group.latest, current, currency));
  const verified = groups.filter(group => !!detail && Number(group.latest_quantity) === holding.units &&
    exactIds(group.relationships[0].opening_fills, detail.openingExecutionIds.map(id => id.replace(/^order:/, ''))));
  const rolls: RollCashEvidence[] = [];
  const notices: string[] = [];
  if (verified.length === 1) {
    const links = [...verified[0].relationships].reverse();
    const results = links.map((link, index) => actualRoll(link, matchingRows, links[index - 1]));
    rolls.push(...results.map(item => item.record));
    if (results.every(item => item.linked)) {
      cash.originalGross = results[0].originalGross;
      cash.chainGross = knownSum(openGross, ...rolls.map(row => row.predecessorGross));
      cash.chainFees = knownSum(openFees, ...rolls.map(row => row.predecessorGross !== null && row.predecessorNet !== null
        ? row.predecessorNet - row.predecessorGross : null));
    }
  } else if (groups.length) {
    for (const group of groups) rolls.push(...group.relationships.map(link => actualRoll(link, matchingRows).record));
    notices.push('Recorded roll candidates do not uniquely reconcile to current opening fills and quantity.');
  } else {
    const accountHistory = state.broker_history?.[id];
    const orderIds = new Set(accountHistory?.executions.filter(row => executions.some(e => row.id === e.execution_id) && row.order_id)
      .map(row => row.order_id));
    const hasMultiLegOpening = accountHistory?.orders.some(order => orderIds.has(order.id) && order.legs.length > 1);
    if (accountHistory?.account_id === accountId && accountHistory.sync.full_history_synced &&
      !hasMultiLegOpening && relationships && !relationships.gaps.some(gap => gap.channel === id && gap.source !== null)) {
      cash.originalGross = openGross;
      cash.chainGross = openGross;
      cash.chainFees = openFees;
    }
  }
  if (openGross === null) notices.push('Broker execution history does not reconcile to the open quantity.');
  if (openFees === null) notices.push('Some actual opening fees or rebates are unavailable.');
  if (cash.chainGross === null || cash.chainFees === null) notices.push('The original opening or full chain cash and fees are not fully evidenced.');
  return { cash, executions, rolls, notices };
}
