import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify } from 'yaml';

const dataRoot = mkdtempSync(join(tmpdir(), 'invage-onboard-enrich-'));
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;
process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';

const { invageExtension } = await import('../src/extension.js');
const { resolveInvestorBySlackUser } = await import('../src/state/portfolio-state.js');

async function enrich(partial: {
  text: string;
  slackUserId?: string;
  telegramUserId?: number;
  isAdmin?: boolean;
}): Promise<string> {
  if (!invageExtension.enrichMessage) {
    throw new Error('enrichMessage is required for onboarding gate tests');
  }
  return invageExtension.enrichMessage({
    userSlug: '',
    text: partial.text,
    slackUserId: partial.slackUserId,
    telegramUserId: partial.telegramUserId,
    isAdmin: partial.isAdmin ?? false,
  });
}

function seedInvite(code: string): void {
  writeFileSync(
    join(dataRoot, 'invites.yaml'),
    stringify([
      {
        code,
        created_by: 0,
        created_at: '2026-07-13',
        comment: 'enrich test',
      },
    ]),
    'utf-8',
  );
  mkdirSync(join(dataRoot, 'users'), { recursive: true });
}

describe('enrichMessage instant invite onboarding', () => {
  beforeEach(() => {
    rmSync(join(dataRoot, 'users'), { recursive: true, force: true });
    mkdirSync(join(dataRoot, 'users'), { recursive: true });
    seedInvite('INV-91B6F805');
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          user: {
            name: 'cy',
            real_name: 'CY',
            profile: { display_name: 'CY', real_name: 'CY' },
          },
        }),
      })),
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('rejects unlinked user with no invite code', async () => {
    const result = await enrich({
      text: 'hello',
      slackUserId: 'U_STRANGER',
    });
    expect(result.startsWith('REPLY:')).toBe(true);
    expect(result).toMatch(/invite code/i);
  });

  it('redeems invite in one step using Slack display name — no Q&A', async () => {
    const result = await enrich({
      text: 'INV-91B6F805',
      slackUserId: 'U_CY_ENRICH',
    });

    expect(result.startsWith('REPLY:')).toBe(false);
    expect(result).toMatch(/Just onboarded/i);
    expect(result).toMatch(/display_name="CY"/);
    expect(result).toMatch(/Investor context/);
    expect(result).not.toMatch(/Collect display_name|contact_email|What display name/i);

    const investor = resolveInvestorBySlackUser('U_CY_ENRICH');
    expect(investor?.profile.display_name).toBe('CY');
    expect(investor?.user.slug).toBe('cy');

    // Next message works with no invite and no conditions
    const followUp = await enrich({
      text: 'Show my portfolio',
      slackUserId: 'U_CY_ENRICH',
    });
    expect(followUp.startsWith('REPLY:')).toBe(false);
    expect(followUp).toMatch(/Investor context/);
    expect(followUp).toContain('Show my portfolio');
  });

  it('keeps non-code text from the same message after redeem', async () => {
    const result = await enrich({
      text: 'INV-91B6F805 analyze AAPL',
      slackUserId: 'U_CY_WORK',
    });
    expect(result.startsWith('REPLY:')).toBe(false);
    expect(result).toContain('analyze AAPL');
    expect(result).toMatch(/Just onboarded/i);
  });

  it('surfaces invalid invite as REPLY error (fail fast)', async () => {
    const result = await enrich({
      text: 'INV-00000000',
      slackUserId: 'U_BAD',
    });
    expect(result.startsWith('REPLY:')).toBe(true);
    expect(result).toMatch(/Invalid invite code/i);
  });
});
