import { getPortfolio, getCashes, getDeposits, holdingInstrument, type InvestorState } from '../state/portfolio-state.js';
import { getProperties, getLiabilities, getCashFlows, type HouseholdInvestorState } from '../state/household-state.js';
import { buildExecutionJournal } from '../brokers/option-executions.js';
import { mergeOptionLifecycleEvents } from '../brokers/option-events.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import { publicBrokerAccounts } from '../brokers/accounts.js';
import { optionTradeEvidence } from '../tools/option_trades.js';

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export interface Field {
  type: 'string' | 'number' | 'decimal' | 'boolean' | 'date' | 'datetime';
  description: string;
  nullable: boolean;
  unit?: string;
  sum_group_by?: string[];
  comparison_group_by?: string[];
}
export interface Dataset {
  description: string;
  fields: Record<string, Field>;
  caveats: string[];
  available: (state: InvestorState) => boolean;
  rows: (state: InvestorState) => Row[];
}
const field = (type: Field['type'], description: string, extra: Partial<Field> = {}): Field => ({ type, description, nullable: true, ...extra });
const str = (description: string) => field('string', description);
const date = (description: string) => field('date', description);
const number = (description: string, unit?: string) => field('number', description, { unit });
const money = (description: string) => field('number', description, { unit: 'native currency', sum_group_by: ['currency'], comparison_group_by: ['currency'] });
const decimal = (description: string, monetary = false) => field('decimal', description,
  monetary ? { unit: 'native currency', sum_group_by: ['currency'], comparison_group_by: ['currency'] } : {});
const scope = { channel: str('Exact custody channel; identifies an account, not necessarily just a broker.'), currency: str('Recorded native currency; null means unknown, not USD.') };
const terms = { underlying: str('Canonical option underlying.'), right: str('call or put.'), expiry: date('Contract expiration date; not trade date.'),
  strike: decimal('Strike per underlying unit.'), multiplier: decimal('Underlying units per contract.') };
function project(rows: object[], fields: Record<string, Field>): Row[] {
  return rows.map(raw => Object.fromEntries(Object.keys(fields).map(key => [key, (raw as Row)[key] ?? null])));
}
const recorded = (key: keyof HouseholdInvestorState) => (state: InvestorState) => (state as HouseholdInvestorState)[key] !== undefined;
const snapshotCaveat = 'Stored book snapshot, not a fresh broker or market fetch. Updated dates are recording dates unless explicitly described otherwise.';

const executionFields = {
  ...scope, ...terms, account_id: str('Broker account identifier.'), execution_id: str('Unique with channel and account_id.'),
  contract_id: str('Broker-native contract identifier; cross-broker IDs need not match.'),
  executed_at: field('datetime', 'Retained broker-local execution/order time; timezone must not be inferred.'),
  trade_date: date('Date portion of executed_at in its recorded broker-local clock.'),
  contracts: field('decimal', 'Positive contract quantity; direction comes from side/effect.', { unit: 'contracts', sum_group_by: ['channel', 'account_id', 'contract_id'] }),
  side: str('buy or sell.'), effect: str('open or close; opening activity alone does not prove currently open.'),
  gross_premium: decimal('Signed premium cash effect; buys negative, sells positive.', true),
  commission: decimal('Signed fee/rebate; null when unreported.', true),
  net_premium: decimal('gross_premium + commission; null if commission unknown.', true),
};
const eventFields = { ...scope, ...terms, id: str('Event identifier, scoped by channel/account.'), broker_id: str('Catalog broker.'),
  account_id: str('Broker account identifier.'), contract_id: str('Broker-native contract identifier.'),
  date: date('Broker-reported lifecycle event date; not execution or import date.'), kind: str('expiration, assignment, exercise, or cash_settlement.'),
  settlement: str('cash, physical, or unknown.'), contracts: field('decimal', 'Affected positive option contracts.', { unit: 'contracts', sum_group_by: ['channel', 'account_id', 'contract_id'] }),
  proceeds: decimal('Broker-reported proceeds.', true), fees: decimal('Broker-reported signed fee amount.', true),
  broker_realized_pl: decimal('Broker-reported option P/L, possibly absent for physical delivery.', true), source: str('Broker source classification.') };
