/**
 * Instant invite redeem — no Q&A.
 *
 * On a valid INV- code: create the user profile immediately (display name from
 * the channel identity), mark the invite used, link Slack/Telegram id.
 * contact_email is not collected; a non-routable placeholder is stored so the
 * framework profile schema stays satisfied.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { parse, stringify } from 'yaml';
import { resolveDataRoot } from 'utarus';
import type { InvestorState } from './portfolio-state.js';
import { saveInvestorState, userStatePath } from './portfolio-state.js';

export interface InviteRecord {
  code: string;
  created_by: number;
  created_at: string;
  comment?: string;
  used_by?: number;
  used_by_slack?: string;
  used_at?: string;
  slug?: string;
}

export interface InstantRedeemParams {
  code: string;
  displayName: string;
  slackUserId?: string;
  telegramUserId?: number;
}

export interface InstantRedeemResult {
  slug: string;
  displayName: string;
  authToken: string;
}

function invitesPath(): string {
  return join(resolveDataRoot(), 'invites.yaml');
}

function loadInvites(): InviteRecord[] {
  const path = invitesPath();
  if (!existsSync(path)) return [];
  const parsed = parse(readFileSync(path, 'utf-8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`invites.yaml must be a YAML array: ${path}`);
  }
  return parsed as InviteRecord[];
}

function saveInvites(invites: InviteRecord[]): void {
  const path = invitesPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(invites, { sortMapEntries: false }), 'utf-8');
}

function isInviteUsed(inv: InviteRecord): boolean {
  return inv.used_by != null || !!inv.used_by_slack || !!inv.used_at;
}

/** Validate unused invite; throw on invalid/used. */
export function assertInviteRedeemable(code: string): InviteRecord {
  const normalized = code.trim().toUpperCase();
  const invites = loadInvites();
  const invite = invites.find((i) => i.code.toUpperCase() === normalized);
  if (!invite) {
    throw new Error(`Invalid invite code "${normalized}".`);
  }
  if (isInviteUsed(invite)) {
    const who =
      invite.slug ??
      (invite.used_by_slack ? `Slack ${invite.used_by_slack}` : null) ??
      (invite.used_by != null ? `Telegram ${invite.used_by}` : 'another user');
    throw new Error(`Invite code "${normalized}" has already been used (${who}).`);
  }
  return invite;
}

function slugBaseFromDisplayName(displayName: string, channelHint: string): string {
  const fromName = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (fromName) return fromName;

  // Display name may be non-Latin (still stored as profile.display_name).
  // Filesystem slug must be [a-z0-9-]+ — derive from channel id.
  const fromChannel = channelHint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!fromChannel) {
    throw new Error(
      `Cannot derive user slug from display_name="${displayName}" and channel="${channelHint}"`,
    );
  }
  return `user-${fromChannel}`;
}

function uniqueSlug(base: string, channelHint: string): string {
  if (!existsSync(userStatePath(base))) return base;
  const suffix = channelHint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(-8);
  const candidate = `${base}-${suffix || randomUUID().slice(0, 8)}`;
  if (existsSync(userStatePath(candidate))) {
    throw new Error(
      `User slug "${base}" and collision slug "${candidate}" both exist. Contact an admin.`,
    );
  }
  return candidate;
}

/**
 * Create profile + mark invite used. Fail fast on any validation error.
 */
export function redeemInviteInstantly(params: InstantRedeemParams): InstantRedeemResult {
  const code = params.code.trim().toUpperCase();
  if (!params.slackUserId && params.telegramUserId == null) {
    throw new Error('redeemInviteInstantly requires slackUserId or telegramUserId');
  }
  const displayName = params.displayName.trim();
  if (!displayName) {
    throw new Error('displayName is required for instant invite redeem');
  }

  assertInviteRedeemable(code);

  const channelHint = params.slackUserId ?? String(params.telegramUserId);
  const slug = uniqueSlug(slugBaseFromDisplayName(displayName, channelHint), channelHint);
  const today = new Date().toISOString().slice(0, 10);
  const authToken = randomUUID();

  const state: InvestorState = {
    user: {
      id: randomUUID(),
      slug,
      created_at: today,
      telegram_user_ids: params.telegramUserId != null ? [params.telegramUserId] : [],
      slack_user_ids: params.slackUserId ? [params.slackUserId] : [],
      auth_token: authToken,
    },
    profile: {
      display_name: displayName,
      // Email is not collected in the instant flow; placeholder satisfies schema.
      contact_email: `${slug}@invite.local`,
    },
    log: [
      { ts: today, action: 'created' },
      {
        ts: today,
        action: 'invite_redeemed',
        invite_code: code,
        telegram_user_id: params.telegramUserId,
        slack_user_id: params.slackUserId,
        mode: 'instant',
      },
    ],
    portfolio: {},
  };

  saveInvestorState(state);

  const invites = loadInvites();
  const idx = invites.findIndex((i) => i.code.toUpperCase() === code);
  if (idx === -1) {
    throw new Error(`Invite code "${code}" disappeared during redeem`);
  }
  if (params.telegramUserId != null) {
    invites[idx].used_by = params.telegramUserId;
  }
  if (params.slackUserId) {
    invites[idx].used_by_slack = params.slackUserId;
  }
  invites[idx].used_at = today;
  invites[idx].slug = slug;
  saveInvites(invites);

  return { slug, displayName, authToken };
}

/**
 * Resolve Slack display name via users.info. Fail fast if token/API/name missing.
 */
export async function fetchSlackDisplayName(slackUserId: string): Promise<string> {
  if (!slackUserId) {
    throw new Error('slackUserId is required to fetch Slack display name');
  }
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN is required to resolve Slack display name during invite redeem');
  }

  const url = new URL('https://slack.com/api/users.info');
  url.searchParams.set('user', slackUserId);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Slack users.info HTTP ${res.status} for user ${slackUserId}`);
  }
  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    user?: {
      name?: string;
      real_name?: string;
      profile?: { display_name?: string; real_name?: string };
    };
  };
  if (!data.ok) {
    throw new Error(`Slack users.info failed for ${slackUserId}: ${data.error ?? 'unknown error'}`);
  }
  const profile = data.user?.profile;
  const name =
    (profile?.display_name && profile.display_name.trim()) ||
    (profile?.real_name && profile.real_name.trim()) ||
    (data.user?.real_name && data.user.real_name.trim()) ||
    (data.user?.name && data.user.name.trim()) ||
    '';
  if (!name) {
    throw new Error(`Slack user ${slackUserId} has no displayable name`);
  }
  return name;
}
