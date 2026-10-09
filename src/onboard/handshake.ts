import { getSharedAccountClient } from '../../node_modules/utarus/dist/accounts/shared-runtime.js';
import { getDatabaseRuntime } from 'utarus/database';
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
  blankState,
  hashPassword,
  generateMemorablePassword,
  resolveUserBySlackUser,
  resolveUserById,
} from 'utarus';
import type { InvestorState } from '../state/portfolio-state.js';
import { productHostLabel } from '../product-name.js';
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
  userId?: string;
  /** When true, create via ensureChannelUser({ web: true }) if no session user. */
  web?: boolean;
}

export interface BindResult {
  reply: string;
  slug?: string;
}

export async function handleBind(args: BindArgs): Promise<BindResult> {
  const { payload, slackUserId, userId, web } = args;
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
      reply: `This onboarding link has been rejected. Contact the ${productHostLabel()} team.`,
    };
  }
  if (isExpired(entry)) {
    return {
      reply: `This onboarding link has expired (${tokenTtlMinutes()}-minute limit). Please register again: ${LANDING_URL}`,
    };
  }

  // Already-registered Slack user → bind token for audit, stop.
  if (slackUserId) {
    const existing = await resolveUserBySlackUser(slackUserId);
    if (existing) {
      markUsed(token, slackUserId, existing.user.id);
      return {
        reply: `You're already registered as *${existing.profile.display_name}* (slug: \`${existing.user.id}\`).`,
        slug: existing.user.id,
      };
    }
  }

  // Already-authenticated WebUI user → mark token used for this session, stop.
  if (web && userId) {
    const existing = await resolveUserById(userId);
    if (existing) {
      markUsed(token, `web:${userId}`, existing.user.id);
      return {
        reply: `You're already registered as *${existing.profile.display_name}* (slug: \`${existing.user.id}\`).`,
        slug: existing.user.id,
      };
    }
  }

  // A validated BIND token is this domain's registration authority. It is not
  // a framework INV invitation and must not be mislabeled as demo registration.
  const presetPassword = generateMemorablePassword();
  const state = blankState({ displayName: entry.display_name, contactEmail: entry.email_submitted, language: 'en' }) as InvestorState;
  const shared = getSharedAccountClient();
  if (!shared) state.user.password_hash = await hashPassword(presetPassword);
  if (slackUserId !== undefined) state.user.slack_user_ids = [slackUserId];
  state.portfolio = {};
  state.log.push({
    ts: new Date().toISOString().slice(0, 10), action: 'qr_onboard_bound', token,
    ...(slackUserId === undefined ? {} : { slack_user_id: slackUserId }),
    ...(web === true ? { web: true } : {}),
  });
  if (shared) await shared.register({ localUserId: state.user.id, email: entry.email_submitted,
    password: presetPassword, displayName: entry.display_name, language: 'en', location: null, profile: {} });
  await getDatabaseRuntime().registration.register({ state, mail: null, invitation: null });
  const userResult = { slug: state.user.id, presetPassword };

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
      `Hi *${entry.display_name}*! You're now registered with ${productHostLabel()} as \`${userResult.slug}\`.\n` +
      passwordLine +
      `\nYou can start right away — add holdings, ask for a portfolio review, or research a ticker. ` +
      `Try \`/guidance start\` for a short how-to.`,
    slug: userResult.slug,
  };
}
