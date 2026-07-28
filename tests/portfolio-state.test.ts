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
  loadState,
  saveState,
  resolveUserByTelegramUser,
} = await import('utarus');
const {
  getPortfolio,
  getPlaybook,
  getCash,
  setCash,
  clearCash,
  cashStrategyMetrics,
  cashDeployedForHolding,
  cashDeltaForHoldingChange,
  applyCashDelta,
  setPortfolio,
  updatePlaybook,
  assertCashBalance,
  normalizeOptionalChannel,
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
    const state = loadState('alice');
    expect(state.profile.display_name).toBe('Alice');
    expect(getPortfolio(state).AAPL?.units).toBe(5);

    const byTg = resolveUserByTelegramUser(111);
    expect(byTg?.user.slug).toBe('alice');
    expect(resolveUserByTelegramUser(999)).toBeNull();
  });

  it('saves portfolio mutations', () => {
    const state = loadState('alice');
    const portfolio = getPortfolio(state);
    portfolio.MSFT = { avg_price: 300, units: 2 };
    setPortfolio(state, portfolio);
    state.log.push({ ts: '2026-06-28', action: 'holding_added', ticker: 'MSFT' });
    saveState(state);

    const reloaded = loadState('alice');
    expect(getPortfolio(reloaded).MSFT?.units).toBe(2);
  });

  it('resolves default playbook when none stored', () => {
    const state = loadState('alice');
    const pb = getPlaybook(state);
    expect(pb.risk.profile).toBe('balanced');
    expect(pb.philosophy).toBe('value_investing');
  });

  it('persists playbook updates', () => {
    const state = loadState('alice');
    updatePlaybook(state, {
      risk: { profile: 'conservative' },
      philosophy: 'dividend_investing',
    });
    state.log.push({ ts: '2026-06-28', action: 'playbook_updated' });
    saveState(state);

    const reloaded = loadState('alice');
    const pb = getPlaybook(reloaded);
    expect(pb.risk.profile).toBe('conservative');
    expect(pb.philosophy).toBe('dividend_investing');
  });

  it('returns null cash when never recorded (does not invent 0)', () => {
    const state = loadState('alice');
    expect(getCash(state)).toBeNull();
  });

  it('persists cash balance and strategy metrics', () => {
    const state = loadState('alice');
    setCash(state, {
      amount: 12500,
      currency: 'USD',
      updated_at: '2026-07-28',
    });
    state.log.push({ ts: '2026-07-28', action: 'cash_set', amount: 12500, currency: 'USD' });
    saveState(state);

    const reloaded = loadState('alice');
    const cash = getCash(reloaded);
    expect(cash).toEqual({
      amount: 12500,
      currency: 'USD',
      updated_at: '2026-07-28',
    });

    const metrics = cashStrategyMetrics(cash, 50000, 5);
    expect(metrics.totalNav).toBe(62500);
    expect(metrics.cashWeightPct).toBeCloseTo(20, 5);
    expect(metrics.cashVsTargetPp).toBeCloseTo(15, 5);
  });

  it('clearCash removes record so cash is unknown again', () => {
    const state = loadState('alice');
    setCash(state, { amount: 100, currency: 'HKD', updated_at: '2026-07-28' });
    clearCash(state);
    saveState(state);
    expect(getCash(loadState('alice'))).toBeNull();
  });

  it('assertCashBalance fails fast on invalid input', () => {
    expect(() => assertCashBalance({ amount: -1, currency: 'USD', updated_at: '2026-07-28' })).toThrow(
      /≥ 0/,
    );
    expect(() => assertCashBalance({ amount: 10, currency: '', updated_at: '2026-07-28' })).toThrow(
      /currency/,
    );
    expect(() => assertCashBalance({ amount: 10, currency: 'USD', updated_at: 'bad' })).toThrow(
      /updated_at/,
    );
    expect(() =>
      assertCashBalance({ amount: 10, currency: 'USD', updated_at: '2026-07-28', channel: 1 }),
    ).toThrow(/channel/);
  });

  it('cash and holdings support optional channel; empty means unassigned', () => {
    expect(normalizeOptionalChannel(undefined, 'channel')).toBeUndefined();
    expect(normalizeOptionalChannel('', 'channel')).toBeUndefined();
    expect(normalizeOptionalChannel('  ', 'channel')).toBeUndefined();
    expect(normalizeOptionalChannel('ibkr', 'channel')).toBe('ibkr');
    expect(normalizeOptionalChannel('  moomoo  ', 'channel')).toBe('moomoo');
    expect(() => normalizeOptionalChannel(42, 'channel')).toThrow(/string/);

    const cash = assertCashBalance({
      amount: 100,
      currency: 'USD',
      updated_at: '2026-07-28',
      channel: 'ibkr',
    });
    expect(cash.channel).toBe('ibkr');

    const noChannel = assertCashBalance({
      amount: 100,
      currency: 'USD',
      updated_at: '2026-07-28',
      channel: '',
    });
    expect(noChannel.channel).toBeUndefined();

    const state = loadState('alice');
    setCash(state, {
      amount: 200,
      currency: 'USD',
      updated_at: '2026-07-28',
      channel: 'moomoo',
    });
    const portfolio = getPortfolio(state);
    portfolio.TSLA = { avg_price: 250, units: 4, channel: 'webull' };
    setPortfolio(state, portfolio);
    saveState(state);

    const reloaded = loadState('alice');
    expect(getCash(reloaded)?.channel).toBe('moomoo');
    expect(getPortfolio(reloaded).TSLA?.channel).toBe('webull');

    // Cash ledger updates must preserve channel
    const afterDelta = applyCashDelta(getCash(reloaded), -50, '2026-07-29', true);
    expect(afterDelta.adjusted).toBe(true);
    expect(afterDelta.cash?.channel).toBe('moomoo');
    expect(afterDelta.cash?.amount).toBe(150);
  });

  it('cashStrategyMetrics leaves weight null when cash unknown', () => {
    const m = cashStrategyMetrics(null, 10000, 5);
    expect(m.totalNav).toBe(10000);
    expect(m.cashWeightPct).toBeNull();
    expect(m.cashVsTargetPp).toBeNull();
  });

  it('cashDeployedForHolding: equity and option long/short', () => {
    expect(cashDeployedForHolding({ avg_price: 100, units: 10 })).toBe(1000);
    expect(
      cashDeployedForHolding({
        instrument: 'option',
        avg_price: 265,
        units: 1,
        option: {
          right: 'put',
          side: 'long',
          strike: 90,
          expiry: '2026-08-07',
          multiplier: 100,
          underlying: 'AAPL',
          settlement: 'physical',
          mark: 265,
        },
      }),
    ).toBe(265);
    expect(
      cashDeployedForHolding({
        instrument: 'option',
        avg_price: 265,
        units: 1,
        option: {
          right: 'put',
          side: 'short',
          strike: 90,
          expiry: '2026-08-07',
          multiplier: 100,
          underlying: 'AAPL',
          settlement: 'physical',
          mark: 265,
        },
      }),
    ).toBe(-265);
  });

  it('cashDeltaForHoldingChange: open buy deducts, close credits', () => {
    const equity = { avg_price: 50, units: 20 }; // 1000 deployed
    expect(cashDeltaForHoldingChange(null, equity)).toBe(-1000);
    expect(cashDeltaForHoldingChange(equity, null)).toBe(1000);
    // double units at same price → need another 1000
    expect(cashDeltaForHoldingChange(equity, { avg_price: 50, units: 40 })).toBe(-1000);
  });

  it('applyCashDelta deducts and fails when insufficient', () => {
    const cash = { amount: 500, currency: 'USD', updated_at: '2026-07-28' };
    const ok = applyCashDelta(cash, -200, '2026-07-28', true);
    expect(ok.adjusted).toBe(true);
    expect(ok.cash?.amount).toBe(300);

    expect(() => applyCashDelta(cash, -600, '2026-07-28', true)).toThrow(/Insufficient cash/);

    const skip = applyCashDelta(cash, -200, '2026-07-28', false);
    expect(skip.adjusted).toBe(false);
    expect(skip.cash?.amount).toBe(500);

    const unknown = applyCashDelta(null, -100, '2026-07-28', true);
    expect(unknown.adjusted).toBe(false);
    expect(unknown.cash).toBeNull();
  });
});
