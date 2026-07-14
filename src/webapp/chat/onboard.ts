/**
 * Web invite redeem — POST /api/onboard/redeem
 *
 * Onboards a brand-new web user (no chat-platform id) using the framework's
 * `ensureChannelUser({ web: true })` extension (Branch A).
 *
 * Demo mode: when demo mode is enabled and `code` is null, the handler
 * creates a profile directly via ensureChannelUser({ source: 'demo', web: true }).
 *
 * On success: sets the bindrive_session cookie and returns { slug, redirect }.
 * The browser never sees the raw auth_token in the response body.
 *
 * Spec: docs/webui-chat-design.md §4.4, §10 (New user via web invite redeem).
 */

import { Router } from 'express';
import {
  redeemInviteInstantly,
  ensureChannelUser,
  isDemoModeEnabled,
  createSession,
  type AuthUser,
} from 'utarus';
import { resolveInvestorBySlug } from '../../state/portfolio-state.js';

export const onboardRedeemRouter = Router();

interface RedeemBody {
  display_name?: unknown;
  code?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

onboardRedeemRouter.post('/redeem', (req, res) => {
  const body = req.body as RedeemBody;

  if (!isNonEmptyString(body.display_name) || body.display_name.trim().length > 60) {
    res.status(400).json({ error: 'invalid_display_name', message: 'Display name must be 1–60 chars.' });
    return;
  }
  const displayName = body.display_name.trim();

  const demoActive = isDemoModeEnabled();
  const hasCode = isNonEmptyString(body.code);

  if (!hasCode && !demoActive) {
    res.status(400).json({ error: 'invalid_code', message: 'Invite code required (or ask an admin to enable demo mode).' });
    return;
  }

  let slug: string;
  let displayOut: string;

  try {
    if (hasCode) {
      const code = (body.code as string).trim().toUpperCase();
      const result = redeemInviteInstantly({
        code,
        displayName,
        web: true,
      });
      slug = result.slug;
      displayOut = result.displayName;
    } else {
      // Demo mode + no code → auto-create.
      const result = ensureChannelUser({
        displayName,
        web: true,
        source: 'demo',
      });
      slug = result.slug;
      displayOut = result.displayName;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already used|revoked|not found|not redeemable/i.test(msg)) {
      res.status(409).json({ error: 'code_not_redeemable', message: msg });
      return;
    }
    if (/slug/i.test(msg) && /exist|collision/i.test(msg)) {
      res.status(409).json({ error: 'slug_taken', message: msg });
      return;
    }
    res.status(400).json({ error: 'redeem_failed', message: msg });
    return;
  }

  // Verify the freshly-created state file is loadable (fail fast — no fallback).
  const state = resolveInvestorBySlug(slug);
  if (!state) {
    res.status(500).json({ error: 'redeem_failed', message: `User "${slug}" was not created on disk.` });
    return;
  }
  if (!state.user.auth_token) {
    res.status(500).json({ error: 'redeem_failed', message: `User "${slug}" missing auth_token.` });
    return;
  }

  const user: AuthUser = {
    type: 'user',
    slug,
    displayName: displayOut,
    userId: state.user.id,
  };
  const sessionToken = createSession(user);
  res.cookie('bindrive_session', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.json({ slug, redirect: '/' });
});
