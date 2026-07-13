import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify } from 'yaml';

/**
 * resolveDataRoot() snapshots UTARUS_DATA_ROOT at first utarus import and
 * requires an absolute path for host-project data. Set env before importing.
 */
const dataRoot = mkdtempSync(join(tmpdir(), 'invage-test-'));
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;

const {
  loadInvestorState,
  resolveInvestorByTelegramUser,
  getPortfolio,
  getPlaybook,
  saveInvestorState,
  setPortfolio,
  updatePlaybook,
} = await import('../src/state/portfolio-state.js');

describe('portfolio-state', () => {
  beforeAll(() => {
    const usersDir = join(dataRoot, 'users');
    mkdirSync(usersDir, { recursive: true });
    writeFileSync(
      join(usersDir, 'alice.yaml'),
      stringify({
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          slug: 'alice',
          created_at: '2026-06-27',
          telegram_user_ids: [111],
          auth_token: '00000000-0000-4000-8000-000000000002',
        },
        profile: { display_name: 'Alice', contact_email: 'a@example.com' },
        log: [{ ts: '2026-06-27', action: 'created' }],
        portfolio: {
          AAPL: { avg_price: 200, units: 5, category: 'SL Technology S1' },
        },
      }),
      'utf-8',
    );
  });

  afterAll(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('loads portfolio and resolves by telegram id', () => {
    const state = loadInvestorState('alice');
    expect(state.profile.display_name).toBe('Alice');
    expect(getPortfolio(state).AAPL?.units).toBe(5);

    const byTg = resolveInvestorByTelegramUser(111);
    expect(byTg?.user.slug).toBe('alice');
    expect(resolveInvestorByTelegramUser(999)).toBeNull();
  });

  it('saves portfolio mutations', () => {
    const state = loadInvestorState('alice');
    const portfolio = getPortfolio(state);
    portfolio.MSFT = { avg_price: 300, units: 2 };
    setPortfolio(state, portfolio);
    state.log.push({ ts: '2026-06-28', action: 'holding_added', ticker: 'MSFT' });
    saveInvestorState(state);

    const reloaded = loadInvestorState('alice');
    expect(getPortfolio(reloaded).MSFT?.units).toBe(2);
  });

  it('resolves default playbook when none stored', () => {
    const state = loadInvestorState('alice');
    const pb = getPlaybook(state);
    expect(pb.risk.profile).toBe('balanced');
    expect(pb.philosophy).toBe('value_investing');
  });

  it('persists playbook updates', () => {
    const state = loadInvestorState('alice');
    updatePlaybook(state, {
      risk: { profile: 'conservative' },
      philosophy: 'dividend_investing',
    });
    state.log.push({ ts: '2026-06-28', action: 'playbook_updated' });
    saveInvestorState(state);

    const reloaded = loadInvestorState('alice');
    const pb = getPlaybook(reloaded);
    expect(pb.risk.profile).toBe('conservative');
    expect(pb.philosophy).toBe('dividend_investing');
  });
});
