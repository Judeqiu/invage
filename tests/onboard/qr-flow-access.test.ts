/**
 * Regression: investor.lextok.com QR onboarding must stay independent of
 * framework invite/demo access-gate changes.
 *
 * Flow under test:
 *   landing POST /api/onboard/register → BIND token
 *   Slack /bind <token>  (domain command — NOT free text → not gated)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, rmSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import express from 'express';
import request from 'supertest';
import { resolveDataRoot, resolveUserBySlackUser } from 'utarus';
import { tokensFilePath } from '../../src/onboard/token-store.js';
import { handleBindCommand } from '../../src/onboard/bind-command.js';
import { onboardRouter } from '../../src/onboard/api.js';
import { invageExtension } from '../../src/extension.js';

const USERS_DIR = join(resolveDataRoot(), 'users');
const DRIVE_DIR = join(resolveDataRoot(), 'drive');

function wipeState() {
  const path = tokensFilePath();
  if (existsSync(path)) rmSync(path, { force: true });
  for (const dir of [USERS_DIR, DRIVE_DIR]) {
    if (existsSync(dir)) {
      for (const entry of readdirSync(dir)) {
        rmSync(join(dir, entry), { recursive: true, force: true });
      }
    } else {
      mkdirSync(dir, { recursive: true });
    }
  }
}

function appWithOnboard() {
  const app = express();
  app.use(express.json());
  app.use('/api/onboard', onboardRouter);
  return app;
}

describe('landing + /bind isolation from framework access gate', () => {
  beforeEach(wipeState);

  it('registers /bind as a non-admin Slack domain command', () => {
    const bind = invageExtension.slackCommands?.find((c) => c.name === 'bind');
    expect(bind).toBeDefined();
    expect(bind!.adminOnly).toBe(false);
    expect(bind!.description).toMatch(/BIND/i);
  });

  it('registers the same domain command set on webCommands as slackCommands', () => {
    const slackNames = (invageExtension.slackCommands ?? []).map((c) => c.name).sort();
    const webNames = (invageExtension.webCommands ?? []).map((c) => c.name).sort();
    expect(webNames).toEqual(slackNames);
    expect(webNames).toEqual(['bind', 'guidance', 'onboard']);

    const webBind = invageExtension.webCommands?.find((c) => c.name === 'bind');
    expect(webBind).toBeDefined();
    expect(webBind!.adminOnly).toBe(false);

    const webOnboard = invageExtension.webCommands?.find((c) => c.name === 'onboard');
    expect(webOnboard).toBeDefined();
    expect(webOnboard!.adminOnly).toBe(true);
  });

  it('landing register → /bind creates user without INV- or demo mode', async () => {
    const res = await request(appWithOnboard())
      .post('/api/onboard/register')
      .send({ display_name: 'LexTok Investor', email: 'investor@lextok.com' })
      .expect(200);

    expect(res.body.token).toMatch(/^BIND-[A-Z0-9]{8}$/);
    expect(res.body.bind_command).toBe(`/bind ${res.body.token}`);
    expect(res.body.workspace_invite_url).toContain('join.slack.com');

    const slackUserId = 'U0QRTEST001';
    const reply = await handleBindCommand({
      args: res.body.token,
      slackUserId,
      isAdmin: false,
    });

    expect(reply).toMatch(/registered with Invester/i);
    const investor = resolveUserBySlackUser(slackUserId);
    expect(investor).not.toBeNull();
    expect(investor!.profile.display_name).toBe('LexTok Investor');
  });
});
