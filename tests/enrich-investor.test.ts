import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify } from 'yaml';

const dataRoot = mkdtempSync(join(tmpdir(), 'invage-enrich-'));
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;

const { invageExtension } = await import('../src/extension.js');

describe('invage enrichMessage (domain only — access is Utarus)', () => {
  beforeAll(() => {
    mkdirSync(join(dataRoot, 'users'), { recursive: true });
    writeFileSync(
      join(dataRoot, 'users', 'cy.yaml'),
      stringify({
        user: {
          id: '00000000-0000-4000-8000-000000000099',
          slug: 'cy',
          created_at: '2026-07-13',
          slack_user_ids: ['U_CY'],
          auth_token: '00000000-0000-4000-8000-000000000098',
        },
        profile: { display_name: 'CY', contact_email: 'cy@invite.local' },
        log: [{ ts: '2026-07-13', action: 'created' }],
        portfolio: {},
      }),
    );
  });

  afterAll(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('injects investor context for linked Slack user', async () => {
    if (!invageExtension.enrichMessage) throw new Error('missing enrichMessage');
    const text = await invageExtension.enrichMessage({
      userSlug: 'cy',
      slackUserId: 'U_CY',
      isAdmin: false,
      text: 'Help me find undervalued stocks',
    });
    expect(text).toMatch(/Investor context/);
    expect(text).toMatch(/CY/);
    expect(text).toContain('Help me find undervalued stocks');
    expect(text).toMatch(/Investment Playbook/);
    expect(text).toMatch(/Strategy=|strategy/i);
    expect(text).toMatch(/Household/);
    expect(text).not.toMatch(/invite code|display_name would you|Option A/i);
  });

  it('exposes chatEmptyState with treasury starters on webUi', () => {
    const empty = invageExtension.webUi?.chatEmptyState;
    expect(empty).toBeTruthy();
    expect(empty!.title.length).toBeGreaterThan(0);
    expect(empty!.body.length).toBeGreaterThan(0);
    const labels = (empty!.starters ?? []).map((s) => s.label);
    expect(labels.some((l) => /house|household|cash flow|portfolio/i.test(l))).toBe(true);
  });

  it('passes through unlinked text (framework already gated)', async () => {
    if (!invageExtension.enrichMessage) throw new Error('missing enrichMessage');
    const text = await invageExtension.enrichMessage({
      userSlug: '',
      slackUserId: 'U_UNKNOWN',
      isAdmin: false,
      text: 'hello',
    });
    expect(text).toBe('hello');
  });
});
