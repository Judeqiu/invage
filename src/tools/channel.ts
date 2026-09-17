/**
 * Shared channel identity for domain tools.
 * Message context always provides telegram_user_id OR slack_user_id OR user_slug — never invent any.
 */

import { Type } from 'typebox';
import { getDatabaseRuntime } from 'utarus/database';
import type { InvestorSnapshot } from '../state/investor-store.js';
import type { InvestorState } from '../state/portfolio-state.js';

/** TypeBox fields to merge into tool parameters. */
export const channelIdParams = {
  telegram_user_id: Type.Optional(
    Type.Number({
      description:
        'Telegram user ID from the message context (Telegram). Provide this OR slack_user_id OR user_slug.',
    }),
  ),
  slack_user_id: Type.Optional(
    Type.String({
      description:
        'Slack user ID from the message context (Slack). Provide this OR telegram_user_id OR user_slug.',
    }),
  ),
  user_slug: Type.Optional(
    Type.String({
      description:
        'User slug from the message context (Web channel). Provide this OR telegram_user_id OR slack_user_id.',
    }),
  ),
} as const;

export type ChannelIds = {
  telegram_user_id?: number;
  slack_user_id?: string;
  user_slug?: string;
};

export async function resolveInvestorFromChannel(p: ChannelIds): Promise<InvestorSnapshot> {
  const users = getDatabaseRuntime().users;
  let snapshot;
  if (p.user_slug) snapshot = await users.findBySlug(p.user_slug);
  else if (p.telegram_user_id != null) snapshot = await users.findByExternalIdentity('telegram', String(p.telegram_user_id), 'all');
  else if (p.slack_user_id) snapshot = await users.findByExternalIdentity('slack', p.slack_user_id, 'all');
  else throw new Error('Provide user_slug, telegram_user_id, or slack_user_id from the message context (never invent any).');
  if (snapshot === null) throw new Error('No registered user for the supplied channel identity.');
  return { state: snapshot.state as InvestorState, revision: snapshot.revision };
}
