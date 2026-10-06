import { randomUUID } from 'node:crypto';
import type { Holding, OptionSpec } from '../market/types.js';
import { getPortfolio, type InvestorState } from '../state/portfolio-state.js';
import type { BrokerSkip, BrokerStatement } from './statement.js';
import { addDecimals, type OptionExecution } from './option-executions.js';
import type { OptionLifecycleEvent } from './option-events.js';

export interface ObservedOption {
  key: string;
  underlying: string;
  right: OptionSpec['right'];
  side: OptionSpec['side'];
  strike: number;
  expiry: string;
  multiplier: number;
  settlement: OptionSpec['settlement'];
  units: number;
  avg_price: number;
  mark: number;
  currency: string;
  broker_contract_id?: string;
}

export interface OptionObservation {
  id: string;
  broker_id: string;
  connection_id: string;
  channel: string;
  account_id: string;
  observed_at: string;
  as_of: string;
  raw_data_id?: string;
  source: 'broker' | 'prior_books';
  complete: boolean;
  skipped_positions: number;
  skipped_symbols?: string[];
  skipped?: BrokerSkip[];
  options: ObservedOption[];
}

export interface OptionEpisode {
  id: string;
  broker_id: string;
  connection_id: string;
  channel: string;
  account_id: string;
  contract: ObservedOption;
  first_seen: string;
  last_seen_open: string;
  first_seen_absent: string | null;
  uncertain_as_of?: string;
  uncertain_skips?: BrokerSkip[];
  status: 'open' | 'unverified' | 'no_longer_observed' | 'closed_by_fills' |
    'expired' | 'assigned' | 'exercised' | 'cash_settled' | 'mixed_outcomes' |
    'partially_explained' | 'conflicting_evidence';
  observations: Array<{ as_of: string; observed_at: string; source: OptionObservation['source']; units: number; avg_price: number; mark: number }>;
  executions: OptionExecution[];
  events: OptionLifecycleEvent[];
  event_coverage_gap?: string;
  matched_trade_pl?: { amount: string; currency: string; opened: string; closed: string; fees: string };
  broker_event_pl?: { amount: string; currency: string };
}

/** Contract identity is independent of broker quantity and cost changes. */
export function optionContractKey(option: OptionSpec): string {
  return JSON.stringify([
    option.underlying.trim().toUpperCase(), option.right, option.side,
    option.strike, option.expiry, option.multiplier, option.settlement,
  ]);
}

function observedOption(holding: Holding, currency: string): ObservedOption {
  const option = holding.option!;
  return {
    key: optionContractKey(option), underlying: option.underlying,
    right: option.right, side: option.side, strike: option.strike,
    expiry: option.expiry, multiplier: option.multiplier,
    settlement: option.settlement, units: holding.units,
    avg_price: holding.avg_price, mark: option.mark, currency,
    ...(holding.broker_ref?.native_id ? { broker_contract_id: holding.broker_ref.native_id } : {}),
  };
}

function priorOptions(state: InvestorState, channel: string): ObservedOption[] {
  return Object.values(getPortfolio(state))
    .filter(h => h.channel === channel && h.instrument === 'option' && h.option)
    .map(h => observedOption(h, ''));
}

export function optionObservationFromStatement(args: {
  statement: BrokerStatement;
  brokerId: string;
  connectionId: string;
  channel: string;
  observedAt: string;
  rawDataId?: string;
  syncId: string;
}): OptionObservation {
  const skippedPositions = args.statement.skipped.filter(row => row.kind === 'position');
  return {
    id: args.syncId, broker_id: args.brokerId, connection_id: args.connectionId,
    channel: args.channel, account_id: args.statement.account_id,
    observed_at: args.observedAt, as_of: args.statement.as_of,
    ...(args.rawDataId ? { raw_data_id: args.rawDataId } : {}),
    source: 'broker', complete: skippedPositions.every(row => Boolean(row.symbol)),
    skipped_positions: skippedPositions.length,
    skipped_symbols: skippedPositions.flatMap(row => row.symbol ? [row.symbol.toUpperCase()] : []),
    skipped: skippedPositions,
    options: args.statement.lots.filter(lot => lot.holding.instrument === 'option' && lot.holding.option)
      .map(lot => observedOption(lot.holding, lot.currency)),
  };
}

