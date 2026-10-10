import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Holding } from '../market/types.js';
import type { InvestorState } from '../state/portfolio-state.js';
import { combinedCredentials, readBrokerAccountModel } from '../brokers/accounts.js';
import { getBrokerConnector } from '../brokers/catalog.js';
import { redactSecrets } from '../brokers/connections.js';
import { buildExecutionJournal, validDate } from '../brokers/option-executions.js';
import { openOptionTradeDetails } from '../webapp/option-dashboard-data.js';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';

export function optionTradeEvidence(state: InvestorState, portfolio: Record<string, Holding>) {
  const model = readBrokerAccountModel(state);
  const journal = buildExecutionJournal(state.option_executions);
  const accounts = Object.fromEntries(Object.values(model.connections).flatMap(c => c.account_id ? [[c.channel, c.account_id]] : []));
  const matched = openOptionTradeDetails(portfolio, journal.executions, accounts, state.option_events);
  const positions = Object.fromEntries(Object.entries(portfolio).filter(([, h]) => h.option).map(([key]) => [key,
    matched[key] ? { status: 'matched' as const, ...matched[key], method: 'FIFO outstanding opening records reconciled to held quantity' }
      : { status: 'unverified' as const, reason: 'Opening history is missing, ambiguous, or does not reconcile to the held quantity.' },
  ]));
  const channels = [...new Set([...Object.values(model.connections).map(c => c.channel),
    ...Object.values(portfolio).filter(h => h.option && h.channel).map(h => h.channel!),
    ...journal.executions.map(e => e.channel)])];
  const coverage = channels.map(channel => {
    const connections = Object.values(model.connections).filter(c => c.channel === channel);
    const broker = connections.length === 1 ? connections[0].broker_id : undefined;
    const rows = journal.executions.filter(e => e.channel === channel);
    const keys = Object.keys(positions).filter(key => portfolio[key].channel === channel);
    const dates = rows.map(e => e.executed_at).sort();
    const connection = connections.length === 1 ? connections[0] : undefined;
    const lastSync = connection?.last_sync;
    const credentials = connection ? combinedCredentials(model, connection) : {};
    const secrets = broker ? getBrokerConnector(broker).credentialFields.filter(f => f.type === 'secret')
      .flatMap(f => credentials[f.id] ? [credentials[f.id]] : []) : [];
    return { channel, broker_id: broker ?? null, journal_present: journal.available, record_count: rows.length,
      first_record_at: dates[0] ?? null, last_record_at: dates.at(-1) ?? null,
      current_options: keys.length, matched_options: keys.filter(key => positions[key].status === 'matched').length,
      last_sync: lastSync?.ok === false ? { ...lastSync, error: redactSecrets(lastSync.error ?? 'Broker sync failed.', secrets) } : lastSync ?? null,
      timestamp_basis: broker === 'webull' ? 'Cumulative order fill time; individual fill dates are unavailable.'
        : broker === 'ibkr' ? 'Broker-local Flex execution time; timezone is not supplied.'
          : broker === 'tiger' || broker === 'moomoo' ? 'Market-local execution time converted from broker epoch timestamp.'
            : 'Broker-local time; source precision must be checked.',
    };
  });
  return { positions, coverage, limitations: [
    'Record bounds show retained activity, not proof of complete history or the latest successful statement date.',
    'Journal presence is global; zero records on a channel does not prove that no trades occurred or that its history was imported.',
    'Non-IBKR backfill matches current contracts using position metadata; older closed contracts may be absent. Stock trades are not imported into this option journal.',
    'Opening date ranges refer to outstanding records under FIFO matching, not broker-confirmed tax-lot allocation. Snapshot and accounting journal dates are not trade dates.',
  ] };
}

export interface OptionTradeFilter {
  underlying?: string; channel?: string; right?: 'call' | 'put'; effect?: 'open' | 'close';
  start_date?: string; end_date?: string; limit?: number; offset?: number;
}

export function queryOptionTrades(state: InvestorState, portfolio: Record<string, Holding>, filter: OptionTradeFilter) {
  for (const key of ['start_date', 'end_date'] as const) {
    if (filter[key] !== undefined && !validDate(filter[key]!)) throw new Error(`${key} must be a valid YYYY-MM-DD date.`);
  }
  if (filter.start_date && filter.end_date && filter.start_date > filter.end_date) throw new Error('start_date must not follow end_date.');
  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw new Error('limit must be 1–200 and offset a nonnegative integer.');
  const journal = buildExecutionJournal(state.option_executions);
  const underlying = filter.underlying?.trim().toUpperCase();
  const rows = journal.executions.filter(e => (!underlying || e.underlying.trim().toUpperCase() === underlying) &&
    (!filter.channel || e.channel === filter.channel) && (!filter.right || e.right === filter.right) &&
    (!filter.effect || e.effect === filter.effect) && (!filter.start_date || e.executed_at.slice(0, 10) >= filter.start_date) &&
    (!filter.end_date || e.executed_at.slice(0, 10) <= filter.end_date));
  return { available: journal.available, executions: rows.slice(offset, offset + limit), total: rows.length,
    next_offset: offset + limit < rows.length ? offset + limit : null, ...optionTradeEvidence(state, portfolio) };
}

export function createListOptionTradesTool(): AgentTool {
  return {
    name: 'list_option_trades', label: 'List Option Trades',
    description: 'Read retained dated option activity across all broker channels, with inclusive broker-local date filters, pagination, current-position opening date evidence, and sync/coverage caveats. Use for opened-in-period questions. IBKR/Tiger/MooMoo supply executions; Webull supplies cumulative terminal order records, not individual fills. An opening row does not by itself prove the position remains open or that it was not part of a roll. No ledger writes.',
    parameters: Type.Object({ ...channelIdParams,
      underlying: Type.Optional(Type.String({ description: 'Canonical underlying, e.g. TSLA, not an OCC contract code.' })),
      channel: Type.Optional(Type.String({ description: 'Exact broker account channel; omit for all.' })),
      right: Type.Optional(Type.Union([Type.Literal('call'), Type.Literal('put')])),
      effect: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('close')])),
      start_date: Type.Optional(Type.String({ description: 'Inclusive trade date YYYY-MM-DD. Calculate the requested window from the current date.' })),
      end_date: Type.Optional(Type.String({ description: 'Inclusive trade date YYYY-MM-DD.' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    async execute(_id, raw) {
      try {
        const p = raw as ChannelIds & OptionTradeFilter;
        const { state } = await resolveInvestorFromChannel(p);
        const details = queryOptionTrades(state, state.portfolio ?? {}, p);
        return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], details: null };
      }
    },
  };
}
