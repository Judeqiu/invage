import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { patchBrokerConnection, syncBrokerConnection } from '../brokers/connections.js';
import { getBrokerConnector } from '../brokers/catalog.js';
import { formatBrokerSkip } from '../brokers/statement.js';
import { saveInvestor } from '../state/investor-store.js';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}

export function createConfigureBrokerTool(): AgentTool {
  return {
    name: 'configure_broker',
    label: 'Configure broker connector',
    description:
      'Store credentials for a catalog connector (ibkr, tiger, …) via the same path as Settings → Brokers. Never echoes secrets. After this, call sync_broker with the same connector_id.',
    parameters: Type.Object({
      ...channelIdParams,
      connector_id: Type.String({ description: 'Catalog connector id (ibkr, tiger, moomoo).' }),
      credentials: Type.Object({}, { additionalProperties: Type.String(), description: 'Credential field map from the catalog.' }),
    }),
    execute: async (_id, raw) => {
      const p = raw as ChannelIds & { connector_id: string; credentials: Record<string, string> };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        const id = p.connector_id.trim();
        const def = getBrokerConnector(id);
        const result = patchBrokerConnection(state, id, {
          enabled: true,
          credentials: p.credentials,
        });
        await saveInvestor(snapshot);
        return ok(
          `${def.displayName} configured for ${state.user.slug}. Channel tag: ${def.channel}. Secrets stored (not shown). Run sync_broker.`,
          { slug: state.user.slug, connector_id: id, channel: def.channel, token_set: result.tokenSet },
        );
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  };
}

export function createSyncBrokerTool(): AgentTool {
  return {
    name: 'sync_broker',
    label: 'Sync broker connector',
    description:
      'Pull the catalog connector statement and replace lots + cash on that channel only. Read-only. Other channels stay untouched. Unsupported lots are listed as not_imported.',
    parameters: Type.Object({
      ...channelIdParams,
      connector_id: Type.String({ description: 'Catalog connector id (ibkr, tiger, moomoo).' }),
    }),
    execute: async (_id, raw) => {
      const p = raw as ChannelIds & { connector_id: string };
      try {
        const snapshot = await resolveInvestorFromChannel(p);
        const { state } = snapshot;
        const id = p.connector_id.trim();
        const def = getBrokerConnector(id);
        const { applied } = await syncBrokerConnection(snapshot, id);
        const cashLine =
          applied.cash.length > 0
            ? `Cash: ${applied.cash.map((c) => `${c.currency} ${c.amount}`).join(', ')}`
            : 'No importable cash sleeves.';
        const skipLines =
          applied.skipped.length > 0
            ? [
                `Not imported (${applied.skipped.length}):`,
                ...applied.skipped.map((s) => `- ${formatBrokerSkip(s)}`),
              ]
            : [];
        return ok(
          [
            `${def.displayName} synced for ${state.user.slug} (account ${applied.accountId}).`,
            `As of ${applied.asOf}. Channel ${applied.channel}.`,
            `Lots upserted: ${applied.lotsUpserted}. Lots removed: ${applied.lotsRemoved}.`,
            cashLine,
            ...skipLines,
            applied.archivePath ? `Raw: ${applied.archivePath}` : '',
            'Live marks still come from Yahoo on the dashboard.',
          ]
            .filter(Boolean)
            .join('\n'),
          {
            slug: state.user.slug,
            connector_id: id,
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