/** Prepare both a legacy baseline and the new observation before the books commit. */
export function appendOptionObservation(state: InvestorState, args: {
  statement: BrokerStatement;
  brokerId: string;
  connectionId: string;
  channel: string;
  observedAt?: string;
  rawDataId?: string;
  syncId?: string;
}): void {
  const { statement, brokerId, connectionId, channel } = args;
  const history = state.option_observations ?? [];
  const observedAt = args.observedAt ?? new Date().toISOString();
  if (!history.some(row => row.channel === channel)) {
    const prior = priorOptions(state, channel);
    const previous = [...state.log].reverse().find(row =>
      row.action === 'broker_sync' && row.connector_id === connectionId && row.account_id === statement.account_id);
    if (prior.length && previous?.ts) history.push({
      id: randomUUID(), broker_id: brokerId, connection_id: connectionId, channel,
      account_id: statement.account_id, observed_at: `${previous.ts}T00:00:00.000Z`,
      as_of: previous.ts, source: 'prior_books', complete: false,
      skipped_positions: 0, options: prior,
    });
  }
  const id = args.syncId ?? randomUUID();
  if (history.some(row => row.id === id)) return;
  history.push(optionObservationFromStatement({ statement, brokerId, connectionId, channel,
    observedAt, rawDataId: args.rawDataId, syncId: id }));
  state.option_observations = history;
}

function previousAbsenceFor(episode: OptionEpisode, episodes: OptionEpisode[]): string | undefined {
  return episodes.filter(other => other !== episode &&
    other.channel === episode.channel && other.account_id === episode.account_id &&
    other.contract.key === episode.contract.key && other.first_seen_absent != null &&
    other.first_seen_absent <= episode.first_seen)
    .map(other => other.first_seen_absent!).sort().at(-1);
}

function matchingExecutions(state: InvestorState, episode: OptionEpisode, episodes: OptionEpisode[]): OptionExecution[] {
  const c = episode.contract;
  const previousAbsence = previousAbsenceFor(episode, episodes);
  return (state.option_executions ?? []).filter(row =>
    row.channel === episode.channel && row.account_id === episode.account_id &&
    row.underlying.toUpperCase() === c.underlying.toUpperCase() && row.right === c.right &&
    row.expiry === c.expiry && Number(row.strike) === c.strike &&
    Number(row.multiplier) === c.multiplier &&
    (!c.broker_contract_id || row.contract_id === c.broker_contract_id) &&
    (!previousAbsence || row.executed_at.slice(0, 10) > previousAbsence) &&
    (episode.first_seen_absent == null || row.executed_at.slice(0, 10) <= episode.first_seen_absent)
  );
}

