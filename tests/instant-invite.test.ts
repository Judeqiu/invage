import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse, stringify } from 'yaml';

/**
 * resolveDataRoot() snapshots UTARUS_DATA_ROOT at first utarus import.
 * Must set env before importing modules that load utarus.
 */
const dataRoot = mkdtempSync(join(tmpdir(), 'invage-instant-invite-'));
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;

const { redeemInviteInstantly, assertInviteRedeemable } = await import(
  '../src/state/instant-invite.js'
);
const { resolveInvestorBySlackUser, loadInvestorState } = await import(
  '../src/state/portfolio-state.js'
);

function seedInvite(code: string): void {
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(
    join(dataRoot, 'invites.yaml'),
    stringify([
      {
        code,
        created_by: 0,
        created_at: '2026-07-13',
        comment: 'test invite',
      },
    ]),
    'utf-8',
  );
  mkdirSync(join(dataRoot, 'users'), { recursive: true });
}

describe('redeemInviteInstantly', () => {
  beforeEach(() => {
    rmSync(join(dataRoot, 'users'), { recursive: true, force: true });
    mkdirSync(join(dataRoot, 'users'), { recursive: true });
    seedInvite('INV-91B6F805');
  });

  afterAll(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('creates profile from Slack name and marks invite used', () => {
    const result = redeemInviteInstantly({
      code: 'INV-91B6F805',
      displayName: 'CY',
      slackUserId: 'U_CY_TEST',
    });

    expect(result.slug).toBe('cy');
    expect(result.displayName).toBe('CY');
    expect(result.authToken.length).toBeGreaterThan(10);

    const investor = resolveInvestorBySlackUser('U_CY_TEST');
    expect(investor).not.toBeNull();
    expect(investor!.profile.display_name).toBe('CY');
    expect(investor!.user.slack_user_ids).toContain('U_CY_TEST');
    expect(investor!.portfolio).toEqual({});

    const invites = parse(readFileSync(join(dataRoot, 'invites.yaml'), 'utf-8')) as Array<{
      code: string;
      used_by_slack?: string;
      slug?: string;
    }>;
    const inv = invites.find((i) => i.code === 'INV-91B6F805');
    expect(inv?.used_by_slack).toBe('U_CY_TEST');
    expect(inv?.slug).toBe('cy');

    expect(() => assertInviteRedeemable('INV-91B6F805')).toThrow(/already been used/i);
  });

  it('rejects invalid codes without creating a user', () => {
    expect(() =>
      redeemInviteInstantly({
        code: 'INV-DEADBEEF',
        displayName: 'Nobody',
        slackUserId: 'U_NOPE',
      }),
    ).toThrow(/Invalid invite code/i);
    expect(existsSync(join(dataRoot, 'users', 'nobody.yaml'))).toBe(false);
  });

  it('rejects second redeem of the same code', () => {
    redeemInviteInstantly({
      code: 'INV-91B6F805',
      displayName: 'First',
      slackUserId: 'U_FIRST',
    });
    expect(() =>
      redeemInviteInstantly({
        code: 'INV-91B6F805',
        displayName: 'Second',
        slackUserId: 'U_SECOND',
      }),
    ).toThrow(/already been used/i);
  });

  it('uses channel-based slug when display name has no latin alphanumerics', () => {
    const result = redeemInviteInstantly({
      code: 'INV-91B6F805',
      displayName: '张三',
      slackUserId: 'UABC1234',
    });
    expect(result.displayName).toBe('张三');
    expect(result.slug).toMatch(/^user-uabc1234$/);
    expect(loadInvestorState(result.slug).profile.display_name).toBe('张三');
  });
});
