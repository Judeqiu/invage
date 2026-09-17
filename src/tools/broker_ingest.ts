import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { applyBrokerStatement } from '../brokers/apply-statement.js';
import { assertCsvTablesSpec, runCsvTablesSpec } from '../brokers/csv-tables.js';
import { getBrokerAdapter } from '../brokers/adapter.js';
import { getBrokerConnector } from '../brokers/catalog.js';
import {
  loadBrokerParserSpec,
  readBrokerRawFile,
  saveBrokerParserSpec,
} from '../brokers/parser-store.js';
import { listBrokerTriageCases, publicTriageSummary } from '../brokers/triage.js';
import { assertBrokerStatement, formatBrokerSkip } from '../brokers/statement.js';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}

export function createListBrokerTriageTool(): AgentTool {
  return {
    name: 'list_broker_triage',
    label: 'List broker ingest triage',
    description:
      'List failed broker-statement archives (inventory + error, no raw body). Use after catalog parse fails, then read_broker_raw for the chosen case.',
    parameters: Type.Object({
      ...channelIdParams,
      connector_id: Type.Optional(Type.String({ description: 'Catalog connector id. Omit to list every connector.' })),
    }),
    execute: async (_id, raw) => {
      const p = raw as ChannelIds & { connector_id?: string };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        const slug = state.user.slug;
        if (!slug) throw new Error('Investor state has no user.slug.');
        const cases = listBrokerTriageCases(slug, p.connector_id?.trim());
        const summaries = cases.map((c) => publicTriageSummary(c, slug));
        return ok(
          summaries.length === 0
            ? 'No broker triage cases.'
            : `Broker triage (${summaries.length}). Next: read_broker_raw with path = raw_path. Do not invent numbers.`,
          { cases: summaries },
        );
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  };
}

export function createReadBrokerRawTool(): AgentTool {
  return {
    name: 'read_broker_raw',
    label: 'Read archived broker raw',
    description:
      'Read the latest archived raw broker statement (or a path under that user\'s broker-raw/<connector> directory) after a catalog parser failure. Raw may be XML or JSON. Never prints secrets. For looks_like json, map to a BrokerStatement — do not generate csv_tables.',
    parameters: Type.Object({
      ...channelIdParams,
      connector_id: Type.String({ description: 'Catalog connector id (e.g. ibkr).' }),
      path: Type.Optional(Type.String({ description: 'Absolute path under broker-raw for this connector.' })),
    }),
    execute: async (_id, raw) => {
      const p = raw as ChannelIds & { connector_id: string; path?: string };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        const slug = state.user.slug;
        if (!slug) throw new Error('Investor state has no user.slug.');
        const id = p.connector_id.trim();
        const got = readBrokerRawFile(slug, id, p.path);
        const csvHint = getBrokerAdapter(id).usesCsvTables
          ? 'Generate a csv_tables spec or a BrokerStatement JSON.'
          : 'Map this JSON to a BrokerStatement. Do not generate csv_tables.';
        return ok(`Archived raw (${got.path}), ${got.text.length} chars. ${csvHint} Do not invent numbers.`, {
          path: got.path,
          text: got.text,
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  };
}

export function createSaveBrokerParserTool(): AgentTool {
  return {
    name: 'save_broker_parser',
    label: 'Save generated broker parser',
    description:
      'Persist a declarative csv_tables mapping spec for a catalog connector. The host interprets the spec (no eval). Used when the catalog parser cannot read the statement format (e.g. IBKR CSV instead of XML).',
    parameters: Type.Object({
      ...channelIdParams,
      connector_id: Type.String({ description: 'Catalog connector id (e.g. ibkr).' }),
      spec: Type.Object(
        {},
        {
          additionalProperties: true,
          description:
            'csv_tables spec: { kind, skipCurrencies, cash: { headerMustInclude, columns }, positions: { headerMustInclude, columns } }.',
        },
      ),
    }),
    execute: async (_id, raw) => {
      const p = raw as ChannelIds & { connector_id: string; spec: unknown };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        const slug = state.user.slug;
        if (!slug) throw new Error('Investor state has no user.slug.');
        const id = p.connector_id.trim();
        if (!getBrokerAdapter(id).usesCsvTables) {
          throw new Error(`csv_tables parsers are only for IBKR Flex, not "${id}".`);
        }
        const spec = assertCsvTablesSpec(p.spec);
        const path = saveBrokerParserSpec(slug, id, spec);
        return ok(`Saved parser spec for ${p.connector_id.trim()} at ${path}. Call sync again or parse_broker_raw.`, {
          path,
          connector_id: p.connector_id.trim(),
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  };
}

export function createParseBrokerRawTool(): AgentTool {
  return {
    name: 'parse_broker_raw',
    label: 'Run generated broker parser',
    description:
      'Run the saved csv_tables spec (or a spec argument) against archived raw text. Returns a BrokerStatement. Does not apply. Fail-fast if columns are missing.',
    parameters: Type.Object({
      ...channelIdParams,
      connector_id: Type.String({ description: 'Catalog connector id (e.g. ibkr).' }),
      path: Type.Optional(Type.String({ description: 'Raw archive path. Default: latest for this connector.' })),
      spec: Type.Optional(
        Type.Object({}, { additionalProperties: true, description: 'csv_tables spec; omit to use the saved spec.' }),
      ),
    }),
    execute: async (_id, raw) => {
      const p = raw as ChannelIds & { connector_id: string; path?: string; spec?: unknown };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        const slug = state.user.slug;
        if (!slug) throw new Error('Investor state has no user.slug.');
        const id = p.connector_id.trim();
        getBrokerConnector(id);
        if (!getBrokerAdapter(id).usesCsvTables) {
          throw new Error(`csv_tables parsers are only for IBKR Flex, not "${id}".`);
        }
        const spec = p.spec != null ? assertCsvTablesSpec(p.spec) : null;
        const saved = spec ?? loadBrokerParserSpec(slug, id);
        if (!saved) throw new Error(`No parser spec for "${id}". Call save_broker_parser first.`);
        const got = readBrokerRawFile(slug, id, p.path);
        const statement = runCsvTablesSpec(got.text, saved, getBrokerConnector(id).channel);
        return ok(
          `Parsed ${id} raw via csv_tables: account ${statement.account_id}, cash ${statement.cash.length} sleeve(s), lots ${statement.lots.length}. Call apply_broker_statement to write books.`,
          { path: got.path, statement },
        );
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  };
}

export function createApplyBrokerStatementTool(): AgentTool {
  return {
    name: 'apply_broker_statement',
    label: 'Apply broker statement',
    description:
      'Apply a validated BrokerStatement (account_id, as_of, cash[].amount, lots[].holding) onto the catalog connector channel. Same apply path as catalog sync. This is the books snapshot — not Flex/CSV vendor rows. Use after LLM-reading raw text or parse_broker_raw. Never invent numbers.',
    parameters: Type.Object({
      ...channelIdParams,
      connector_id: Type.String({ description: 'Catalog connector id (e.g. ibkr).' }),
      statement: Type.Object(
        {},
        {
          additionalProperties: true,
          description:
            'Public BrokerStatement: account_id, as_of, cash[{currency,amount}], lots[{ticker,currency,holding}]. Not Flex openPositions/endingCash.',
        },
      ),
    }),
    execute: async (_id, raw) => {
      const p = raw as ChannelIds & { connector_id: string; statement: unknown };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        const doc = assertBrokerStatement(p.statement);
        const applied = await applyBrokerStatement(snapshot, p.connector_id.trim(), doc);
        const skip =
          applied.skipped.length > 0
            ? [`Not imported (${applied.skipped.length}):`, ...applied.skipped.map((s) => `- ${formatBrokerSkip(s)}`)]
            : [];
        return ok(
          [
            `Applied ${p.connector_id.trim()} statement account ${applied.accountId} as of ${applied.asOf}.`,
            `Lots upserted: ${applied.lotsUpserted}. Lots removed: ${applied.lotsRemoved}.`,
            `Cash: ${applied.cash.map((c) => `${c.currency} ${c.amount}`).join(', ')}`,
            ...skip,
          ].join('\n'),
          {
            accountId: applied.accountId,
            asOf: applied.asOf,
            lotsUpserted: applied.lotsUpserted,
            lotsRemoved: applied.lotsRemoved,
            cash: applied.cash,
            not_imported: applied.skipped,
          },
        );
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  };
}