function matchingEvents(state: InvestorState, episode: OptionEpisode, episodes: OptionEpisode[]): OptionLifecycleEvent[] {
  const c = episode.contract;
  const previousAbsence = previousAbsenceFor(episode, episodes);
  return (state.option_events ?? []).filter(row =>
    row.channel === episode.channel && row.account_id === episode.account_id &&
    row.underlying.toUpperCase() === c.underlying.toUpperCase() && row.right === c.right &&
    row.expiry === c.expiry && Number(row.strike) === c.strike &&
    Number(row.multiplier) === c.multiplier &&
    (!c.broker_contract_id || !row.contract_id || row.contract_id === c.broker_contract_id) &&
    row.date >= episode.first_seen && (!previousAbsence || row.date > previousAbsence) &&
    (episode.first_seen_absent == null || row.date <= episode.first_seen_absent)
  ).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function eventCouldBeContract(skip: BrokerSkip, option: ObservedOption): boolean {
  if (skip.kind !== 'event') return false;
  if (!skip.symbol) return true;
  const symbol = skip.symbol.toUpperCase();
  return symbol.includes(option.underlying.toUpperCase()) ||
    Boolean(option.broker_contract_id && symbol.includes(option.broker_contract_id));
}

function classifyTerminalEvents(episode: OptionEpisode): void {
  if (!episode.first_seen_absent) return;
  // Daily snapshots have no intraday ordering. An event dated on the last
  // observed-open day cannot prove that it happened after that observation.
  const terminal = episode.events.filter(event => event.date > episode.last_seen_open);
  if (!terminal.length) return;
  const lastUnits = episode.observations.at(-1)?.units;
  if (!Number.isSafeInteger(lastUnits) || !(lastUnits! > 0)) return;
  const eventCount = Number(addDecimals(...terminal.map(event => event.contracts)));
  const intervalExecutions = episode.executions.filter(row =>
    row.executed_at.slice(0, 10) >= episode.last_seen_open);
  const closeCount = intervalExecutions.some(row => row.effect === 'open') ? NaN :
    Number(addDecimals('0', ...intervalExecutions.filter(row => row.effect === 'close').map(row => row.contracts)));
  if (!Number.isSafeInteger(eventCount) || !Number.isSafeInteger(closeCount) || eventCount + closeCount > lastUnits!) {
    episode.status = 'conflicting_evidence';
    return;
  }
  if (eventCount + closeCount < lastUnits!) {
    episode.status = 'partially_explained';
    return;
  }
  if (terminal.some(event =>
    event.kind === 'assignment' && episode.contract.side !== 'short' ||
    event.kind === 'exercise' && episode.contract.side !== 'long')) {
    episode.status = 'conflicting_evidence';
    return;
  }
  if (closeCount > 0) { episode.status = 'mixed_outcomes'; return; }
  const cash = terminal.every(event => event.kind === 'cash_settlement' || event.settlement === 'cash');
  const kinds = new Set(terminal.map(event => event.kind));
  episode.status = cash ? 'cash_settled' : kinds.size > 1 ? 'mixed_outcomes' :
    terminal[0].kind === 'expiration' ? 'expired' :
      terminal[0].kind === 'assignment' ? 'assigned' :
        terminal[0].kind === 'exercise' ? 'exercised' : 'cash_settled';
  if ((episode.status === 'expired' || episode.status === 'cash_settled') &&
      terminal.every(event => event.broker_realized_pl !== undefined && event.currency === terminal[0].currency)) {
    episode.broker_event_pl = { amount: addDecimals(...terminal.map(event => event.broker_realized_pl!)),
      currency: terminal[0].currency };
  }
}

/** Exact execution cash flow, only when it reconciles every observed quantity to a flat close. */
function matchedTradePl(episode: OptionEpisode): OptionEpisode['matched_trade_pl'] {
  if (!episode.first_seen_absent || !episode.executions.length || !episode.observations.length) return undefined;
  const rows = [...episode.executions].sort((a, b) =>
    a.executed_at.localeCompare(b.executed_at) || a.execution_id.localeCompare(b.execution_id));
  const first = rows[0];
  if (episode.contract.currency && first.currency !== episode.contract.currency) return undefined;
  if (rows.some(row => row.currency !== first.currency || row.contract_id !== first.contract_id)) return undefined;
  const decimals = rows.map(row => row.contracts.split('.')[1]?.length ?? 0);
  const scale = Math.max(...decimals);
  const units = (value: string): bigint => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(scale, '0'));
  };
  let balance = 0n;
  let opened = 0n;
  let closed = 0n;
  const short = episode.contract.side === 'short';
  for (const [index, row] of rows.entries()) {
    const opening = row.effect === 'open' && row.side === (short ? 'sell' : 'buy');
    const closing = row.effect === 'close' && row.side === (short ? 'buy' : 'sell');
    if (!opening && !closing) return undefined;
    const quantity = units(row.contracts);
    if (opening) { opened += quantity; balance += quantity; }
    else { closed += quantity; balance -= quantity; }
    if (balance < 0n) return undefined;
    if (balance === 0n && index < rows.length - 1) return undefined;
  }
  if (balance !== 0n || opened === 0n || closed !== opened) return undefined;
  for (const observation of episode.observations) {
    let atDate = 0n;
    for (const row of rows) if (row.executed_at.slice(0, 10) <= observation.as_of) {
      atDate += row.effect === 'open' ? units(row.contracts) : -units(row.contracts);
    }
    if (Number(atDate) / 10 ** scale !== observation.units) return undefined;
  }
  const amount = addDecimals(...rows.flatMap(row => [row.gross_premium, row.commission]));
  const fees = addDecimals(...rows.map(row => row.commission));
  const quantityText = (value: bigint) => scale
    ? `${(value / 10n ** BigInt(scale)).toString()}.${(value % 10n ** BigInt(scale)).toString().padStart(scale, '0')}`
    : value.toString();
  return { amount, currency: first.currency, opened: quantityText(opened),
    closed: quantityText(closed), fees };
}

function skipCouldBeContract(run: OptionObservation, option: ObservedOption): boolean {
  const underlying = option.underlying.toUpperCase();
  return (run.skipped_symbols ?? []).some(symbol =>
    symbol === underlying || symbol.includes(underlying) ||
    Boolean(option.broker_contract_id && symbol.includes(option.broker_contract_id)));
}