const cashFields = { ...scope, amount: money('Recorded available cash; not automatically settled cash.'),
  settled_amount: money('Settled cash only when separately reported.'), accrued_interest: money('Unsettled accrued interest; do not add to available cash.'),
  updated_at: date('Book recording date, not fill time.') };
const depositFields = { ...scope, id: str('Deposit identifier.'), label: str('Recorded label.'), amount: money('Locked principal, not free cash.'),
  interest: money('Full-term interest amount, not annual yield.'), start_date: date('Term start.'), end_date: date('Term end.'), updated_at: date('Book recording date.') };
const propertyFields = { id: str('Property identifier.'), currency: scope.currency, label: str('Recorded label.'), value: money('Recorded property mark; not a live appraisal.'),
  mortgage_id: str('Related liability id, when recorded.'), updated_at: date('Book recording date.') };
const liabilityFields = { id: str('Liability identifier.'), currency: scope.currency, label: str('Recorded label.'), kind: str('Recorded liability classification.'),
  principal: money('Recorded outstanding principal.'), annual_rate_pct: number('Annual interest rate.', 'percent'), payment_amount: field('number', 'Per-frequency payment amount.', { unit: 'native currency per frequency', sum_group_by: ['currency', 'payment_frequency'], comparison_group_by: ['currency', 'payment_frequency'] }),
  payment_frequency: str('Payment interval; do not combine different intervals without conversion.'), term_months: number('Contract term.', 'months'),
  start_date: date('Liability start.'), updated_at: date('Book recording date.'), property_id: str('Related property id, when recorded.') };
const flowFields = { id: str('Cash-flow line identifier.'), currency: scope.currency, label: str('Recorded label.'), kind: str('income or expense.'),
  amount: field('number', 'Amount per stated frequency, not necessarily monthly.', { unit: 'native currency per frequency', sum_group_by: ['currency', 'frequency', 'kind'], comparison_group_by: ['currency', 'frequency'] }),
  frequency: str('Cash-flow interval.'), start_date: date('Flow start.'), end_date: date('Flow end, null if unspecified.'), category: str('Recorded category.'), updated_at: date('Book recording date.') };

