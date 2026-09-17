import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { saveInvestor } from '../state/investor-store.js';
import {
  applyReconChannel,
  decideReconLine,
  formatReconChannel,
  getRecon,
  skipReconChannel,
  sourceReconConnector,
  sourceReconPaste,
  startRecon,
} from '../recon/index.js';
import type { ReconLineDecision, ReconStatement } from '../recon/types.js';
import { cashSlotKey } from '../state/portfolio-state.js';
import {
  channelIdParams,
  resolveInvestorFromChannel,
  type ChannelIds,
} from './channel.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}
function failFrom(error: unknown): AgentToolResult<null> {
  return fail(error instanceof Error ? error.message : String(error));
}

function formatView(view: ReturnType<typeof getRecon>): string {
  const sleeves = view.sleeves
    .map((s) => `  ${formatReconChannel(s.channel)}: ${s.status}`)
    .join('\n');
  const open =
    view.open_lines.length === 0
      ? '  (none)'
      : view.open_lines
          .map((l) => {
            if (l.kind === 'cash') {
              return `  ${l.id} cash ${l.currency} books=${l.books_amount} statement=${l.statement_amount}`;
            }
            if (l.kind === 'lot') {
              return `  ${l.id} lot ${l.item} units books=${l.books_units} statement=${l.statement_units}`;
            }
            return `  ${l.id} deposit ${l.item} books=${l.books_amount} statement=${l.statement_amount}`;
          })
          .join('\n');
  return [
    `Recon as_of ${view.as_of} status=${view.status} next=${view.next}`,
    `Current sleeve: ${formatReconChannel(view.current_channel)}`,
    'Sleeves:',
    sleeves,
    'Open lines (need keep / take / skip):',
    open,
  ].join('\n');
}