/** Build episodes from observations. Partial responses can add presence, never prove absence. */
export function buildOptionEpisodes(state: InvestorState, now = new Date()): OptionEpisode[] {
  const observations = [...(state.option_observations ?? [])]
    // A newly fetched statement can describe an older position date. Build the
    // position timeline from statement dates, using fetch order only to resolve
    // repeated observations of the same day.
    .sort((a, b) => a.as_of.localeCompare(b.as_of) ||
      a.observed_at.localeCompare(b.observed_at) || a.id.localeCompare(b.id));
  const episodes: OptionEpisode[] = [];
  const active = new Map<string, OptionEpisode>();
  for (const run of observations) {
    const present = new Set<string>();
    for (const option of run.options) {
      const identity = JSON.stringify([run.channel, run.account_id, option.key]);
      present.add(identity);
      let episode = active.get(identity);
      if (!episode) {
        episode = {
          id: `${run.id}:${option.key}`, broker_id: run.broker_id,
          connection_id: run.connection_id, channel: run.channel,
          account_id: run.account_id, contract: option,
          first_seen: run.as_of, last_seen_open: run.as_of,
          first_seen_absent: null, status: 'open', observations: [], executions: [], events: [],
        };
        episodes.push(episode);
        active.set(identity, episode);
      }
      episode.last_seen_open = run.as_of;
      delete episode.uncertain_as_of;
      delete episode.uncertain_skips;
      episode.contract = option;
      episode.observations.push({ as_of: run.as_of, observed_at: run.observed_at,
        source: run.source, units: option.units, avg_price: option.avg_price, mark: option.mark });
    }
    for (const [identity, episode] of active) {
      if (episode.channel !== run.channel || episode.account_id !== run.account_id || present.has(identity)) continue;
      if (!run.complete || skipCouldBeContract(run, episode.contract)) {
        episode.uncertain_as_of = run.as_of;
        episode.uncertain_skips = run.skipped ?? [];
        continue;
      }
      episode.first_seen_absent = run.as_of;
      episode.status = 'no_longer_observed';
      const skippedEvent = (run.skipped ?? []).find(skip => eventCouldBeContract(skip, episode.contract));
      if (skippedEvent) episode.event_coverage_gap = skippedEvent.reason;
      active.delete(identity);
    }
  }
  const latestByChannel = new Map<string, OptionObservation>();
  for (const run of observations) if (run.source === 'broker') {
    const latest = latestByChannel.get(run.channel);
    if (!latest || run.observed_at > latest.observed_at) latestByChannel.set(run.channel, run);
  }
  const connections = state.broker_connections ?? {};
  for (const episode of episodes) {
    if (episode.first_seen_absent != null) continue;
    const connection = connections[episode.connection_id];
    const last = latestByChannel.get(episode.channel);
    const frequency = connection && 'sync_schedule' in connection ? connection.sync_schedule?.frequency : undefined;
    const interval = frequency === 'hourly' ? 1 :
      frequency === 'daily' ? 24 :
      frequency === 'weekly' ? 168 : null;
    const late = interval != null && last != null &&
      now.getTime() - Date.parse(last.observed_at) > (interval + 1) * 3600_000;
    if (episode.uncertain_as_of || connection?.enabled === false || connection?.last_sync?.ok === false || late || cExpired(episode.contract.expiry, now)) {
      episode.status = 'unverified';
    }
  }
  for (const episode of episodes) {
    episode.executions = matchingExecutions(state, episode, episodes);
    episode.events = matchingEvents(state, episode, episodes);
    episode.matched_trade_pl = matchedTradePl(episode);
    if (episode.matched_trade_pl) episode.status = 'closed_by_fills';
    if (episode.events.length) {
      const terminalEvents = episode.events.filter(event => event.date > episode.last_seen_open);
      if (episode.matched_trade_pl && terminalEvents.length) {
        episode.status = 'conflicting_evidence';
        delete episode.matched_trade_pl;
      } else if (!episode.matched_trade_pl) classifyTerminalEvents(episode);
    }
  }
  return episodes.sort((a, b) =>
    (b.first_seen_absent ?? b.last_seen_open).localeCompare(a.first_seen_absent ?? a.last_seen_open) ||
    a.channel.localeCompare(b.channel) || a.id.localeCompare(b.id));
}

function cExpired(expiry: string, now: Date): boolean {
  return expiry < now.toISOString().slice(0, 10);
}
