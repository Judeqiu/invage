/**
 * Shared channel identity for domain tools.
 * Message context always provides telegram_user_id OR slack_user_id OR user_id — never invent any.
 */

import { Type } from 'typebox';
import { loadStateById } from 'utarus';
import { getDatabaseRuntime } from 'utarus/database';
import type { InvestorSnapshot } from '../state/investor-store.js';
import type { InvestorState } from '../state/portfolio-state.js';

/** TypeBox fields to merge into tool parameters. */
export const channelIdParams = {
  telegram_user_id: Type.Optional(
    Type.Number({
      description:
        'Telegram user ID from the message context (Telegram). Provide this OR slack_user_id OR user_id.',
    }),
  ),
  slack_user_id: Type.Optional(
    Type.String({
      description:
        'Slack user ID from the message context (Slack). Provide this OR telegram_user_id OR user_id.',
    }),
  ),
  user_id: Type.Optional(
    Type.String({
      description:
        'User UUID from the message context (Web channel). Provide this OR telegram_user_id OR slack_user_id.',
    }),
  ),
} as const;

export type ChannelIds = {
  telegram_user_id?: number;
  slack_user_id?: string;
  user_id?: string;
};

export async function resolveInvestorFromChannel(p: ChannelIds): Promise<InvestorSnapshot> {
  const users = getDatabaseRuntime().users;
  let snapshot;
  if (p.user_id) snapshot = await users.findById(p.user_id);
  else if (p.telegram_user_id != null) snapshot = await users.findByExternalIdentity('telegram', String(p.telegram_user_id), 'all');
  else if (p.slack_user_id) snapshot = await users.findByExternalIdentity('slack', p.slack_user_id, 'all');
  else throw new Error('Provide user_id, telegram_user_id, or slack_user_id from the message context (never invent any).');
  if (snapshot === null) throw new Error('No registered user for the supplied channel identity.');
  const hydrated = await loadStateById(snapshot.state.user.id);
  return { state: hydrated.state as InvestorState, revision: hydrated.revision };
}
