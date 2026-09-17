import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { saveInvestor } from '../state/investor-store.js';
import { syncBrokerConnection } from '../brokers/connections.js';
import { writeIbkrFlexConfig } from '../ibkr/flex-config.js';
import { IBKR_CHANNEL } from '../ibkr/flex-map.js';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}

export function createConfigureIbkrFlexTool(): AgentTool {
  return {
    name: 'configure_ibkr_flex',
    label: 'Configure IBKR Flex',
    description:
      'Store this user\'s IBKR Flex Web Service token and Activity Flex Query id (Client Portal → Flex Web Service + Flex Queries). Read-only IBKR reporting — cannot trade. Token is never printed back. After this, call sync_ibkr_flex.',
    parameters: Type.Object({
      ...channelIdParams,
      token: Type.String({ description: 'Numeric Flex Web Service token from Client Portal.' }),
      activity_query_id: Type.String({
        description: 'Activity Flex Query ID (Info icon on the Flex Queries list).',
      }),
      tradeconf_query_id: Type.Optional(
        Type.String({ description: 'Optional Trade Confirmation Flex Query ID.' }),
      ),
    }),
    execute: async (_id, raw) => {
      const p = raw as ChannelIds & {
        token: string;
        activity_query_id: string;
        tradeconf_query_id?: string;
      };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        writeIbkrFlexConfig(state, {
          token: p.token,
          activity_query_id: p.activity_query_id,
          tradeconf_query_id: p.tradeconf_query_id,
        });
        await saveInvestor(snapshot);
        return ok(
          `IBKR Flex configured for ${state.user.slug}. Channel tag: ${IBKR_CHANNEL}. Token stored (not shown). Run sync_ibkr_flex to pull Open Positions + Cash Report.`,
          { slug: state.user.slug, channel: IBKR_CHANNEL, activity_query_id: p.activity_query_id.trim() },
        );
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  };
}

export function createSyncIbkrFlexTool(): AgentTool {
  return {
    name: 'sync_ibkr_flex',
    label: 'Sync IBKR Flex',
    description:
      'Pull the user\'s IBKR Activity Flex Query (SendRequest/GetStatement v=3) and replace holdings + free cash on channel ibkr with Open Positions and Cash Report. Call anytime credentials exist and the channel is on — not only after configure. Other broker channels are left untouched. Unsupported lots are skipped and listed as not_imported; they are not invented as holdings. Archive raw XML under BinDrive ibkr-flex/. Refuses when the channel is off (does not delete lots). Read-only at IBKR. Schedule daily via create_task (Activity data updates once per business day). Enabling in Settings does not create a task.',
    parameters: Type.Object({
      ...channelIdParams,
    }),
    execute: async (_id, raw) => {
      const p = raw as ChannelIds;
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        const { applied } = await syncBrokerConnection(snapshot, IBKR_CHANNEL);
        const cashLine =
          applied.cash.length > 0
            ? `Cash: ${applied.cash.map((c) => `${c.currency} ${c.amount}`).join(', ')}`
            : 'No importable CashReport sleeves.';
        const skipLines =
          applied.skipped.length > 0
            ? [
                `Not imported (${applied.skipped.length}):`,
                ...applied.skipped.map((s) => `- ${s.symbol ?? s.currency ?? 'row'}: ${s.reason}`),
              ]
            : [];
        return ok(
          [
            `IBKR Flex synced for ${state.user.slug} (account ${applied.accountId}).`,
            `As of ${applied.asOf}. Channel ${applied.channel}.`,
            `Lots upserted: ${applied.lotsUpserted}. Lots removed from ibkr: ${applied.lotsRemoved}.`,
            cashLine,
            ...skipLines,
            applied.archivePath ? `Raw XML: ${applied.archivePath}` : '',
            'Live marks still come from Yahoo on the dashboard. Flex is IBKR books (positions + cash), not a live quote feed.',
          ]
            .filter(Boolean)
            .join('\n'),
          {
            slug: state.user.slug,
            accountId: applied.accountId,
            asOf: applied.asOf,
            channel: applied.channel,
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
