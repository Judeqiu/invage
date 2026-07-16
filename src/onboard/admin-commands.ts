/**
 * Admin commands for the onboard flow (Slack + WebUI):
 *   /onboard list [pending|used|rejected|all]  — list registrations
 *   /onboard reject <token> [reason...]        — reject a registration
 *
 * Wired in src/extension.ts via DomainExtension.slackCommands and webCommands.
 */

import { listTokens, markRejected, findToken } from './token-store.js';
import type { OnboardToken } from './types.js';

export interface SlackOnboardContext {
  args: string;
  slackUserId: string;
  isAdmin: boolean;
}

export interface WebOnboardContext {
  args: string;
  userSlug: string;
  isAdmin: boolean;
  conversationId?: string | null;
}

const FILTERS = ['all', 'pending', 'used', 'rejected'] as const;
type Filter = (typeof FILTERS)[number];

function formatRow(t: OnboardToken): string {
  const base = `• \`${t.token}\` — ${t.display_name} (${t.email_submitted}) — ${t.status}`;
  if (t.status === 'used') {
    return `${base}\n    used ${t.used_at} → \`${t.slug ?? '?'}\` by ${t.used_by_slack ?? '?'}`;
  }
  if (t.status === 'rejected') {
    return `${base}\n    rejected ${t.rejected_at}: ${t.rejected_reason ?? 'no reason'}`;
  }
  return `${base}\n    created ${t.created_at.slice(0, 10)}; expires ${t.expires_at.slice(11, 19)}Z`;
}

function handleOnboard(args: string, actorId: string): string {
  const parts = args.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return [
      'Usage:',
      '`/onboard list [pending|used|rejected|all]` — list registrations',
      '`/onboard reject <token> [reason...]` — reject a registration',
    ].join('\n');
  }

  const sub = parts[0].toLowerCase();
  if (sub === 'list') {
    const filterRaw = (parts[1] ?? 'all').toLowerCase();
    if (!FILTERS.includes(filterRaw as Filter)) {
      return `Unknown filter "${parts[1]}". Use: ${FILTERS.join(', ')}.`;
    }
    const filter = filterRaw as Filter;
    const rows = listTokens(filter);
    if (rows.length === 0) {
      return `No ${filter === 'all' ? '' : filter + ' '}registrations yet.`;
    }
    const head = `*${rows.length} registration${rows.length === 1 ? '' : 's'}${filter !== 'all' ? ` (${filter})` : ''}:*`;
    return [head, ...rows.map(formatRow)].join('\n');
  }

  if (sub === 'reject') {
    const token = (parts[1] ?? '').toUpperCase();
    const reason = parts.slice(2).join(' ').trim() || 'no reason given';
    if (!token) return 'Usage: `/onboard reject <token> [reason...]`';
    const existing = findToken(token);
    if (!existing) return `Token \`${token}\` not found.`;
    markRejected(token, actorId, reason);
    const slugNote = existing.slug
      ? ` Linked user \`${existing.slug}\` is flagged but not deleted (audit trail).`
      : '';
    return `Token \`${token}\` rejected.${slugNote}`;
  }

  return `Unknown subcommand "${sub}". Try: \`list\`, \`reject\`.`;
}

export function handleOnboardCommand(ctx: SlackOnboardContext): string {
  return handleOnboard(ctx.args, ctx.slackUserId);
}

export function handleOnboardWebCommand(ctx: WebOnboardContext): string {
  const actorId = ctx.userSlug ? `web:${ctx.userSlug}` : 'web:admin';
  return handleOnboard(ctx.args, actorId);
}