export const datasets: Record<string, Dataset> = {
  positions: {
    description: 'Current stored equity, fund, and option lots, with reconciled opening evidence for options.',
    fields: { key: str('Stable portfolio lot key.'), ...scope, instrument: str('equity, fund, or option.'),
      units: field('number', 'Shares/fund units/contracts according to instrument; do not sum unlike instruments.', { unit: 'instrument units', sum_group_by: ['key'] }),
      avg_price: field('number', 'Recorded average cost per share/unit, or premium per option CONTRACT.', { unit: 'native currency per unit/contract', comparison_group_by: ['currency', 'instrument'] }),
      category: str('Recorded category.'), ...terms, side: str('Option long or short; null for other instruments.'),
      mark: field('number', 'Stored option premium per CONTRACT; not a fresh quote.', { unit: 'native currency per contract', comparison_group_by: ['currency'] }),
      settlement: str('Recorded option settlement.'), contract_id: str('Recorded broker-native id if present.'),
      opening_status: str('matched or unverified for options; null for non-options.'), opened_from: date('First outstanding FIFO opening date; derived evidence, not a broker tax-lot date.'),
      opened_to: date('Last outstanding FIFO opening date; null if not reconciled.') },
    caveats: [snapshotCaveat, 'Opening ranges require retained matching executions/events. Missing ranges do not mean there were no trades. Underlying/strike/expiry alone are insufficient for broker/account joins.'],
    available: recorded('portfolio'),
    rows(state) {
      const portfolio = getPortfolio(state); const evidence = optionTradeEvidence(state, portfolio);
      return Object.entries(portfolio).map(([key, h]) => {
        const e = evidence.positions[key]; const o = h.option;
        const opening = e?.status === 'matched' ? e : null;
        return { key, channel: h.channel ?? null, currency: h.currency ?? null, instrument: holdingInstrument(h), units: h.units,
          avg_price: h.avg_price, category: h.category ?? null, underlying: o ? canonicalOptionUnderlying(o.underlying, o) : null,
          right: o?.right ?? null, expiry: o?.expiry ?? null, strike: o ? String(o.strike) : null, multiplier: o ? String(o.multiplier) : null,
          side: o?.side ?? null, mark: o?.mark ?? null, settlement: o?.settlement ?? null, contract_id: h.broker_ref?.native_id ?? null,
          opening_status: e?.status ?? null, opened_from: opening?.openedFrom ?? null, opened_to: opening?.openedTo ?? null };
      });
    },
  },
  option_executions: { description: 'Retained dated option activity across accounts; no stock execution history in this dataset.', fields: executionFields,
    caveats: ['IBKR broker-local Flex times have no supplied timezone. Tiger/MooMoo times are market-local conversions. Webull rows are cumulative terminal order fills, not individual executions.',
      'Retained activity is not complete history; non-IBKR historical closed contracts may be absent. An open row is not proof of a currently open position.'],
    available: recorded('option_executions'), rows: state => project(buildExecutionJournal(state.option_executions).executions.map(e => ({ ...e, trade_date: e.executed_at.slice(0, 10) })), executionFields) },
  option_events: { description: 'Explicit broker lifecycle events; disappearing positions do not imply events.', fields: eventFields,
    caveats: ['Event date is not execution date. Physical assignment/exercise may have no option proceeds or option realized P/L.'],
    available: recorded('option_events'), rows: state => project(mergeOptionLifecycleEvents([], state.option_events ?? []), eventFields) },
  broker_accounts: { description: 'Configured broker account identities and recorded sync state; credentials and config are excluded.',
    fields: { id: str('Connection identifier.'), broker_id: str('Catalog broker identifier.'), channel: scope.channel, account_id: str('Bound broker account id.'), label: str('Account label.'),
      enabled: field('boolean', 'Whether broker sync is enabled.'), status: str('Setup/sync status, not proof of current market freshness.'),
      last_sync_at: field('datetime', 'Sync attempt timestamp, not execution time.'), last_sync_ok: field('boolean', 'Whether last attempt succeeded.'),
      broker_as_of: str('Broker statement observation timestamp/date as reported; format may vary.') },
    caveats: ['Account status and sync-at are not execution dates. Failed syncs can leave older positions in books.'],
    available: state => state.broker_connections !== undefined,
    rows: state => publicBrokerAccounts(state).connections.map(c => ({ id: c.id, broker_id: c.broker_id, channel: c.channel,
      account_id: c.account_id, label: c.label, enabled: c.enabled, status: c.status,
      last_sync_at: c.last_sync?.at ?? null, last_sync_ok: c.last_sync?.ok ?? null, broker_as_of: c.last_sync?.as_of ?? null })) },
  cash_balances: { description: 'Recorded available cash sleeves, one per channel/currency.', fields: cashFields, caveats: [snapshotCaveat, 'Missing cash storage is unknown, not a zero balance.'], available: recorded('cash'), rows: state => project(getCashes(state), cashFields) },
  deposits: { description: 'Recorded fixed-term deposits.', fields: depositFields, caveats: [snapshotCaveat], available: recorded('deposits'), rows: state => project(getDeposits(state), depositFields) },
  properties: { description: 'Recorded property assets.', fields: propertyFields, caveats: [snapshotCaveat], available: recorded('properties'), rows: state => project(getProperties(state as HouseholdInvestorState), propertyFields) },
  liabilities: { description: 'Recorded liabilities and payment terms.', fields: liabilityFields, caveats: [snapshotCaveat], available: recorded('liabilities'), rows: state => project(getLiabilities(state as HouseholdInvestorState), liabilityFields) },
  cash_flows: { description: 'Recorded scheduled income/expense lines, not executed cash transactions.', fields: flowFields, caveats: [snapshotCaveat], available: recorded('cash_flows'), rows: state => project(getCashFlows(state as HouseholdInvestorState), flowFields) },
};

export const relationships = [
  { from: 'option_executions', to: 'broker_accounts', keys: ['channel', 'account_id'], meaning: 'Both keys must agree; same broker can have multiple accounts.' },
  { from: 'option_events', to: 'option_executions', keys: ['channel', 'account_id', 'contract_id'], meaning: 'Only when native IDs are present and consistent; lifecycle is not an execution.' },
  { from: 'positions', to: 'option_executions', keys: ['channel', 'contract_id'], meaning: 'Also verify bound account, terms, side and quantity. Use reconciled opened_from/to for outstanding opening evidence, not a naive join.' },
  { from: 'properties', to: 'liabilities', keys: ['mortgage_id -> id'], meaning: 'Recorded mortgage link; may be absent.' },
];
