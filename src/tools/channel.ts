/**
 * Shared channel identity for domain tools.
 * Message context always provides telegram_user_id OR slack_user_id — never invent either.
 */

import { Type } from 'typebox';
import {
  resolveInvestorBySlackUser,
  resolveInvestorByTelegramUser,
  type InvestorState,
} from '../state/portfolio-state.js';

/** TypeBox fields to merge into tool parameters. */
export const channelIdParams = {
  telegram_user_id: Type.Optional(
    Type.Number({
      description:
        'Telegram user ID from the message context (Telegram). Provide this OR slack_user_id.',
    }),
  ),
  slack_user_id: Type.Optional(
    Type.String({
      description:
        'Slack user ID from the message context (Slack). Provide this OR telegram_user_id.',
    }),
  ),
} as const;

export type ChannelIds = {
  telegram_user_id?: number;
  slack_user_id?: string;
};

export function resolveInvestorFromChannel(p: ChannelIds): InvestorState {
  if (p.telegram_user_id != null) {
    const state = resolveInvestorByTelegramUser(p.telegram_user_id);
    if (!state) {
      throw new Error(
        `No user linked to Telegram ID ${p.telegram_user_id}. User must register first via invite code.`,
      );
    }
    return state;
  }
  if (p.slack_user_id) {
    const state = resolveInvestorBySlackUser(p.slack_user_id);
    if (!state) {
      throw new Error(
        `No user linked to Slack ID ${p.slack_user_id}. User must register first via invite code.`,
      );
    }
    return state;
  }
  throw new Error(
    'Provide telegram_user_id or slack_user_id from the message context (never invent either).',
  );
}
