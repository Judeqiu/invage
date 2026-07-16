import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parse, stringify } from 'yaml';
import { resolveDataRoot, resolveUserBySlackUser, loadState } from 'utarus';
import { handleBind } from '../../src/onboard/handshake.js';
import {
  createPendingToken,
  markUsed,
  markRejected,
  tokensFilePath,
} from '../../src/onboard/token-store.js';

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

describe('handleBind — terminal cases', () => {
  beforeEach(wipeState);

  it('no payload → tells user to send a token', async () => {
    const result = await handleBind({ payload: '', slackUserId: 'U111' });
    expect(result.reply).toMatch(/\/bind BIND-XXXXXXXX/);
    expect(result.reply).toMatch(/test\.example\.com\/onboard/);
    expect(result.slug).toBeUndefined();
  });

  it('token not recognised', async () => {
    const result = await handleBind({ payload: 'BIND-NOPE0000', slackUserId: 'U111' });
    expect(result.reply).toMatch(/not recognised/);
  });

  it('token already used', async () => {
    const t = createPendingToken('Alex', 'a@example.com');
    markUsed(t.token, 'U999', 'alex');
    const result = await handleBind({ payload: t.token, slackUserId: 'U111' });
    expect(result.reply).toMatch(/already been used/);
  });

  it('token rejected', async () => {
    const t = createPendingToken('Alex', 'a@example.com');
    markRejected(t.token, 'UADMIN', 'spam');
    const result = await handleBind({ payload: t.token, slackUserId: 'U111' });
    expect(result.reply).toMatch(/has been rejected/);
  });

  it('token expired', async () => {
    const t = createPendingToken('Alex', 'a@example.com');
    const raw = readFileSync(tokensFilePath(), 'utf-8');
    const arr = parse(raw) as Array<{ token: string; expires_at: string }>;
    const idx = arr.findIndex((e) => e.token === t.token);
    arr[idx].expires_at = new Date(Date.now() - 1000).toISOString();
    writeFileSync(tokensFilePath(), stringify(arr), 'utf-8');

    const result = await handleBind({ payload: t.token, slackUserId: 'U111' });
    expect(result.reply).toMatch(/expired/);
  });
});

describe('handleBind — happy path', () => {
  beforeEach(wipeState);

  it('creates user + drive folder; marks token used; greets by display name', async () => {
    const t = createPendingToken('Alex Chen', 'alex@example.com');
    const result = await handleBind({
      payload: t.token,
      slackUserId: 'U0ALEX123',
    });

    expect(result.slug).toBeDefined();
    expect(result.reply).toMatch(/Hi \*Alex Chen\*/);
    expect(result.reply).toContain(result.slug!);

    const investor = resolveUserBySlackUser('U0ALEX123');
    expect(investor).not.toBeNull();
    expect(investor!.profile.display_name).toBe('Alex Chen');
    expect(investor!.profile.contact_email).toBe('alex@example.com');
    expect(investor!.user.slack_user_ids).toContain('U0ALEX123');
    expect(investor!.portfolio ?? {}).toEqual({});

    const drivePath = join(DRIVE_DIR, result.slug!);
    expect(existsSync(drivePath)).toBe(true);

    const state = loadState(result.slug!);
    expect(state.log.some((e) => e.action === 'qr_onboard_bound')).toBe(true);
  });

  it('idempotent for already-linked slack user', async () => {
    const t1 = createPendingToken('Alex Chen', 'alex@example.com');
    const r1 = await handleBind({ payload: t1.token, slackUserId: 'U0ALEX123' });
    expect(r1.slug).toBeDefined();

    const t2 = createPendingToken('Other Name', 'other@example.com');
    const r2 = await handleBind({ payload: t2.token, slackUserId: 'U0ALEX123' });
    expect(r2.reply).toMatch(/already registered/);
    expect(r2.slug).toBe(r1.slug);
  });
});

describe('handleBind — web channel', () => {
  beforeEach(wipeState);

  it('creates web user + drive folder; marks token used; includes preset password', async () => {
    const t = createPendingToken('Web Investor', 'web@example.com');
    const result = await handleBind({
      payload: t.token,
      web: true,
    });

    expect(result.slug).toBeDefined();
    expect(result.reply).toMatch(/Hi \*Web Investor\*/);
    expect(result.reply).toMatch(/one-time login password/i);
    expect(result.reply).toContain(result.slug!);

    const drivePath = join(DRIVE_DIR, result.slug!);
    expect(existsSync(drivePath)).toBe(true);

    const state = loadState(result.slug!);
    expect(state.profile.display_name).toBe('Web Investor');
    expect(state.profile.contact_email).toBe('web@example.com');
    expect(state.log.some((e) => e.action === 'qr_onboard_bound')).toBe(true);
  });

  it('idempotent for already-authenticated web session slug', async () => {
    const t1 = createPendingToken('Web Investor', 'web@example.com');
    const r1 = await handleBind({ payload: t1.token, web: true });
    expect(r1.slug).toBeDefined();

    const t2 = createPendingToken('Other Name', 'other@example.com');
    const r2 = await handleBind({
      payload: t2.token,
      web: true,
      userSlug: r1.slug,
    });
    expect(r2.reply).toMatch(/already registered/);
    expect(r2.slug).toBe(r1.slug);
  });
});