export function createReconTools(): AgentTool[] {
  const start: AgentTool = {
    name: 'start_recon',
    label: 'Start channel recon',
    description:
      'Open a channel recon session. Walks every custody sleeve (books channels + enabled brokers). ' +
      'as_of is the statement date (YYYY-MM-DD). If no sleeves exist, pass channel to open one. ' +
      'restart=true replaces an in-progress session. Completeness is session state, not a sentence. ' +
      'Pass channel ids from message context.',
    parameters: Type.Object({
      ...channelIdParams,
      as_of: Type.String({ description: 'Statement date YYYY-MM-DD.' }),
      channel: Type.Optional(
        Type.String({
          description: 'Optional sleeve to include when books are empty (e.g. ocbc).',
        }),
      ),
      restart: Type.Optional(Type.Boolean({ description: 'Replace an in-progress recon.' })),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { as_of: string; channel?: string; restart?: boolean };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        startRecon(state, { as_of: p.as_of, channel: p.channel, restart: p.restart === true });
        await saveInvestor(snapshot);
        const view = getRecon(state);
        return ok(formatView(view), view);
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const get: AgentTool = {
    name: 'get_recon',
    label: 'Get recon session',
    description:
      'Read the current recon session: current sleeve, next action (source | decide | apply | done), open lines. ' +
      'Call before claiming the walk is complete. Pass channel ids from message context.',
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      try {
        const snapshot = await resolveInvestorFromChannel(raw as ChannelIds);
        const { state } = snapshot;
        const view = getRecon(state);
        return ok(formatView(view), view);
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const source: AgentTool = {
    name: 'source_recon_channel',
    label: 'Source recon statement',
    description:
      'Load the statement for the current (or named) sleeve, then compare to books. ' +
      'Already-have catalog connector (enabled IBKR Flex): omit cash/lots/deposits — fetches now and does not write books. ' +
      'Otherwise pass statement cash[], lots[], deposits[]. Matching lines auto-keep. Pass channel ids from context.',
    parameters: Type.Object({
      ...channelIdParams,
      channel: Type.Optional(
        Type.String({ description: 'Sleeve tag. Omit to use the current recon sleeve.' }),
      ),
      cash: Type.Optional(
        Type.Array(
          Type.Object({
            currency: Type.String({ description: 'ISO currency (USD, SGD).' }),
            amount: Type.Number({ description: 'Available cash on the statement. ≥ 0.' }),
          }),
        ),
      ),
      lots: Type.Optional(
        Type.Array(
          Type.Object({
            ticker: Type.String({ description: 'Lot ticker / base key (no @channel).' }),
            units: Type.Number({ description: 'Position size on the statement. > 0.' }),
            avg_price: Type.Optional(Type.Number({ description: 'Cost per unit when the statement has it.' })),
            instrument: Type.Optional(
              Type.String({ description: 'equity | fund | option. Omit = equity.' }),
            ),
            fund_quote_source: Type.Optional(Type.String({ description: 'manual | yahoo when instrument=fund.' })),
            fund_name: Type.Optional(Type.String()),
            mark: Type.Optional(Type.Number()),
          }),
        ),
      ),
      deposits: Type.Optional(
        Type.Array(
          Type.Object({
            id: Type.Optional(Type.String()),
            amount: Type.Number(),
            currency: Type.String(),
          }),
        ),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        channel?: string;
        cash?: ReconStatement['cash'];
        lots?: ReconStatement['lots'];
        deposits?: ReconStatement['deposits'];
      };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        const view = getRecon(state);
        const channel = p.channel != null ? cashSlotKey(p.channel) : view.current_channel;
        const pasted = p.cash != null || p.lots != null || p.deposits != null;
        if (pasted) {
          sourceReconPaste(state, channel, {
            cash: p.cash ?? [],
            lots: p.lots ?? [],
            deposits: p.deposits ?? [],
          });
        } else {
          await sourceReconConnector(state, channel);
        }
        await saveInvestor(snapshot);
        const next = getRecon(state);
        return ok(formatView(next), next);
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const decide: AgentTool = {
    name: 'decide_recon_line',
    label: 'Decide recon line',
    description:
      'Set keep (leave books), take (statement wins), or skip (leave books, no write) on one open recon line id from get_recon. ' +
      'Pass channel ids from message context.',
    parameters: Type.Object({
      ...channelIdParams,
      line_id: Type.String({ description: 'Line id from get_recon open_lines (e.g. lot:MSFT, cash:USD).' }),
      decision: Type.String({ description: 'keep | take | skip' }),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { line_id: string; decision: string };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        if (p.decision !== 'keep' && p.decision !== 'take' && p.decision !== 'skip') {
          throw new Error('decision must be keep, take, or skip.');
        }
        decideReconLine(state, p.line_id, p.decision as ReconLineDecision);
        await saveInvestor(snapshot);
        const view = getRecon(state);
        return ok(formatView(view), view);
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const apply: AgentTool = {
    name: 'apply_recon_channel',
    label: 'Apply recon sleeve',
    description:
      'Write taken lines for this sleeve. Cash take posts a journal (never set_cash) and needs books DB. ' +
      'Lots/FDs mutate only chosen lines. Then advances to the next sleeve. Pass channel ids from context.',
    parameters: Type.Object({
      ...channelIdParams,
      channel: Type.Optional(Type.String({ description: 'Sleeve tag. Omit = current.' })),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { channel?: string };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        const view = getRecon(state);
        const channel = p.channel != null ? cashSlotKey(p.channel) : view.current_channel;
        await applyReconChannel(state, channel);
        await saveInvestor(snapshot);
        const next = getRecon(state);
        return ok(formatView(next), next);
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const skip: AgentTool = {
    name: 'skip_recon_channel',
    label: 'Skip recon sleeve',
    description:
      'Postpone this sleeve (not done). Already-applied sleeves cannot be skipped. Pass channel ids from context.',
    parameters: Type.Object({
      ...channelIdParams,
      channel: Type.Optional(Type.String({ description: 'Sleeve tag. Omit = current.' })),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { channel?: string };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        const view = getRecon(state);
        const channel = p.channel != null ? cashSlotKey(p.channel) : view.current_channel;
        skipReconChannel(state, channel);
        await saveInvestor(snapshot);
        const next = getRecon(state);
        return ok(formatView(next), next);
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  return [start, get, source, decide, apply, skip];
}
