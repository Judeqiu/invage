/**
 * Handshake logic for the /bind <token> command (Slack + WebUI).
 *
 * Creates a Utarus user linked to the channel identity and an empty portfolio.
 * /bind is a domain slash command — it never hits the free-text access gate,
 * so landing-page users do not need an INV- code.
 */

import { mkdirSync } from 'fs';
import { join } from 'path';
import {
  resolveDataRoot,
  ensureChannelUser,
  loadState,
  saveState,
  resolveUserBySlackUser,
  resolveUserBySlug,
} from 'utarus';
import type { InvestorState } from '../state/portfolio-state.js';
import { findToken, isExpired, markUsed, tokenTtlMinutes } from './token-store.js';

const DATA_ROOT = resolveDataRoot();
const DRIVE_DIR = join(DATA_ROOT, 'drive');

const LANDING_URL = process.env.INVAGE_PUBLIC_LANDING_URL;
if (!LANDING_URL) {
  throw new Error(
    'INVAGE_PUBLIC_LANDING_URL must be set (e.g. "https://investor.lextok.com").',
  );
}

export interface BindArgs {
  /** Full text after "/bind ". Empty when the user sent "/bind" alone. */
  payload: string;
  /** Slack identity when binding from Slack /bind. */
  slackUserId?: string;
  /**
   * WebUI session slug when the caller is already authenticated.
   * Used for the already-registered path and audit trail.
   */
  userSlug?: string;
  /** When true, create via ensureChannelUser({ web: true }) if no session user. */
  web?: boolean;
}

export interface BindResult {
  reply: string;
  slug?: string;
}

export async function handleBind(args: BindArgs): Promise<BindResult> {
  const { payload, slackUserId, userSlug, web } = args;
  if (!slackUserId && !web) {
    throw new Error('handleBind requires slackUserId or web: true');
  }

  const token = payload.trim().toUpperCase();
  if (!token) {
    return {
      reply:
        `To finish registration, send me the code from the landing page like this:\n` +
        `\`/bind BIND-XXXXXXXX\`\n` +
        `\nIf you don't have a code yet, register here: ${LANDING_URL}`,
    };
  }

  const entry = findToken(token);
  if (!entry) {
    return {
      reply: `Token \`${token}\` not recognised. Please check the code and try again, or register: ${LANDING_URL}`,
    };
  }
  if (entry.status === 'used') {
    return {
      reply: 'This onboarding link has already been used. Please register again to start over.',
    };
  }
  if (entry.status === 'rejected') {
    return {
      reply: 'This onboarding link has been rejected. Contact the Invester team.',
    };
  }
  if (isExpired(entry)) {
    return {
      reply: `This onboarding link has expired (${tokenTtlMinutes()}-minute limit). Please register again: ${LANDING_URL}`,
    };
  }

  // Already-registered Slack user → bind token for audit, stop.
  if (slackUserId) {
    const existing = resolveUserBySlackUser(slackUserId);
    if (existing) {
      markUsed(token, slackUserId, existing.user.slug);
      return {
        reply: `You're already registered as *${existing.profile.display_name}* (slug: \`${existing.user.slug}\`).`,
        slug: existing.user.slug,
      };
    }
  }

  // Already-authenticated WebUI user → mark token used for this session, stop.
  if (web && userSlug) {
    const existing = resolveUserBySlug(userSlug);
    if (existing) {
      markUsed(token, `web:${userSlug}`, existing.user.slug);
      return {
        reply: `You're already registered as *${existing.profile.display_name}* (slug: \`${existing.user.slug}\`).`,
        slug: existing.user.slug,
      };
    }
  }

  const userResult = slackUserId
    ? await ensureChannelUser({
        slackUserId,
        displayName: entry.display_name,
        contactEmail: entry.email_submitted,
        source: 'invite',
        web: false,
      })
    : await ensureChannelUser({
        displayName: entry.display_name,
        contactEmail: entry.email_submitted,
        source: 'invite',
        web: true,
      });

  // Annotate user YAML with onboard audit fields (reload + save).
  const state = loadState(userResult.slug) as InvestorState;
  state.log.push({
    ts: new Date().toISOString().slice(0, 10),
    action: 'qr_onboard_bound',
    token,
    slack_user_id: slackUserId,
    web: web === true ? true : undefined,
  });
  if (!state.portfolio) state.portfolio = {};
  saveState(state);

  const drivePath = join(DRIVE_DIR, userResult.slug);
  mkdirSync(drivePath, { recursive: true });

  const usedBy = slackUserId ?? `web:${userResult.slug}`;
  markUsed(token, usedBy, userResult.slug);

  console.log(
    `[onboard] handshake complete: token=${token} ` +
      `${slackUserId ? `slack=${slackUserId}` : 'channel=web'} ` +
      `user=${userResult.slug} drive=${drivePath}`,
  );

  const passwordLine =
    web && userResult.presetPassword
      ? `\nYour one-time login password is \`${userResult.presetPassword}\` — change it after first login.\n`
      : '';

  return {
    reply:
      `Hi *${entry.display_name}*! You're now registered with Invester as \`${userResult.slug}\`.\n` +
      passwordLine +
      `\nYou can start right away — add holdings, ask for a portfolio review, or research a ticker. ` +
      `Try \`/guidance start\` for a short how-to.`,
    slug: userResult.slug,
  };
}
