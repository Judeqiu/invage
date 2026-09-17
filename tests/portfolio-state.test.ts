import { useTestDatabase, createInvestorFixture } from './helpers/database.js';
import { loadInvestor, saveInvestor } from '../src/state/investor-store.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * resolveDataRoot() snapshots UTARUS_DATA_ROOT at first utarus import and
 * requires an absolute path for host-project data. Set env before importing.
 */
const testDatabase = await useTestDatabase();

const dataRoot = mkdtempSync(join(tmpdir(), 'invage-test-'));
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;

const {
  resolveUserByTelegramUser,
} = await import('utarus');
const {
  getPortfolio,
  getPlaybook,
  getCash,
  getCashes,
  setCash,
  setCashes,
  clearCash,
  totalCash,
  findCashForChannel,
  findCashForSlot,
  findCashesForChannel,
  cashBalanceKey,
  cashSlotKey,
  formatCashSlotLabel,
  cashStrategyMetrics,
  cashDeployedForHolding,
  cashDeltaForHoldingChange,
  applyCashDelta,
  accumulateHoldingBuy,
  setPortfolio,
  updatePlaybook,
  assertCashBalance,
  assertBrokerConnectionMetrics,
  assertFixedDeposit,
  normalizeCashes,
  normalizeDeposits,
  normalizeOptionalChannel,
  getDeposits,
  setDeposits,
  upsertDeposit,
  removeDeposit,
  clearDeposits,
  findDepositById,
  totalDepositsPrincipal,
  generateDepositId,
  transferCash,
  matureDeposit,
} = await import('../src/state/portfolio-state.js');

describe('portfolio-state', () => {
  beforeAll(async () => {
    const usersDir = join(dataRoot, 'users');
    mkdirSync(usersDir, { recursive: true });
    await createInvestorFixture({
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
      });
  });

  afterAll(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('loads portfolio and resolves by telegram id', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    expect(state.profile.display_name).toBe('Alice');
    expect(getPortfolio(state).AAPL?.units).toBe(5);

    const byTg = (await resolveUserByTelegramUser(111));
    expect(byTg?.user.slug).toBe('alice');
    expect((await resolveUserByTelegramUser(999))).toBeNull();
  });

  it('saves portfolio mutations', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    const portfolio = getPortfolio(state);
    portfolio.MSFT = { avg_price: 300, units: 2 };
    setPortfolio(state, portfolio);
    state.log.push({ ts: '2026-06-28', action: 'holding_added', ticker: 'MSFT' });
    await saveInvestor(stateSnapshot);

    const reloadedSnapshot = await loadInvestor('alice');
    const reloaded = reloadedSnapshot.state;
    expect(getPortfolio(reloaded).MSFT?.units).toBe(2);
  });

  it('resolves default playbook when none stored', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    const pb = getPlaybook(state);
    expect(pb.risk.profile).toBe('balanced');
    expect(pb.philosophy).toBe('value_investing');
  });

  it('persists playbook updates', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    updatePlaybook(state, {
      risk: { profile: 'conservative' },
      philosophy: 'dividend_investing',
    });
    state.log.push({ ts: '2026-06-28', action: 'playbook_updated' });
    await saveInvestor(stateSnapshot);

    const reloadedSnapshot = await loadInvestor('alice');
    const reloaded = reloadedSnapshot.state;
    const pb = getPlaybook(reloaded);
    expect(pb.risk.profile).toBe('conservative');
    expect(pb.philosophy).toBe('dividend_investing');
  });

  it('returns null cash when never recorded (does not invent 0)', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    expect(getCash(state)).toBeNull();
  });

  it('persists cash balance and strategy metrics', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    setCash(state, {
      amount: 12500,
      currency: 'USD',
      updated_at: '2026-07-28',
    });
    state.log.push({ ts: '2026-07-28', action: 'cash_set', amount: 12500, currency: 'USD' });
    await saveInvestor(stateSnapshot);

    const reloadedSnapshot = await loadInvestor('alice');
    const reloaded = reloadedSnapshot.state;
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

  it('clearCash removes record so cash is unknown again', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    setCash(state, { amount: 100, currency: 'HKD', updated_at: '2026-07-28' });
    clearCash(state);
    await saveInvestor(stateSnapshot);
    expect(getCash((await loadInvestor('alice')).state)).toBeNull();
  });

  it('assertCashBalance fails fast on invalid input', async () => {
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

  it('cash and holdings support optional channel; empty means unassigned', async () => {
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

    const withSettlement = assertCashBalance({
      amount: 10000,
      currency: 'USD',
      updated_at: '2026-07-28',
      channel: 'ibkr',
      settled_amount: 9800,
      accrued_interest: 12.5,
    });
    expect(withSettlement.settled_amount).toBe(9800);
    expect(withSettlement.accrued_interest).toBe(12.5);
    expect(() =>
      assertCashBalance({
        amount: 10,
        currency: 'USD',
        updated_at: '2026-07-28',
        settled_amount: -1,
      }),
    ).toThrow(/settled_amount/);

    const metrics = assertBrokerConnectionMetrics({
      as_of: '2026-07-31',
      currency: 'usd',
      buying_power: 50000,
      maintenance_margin: 12000,
    });
    expect(metrics.currency).toBe('USD');
    expect(metrics.buying_power).toBe(50000);
    expect(() =>
      assertBrokerConnectionMetrics({
        as_of: '2026-07-31',
        currency: 'USD',
        sma: 1,
      }),
    ).toThrow(/unknown field "sma"/);
    expect(() =>
      assertBrokerConnectionMetrics({ as_of: '2026-07-31', currency: 'USD' }),
    ).toThrow(/buying_power, excess_liquidity, and\/or maintenance_margin/);

    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    setCash(state, {
      amount: 200,
      currency: 'USD',
      updated_at: '2026-07-28',
      channel: 'moomoo',
    });
    const portfolio = getPortfolio(state);
    portfolio.TSLA = { avg_price: 250, units: 4, channel: 'webull' };
    setPortfolio(state, portfolio);
    await saveInvestor(stateSnapshot);

    const reloadedSnapshot = await loadInvestor('alice');
    const reloaded = reloadedSnapshot.state;
    expect(getCash(reloaded)?.channel).toBe('moomoo');
    expect(getPortfolio(reloaded).TSLA?.channel).toBe('webull');

    // Cash ledger updates must preserve channel (debit the matching slot)
    const afterDelta = applyCashDelta(getCashes(reloaded), -50, '2026-07-29', true, 'moomoo');
    expect(afterDelta.adjusted).toBe(true);
    expect(afterDelta.cash?.channel).toBe('moomoo');
    expect(afterDelta.cash?.amount).toBe(150);
  });

  it('cashStrategyMetrics leaves weight null when cash unknown', async () => {
    const m = cashStrategyMetrics(null, 10000, 5);
    expect(m.totalNav).toBe(10000);
    expect(m.cashWeightPct).toBeNull();
    expect(m.cashVsTargetPp).toBeNull();
  });

  it('cashDeployedForHolding: equity and option long/short', async () => {
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

  it('cashDeltaForHoldingChange: open buy deducts, close credits', async () => {
    const equity = { avg_price: 50, units: 20 }; // 1000 deployed
    expect(cashDeltaForHoldingChange(null, equity)).toBe(-1000);
    expect(cashDeltaForHoldingChange(equity, null)).toBe(1000);
    // double units at same price → need another 1000
    expect(cashDeltaForHoldingChange(equity, { avg_price: 50, units: 40 })).toBe(-1000);
  });

  it('accumulateHoldingBuy blends equity cost and cash delta is this-trade only', async () => {
    // META: 7 @ 601.97 + buy 5 @ 541.88 → 12 blended (user bug: was replace→5)
    const existing = {
      instrument: 'equity' as const,
      avg_price: 601.97,
      units: 7,
      channel: 'jude_futu',
      category: 'SL Technology S1',
    };
    const purchase = {
      instrument: 'equity' as const,
      avg_price: 541.88,
      units: 5,
      channel: 'jude_futu',
    };
    const next = accumulateHoldingBuy(existing, purchase);
    expect(next.units).toBe(12);
    const expectedAvg = (7 * 601.97 + 5 * 541.88) / 12;
    expect(next.avg_price).toBeCloseTo(expectedAvg, 10);
    expect(next.channel).toBe('jude_futu');
    expect(next.category).toBe('SL Technology S1');
    // Cash should only move by the new lot cost (−5 × 541.88), not wipe prior basis
    const delta = cashDeltaForHoldingChange(existing, next);
    expect(delta).toBeCloseTo(-(5 * 541.88), 10);
  });

  it('accumulateHoldingBuy keeps existing encumbrance and broker_ref', async () => {
    const existing = {
      instrument: 'equity' as const,
      avg_price: 10,
      units: 100,
      channel: 'ibkr',
      encumbrance: { kind: 'lent' as const, units: 40 },
      broker_ref: { native_id: '123', listing_exchange: 'NASDAQ' },
    };
    const purchase = {
      instrument: 'equity' as const,
      avg_price: 11,
      units: 10,
      channel: 'ibkr',
    };
    const next = accumulateHoldingBuy(existing, purchase);
    expect(next.units).toBe(110);
    expect(next.encumbrance).toEqual({ kind: 'lent', units: 40 });
    expect(next.broker_ref).toEqual({ native_id: '123', listing_exchange: 'NASDAQ' });
  });

  it('accumulateHoldingBuy refuses to merge purchase encumbrance', async () => {
    expect(() =>
      accumulateHoldingBuy(
        { avg_price: 10, units: 10 },
        { avg_price: 11, units: 1, encumbrance: { kind: 'pledged', units: 1 } },
      ),
    ).toThrow(/does not merge encumbrance or broker_ref/);
  });

  it('accumulateHoldingBuy fails on instrument mismatch', async () => {
    expect(() =>
      accumulateHoldingBuy(
        { avg_price: 100, units: 1 },
        {
          instrument: 'fund',
          avg_price: 1,
          units: 10,
          fund: { quote_source: 'manual', mark: 1 },
        },
      ),
    ).toThrow(/Cannot add fund onto existing equity/);
  });

  it('accumulateHoldingBuy blends fund units and keeps quote_source', async () => {
    const existing = {
      instrument: 'fund' as const,
      avg_price: 1.0,
      units: 100,
      fund: { quote_source: 'manual' as const, mark: 1.02, name: 'MMF' },
    };
    const purchase = {
      instrument: 'fund' as const,
      avg_price: 1.01,
      units: 50,
      fund: { quote_source: 'manual' as const, mark: 1.03 },
    };
    const next = accumulateHoldingBuy(existing, purchase);
    expect(next.units).toBe(150);
    expect(next.avg_price).toBeCloseTo((100 * 1.0 + 50 * 1.01) / 150, 10);
    expect(next.fund?.quote_source).toBe('manual');
    expect(next.fund?.mark).toBe(1.03);
    expect(next.fund?.name).toBe('MMF');
  });

  it('accumulateHoldingBuy blends option contracts and keeps existing mark when buy mark=premium', async () => {
    const existing = {
      instrument: 'option' as const,
      avg_price: 265,
      units: 1,
      option: {
        right: 'put' as const,
        side: 'short' as const,
        strike: 90,
        expiry: '2026-08-07',
        multiplier: 100,
        underlying: 'AAPL',
        settlement: 'physical' as const,
        mark: 180,
      },
    };
    const purchase = {
      instrument: 'option' as const,
      avg_price: 200,
      units: 1,
      option: {
        right: 'put' as const,
        side: 'short' as const,
        strike: 90,
        expiry: '2026-08-07',
        multiplier: 100,
        underlying: 'AAPL',
        settlement: 'physical' as const,
        mark: 200, // defaulted to trade premium
      },
    };
    const next = accumulateHoldingBuy(existing, purchase);
    expect(next.units).toBe(2);
    expect(next.avg_price).toBeCloseTo(232.5, 10);
    expect(next.option?.mark).toBe(180);
    // Short open: cash increases by new premium credit only
    expect(cashDeltaForHoldingChange(existing, next)).toBeCloseTo(200, 10);
  });

  it('applyCashDelta deducts and fails when insufficient', async () => {
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

  it('set_cash upserts by channel without overwriting other channels', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    clearCash(state);
    setCash(state, {
      amount: 12448.47,
      currency: 'USD',
      updated_at: '2026-07-29',
      channel: 'jude_futu',
    });
    setCash(state, {
      amount: 38758.91,
      currency: 'USD',
      updated_at: '2026-07-29',
      channel: 'cmbyonglong',
    });
    await saveInvestor(stateSnapshot);

    const reloadedSnapshot = await loadInvestor('alice');
    const reloaded = reloadedSnapshot.state;
    const cashes = getCashes(reloaded);
    expect(cashes).toHaveLength(2);
    expect(findCashForChannel(cashes, 'jude_futu')?.amount).toBe(12448.47);
    expect(findCashForChannel(cashes, 'cmbyonglong')?.amount).toBe(38758.91);
    expect(totalCash(cashes)?.amount).toBeCloseTo(51207.38, 2);
    // getCash returns combined total for NAV
    expect(getCash(reloaded)?.amount).toBeCloseTo(51207.38, 2);
    // YAML stores array when multi
    expect(Array.isArray(reloaded.cash)).toBe(true);

    // Upsert one channel only
    setCash(reloaded, {
      amount: 10000,
      currency: 'USD',
      updated_at: '2026-07-30',
      channel: 'jude_futu',
    });
    expect(findCashForChannel(getCashes(reloaded), 'jude_futu')?.amount).toBe(10000);
    expect(findCashForChannel(getCashes(reloaded), 'cmbyonglong')?.amount).toBe(38758.91);
  });

  it('normalizeCashes accepts legacy single object and rejects duplicate channel+currency', async () => {
    expect(normalizeCashes(null)).toEqual([]);
    expect(
      normalizeCashes({ amount: 1, currency: 'USD', updated_at: '2026-07-29', channel: 'a' }),
    ).toHaveLength(1);
    expect(() =>
      normalizeCashes([
        { amount: 1, currency: 'USD', updated_at: '2026-07-29', channel: 'a' },
        { amount: 2, currency: 'USD', updated_at: '2026-07-29', channel: 'a' },
      ]),
    ).toThrow(/Duplicate cash/);
  });

  it('lossless: multi-ccy free cash on same channel + round-trip', async () => {
    expect(cashSlotKey('dbs')).toBe('dbs');
    expect(cashBalanceKey('dbs', 'usd')).toBe('dbs@USD');
    const multi = normalizeCashes([
      { amount: 30515.65, currency: 'SGD', updated_at: '2026-07-30', channel: 'dbs' },
      { amount: 10000, currency: 'USD', updated_at: '2026-08-08', channel: 'dbs' },
    ]);
    expect(multi).toHaveLength(2);
    expect(findCashForSlot(multi, 'dbs', 'SGD')?.amount).toBe(30515.65);
    expect(findCashForSlot(multi, 'dbs', 'USD')?.amount).toBe(10000);
    expect(() => findCashForChannel(multi, 'dbs')).toThrow(/Ambiguous/);

    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    setCashes(state, multi);
    setCash(state, {
      amount: 8000,
      currency: 'USD',
      updated_at: '2026-08-08',
      channel: 'dbs',
    });
    const after = getCashes(state);
    expect(findCashForSlot(after, 'dbs', 'SGD')?.amount).toBe(30515.65);
    expect(findCashForSlot(after, 'dbs', 'USD')?.amount).toBe(8000);
  });

  it('transferCash double-entry conserves currency total', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    setCashes(state, [
      { amount: 10000, currency: 'USD', updated_at: '2026-08-08', channel: 'dbs' },
      { amount: 30515.65, currency: 'SGD', updated_at: '2026-08-08', channel: 'dbs' },
    ]);
    const result = transferCash(state, {
      fromChannel: 'dbs',
      toChannel: 'ibkr',
      amount: 10000,
      currency: 'USD',
      updatedAt: '2026-08-08',
    });
    expect(result.from.amount).toBe(0);
    expect(result.to.amount).toBe(10000);
    expect(result.to.channel).toBe('ibkr');
    expect(findCashForSlot(getCashes(state), 'dbs', 'SGD')?.amount).toBe(30515.65);
    const usdTotal = getCashes(state)
      .filter((c) => c.currency === 'USD')
      .reduce((s, c) => s + c.amount, 0);
    expect(usdTotal).toBe(10000);
  });

  it('matureDeposit unlocks principal into matching free-cash currency', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    clearCash(state);
    setCash(state, {
      amount: 30515.65,
      currency: 'SGD',
      updated_at: '2026-08-08',
      channel: 'dbs',
    });
    upsertDeposit(
      state,
      assertFixedDeposit({
        id: 'fd-dbs-20260630',
        amount: 405633.73,
        interest: 1000,
        currency: 'USD',
        start_date: '2026-01-01',
        end_date: '2026-07-30',
        updated_at: '2026-08-08',
        channel: 'dbs',
      }),
    );
    const result = matureDeposit(state, {
      id: 'fd-dbs-20260630',
      amount: 10000,
      updatedAt: '2026-08-08',
    });
    expect(result.unlocked).toBe(10000);
    expect(result.deposit?.amount).toBeCloseTo(395633.73, 2);
    expect(findCashForSlot(getCashes(state), 'dbs', 'USD')?.amount).toBe(10000);
    expect(findCashForSlot(getCashes(state), 'dbs', 'SGD')?.amount).toBe(30515.65);
  });

  it('applyCashDelta only touches the matching channel slot', async () => {
    const cashes = [
      { amount: 1000, currency: 'USD', updated_at: '2026-07-29', channel: 'jude_futu' },
      { amount: 5000, currency: 'USD', updated_at: '2026-07-29', channel: 'cmbyonglong' },
    ];
    const result = applyCashDelta(cashes, -200, '2026-07-29', true, 'cmbyonglong');
    expect(result.adjusted).toBe(true);
    expect(result.cash?.amount).toBe(4800);
    expect(result.cash?.channel).toBe('cmbyonglong');
    expect(findCashForChannel(result.cashes, 'jude_futu')?.amount).toBe(1000);
    expect(findCashForChannel(result.cashes, 'cmbyonglong')?.amount).toBe(4800);

    expect(() => applyCashDelta(cashes, -100, '2026-07-29', true, 'ibkr')).toThrow(
      /No free cash|No cash recorded/,
    );
  });

  it('applyCashDelta with adjust_cash=false does not throw on multi-ccy channel', async () => {
    const cashes = [
      { amount: 30515.65, currency: 'SGD', updated_at: '2026-07-31', channel: 'dbs' },
      { amount: 395635.93, currency: 'USD', updated_at: '2026-08-08', channel: 'dbs' },
      { amount: 9809.97, currency: 'USD', updated_at: '2026-07-29', channel: 'ocbc' },
    ];
    const skip = applyCashDelta(cashes, -20000, '2026-08-08', false, 'dbs');
    expect(skip.adjusted).toBe(false);
    expect(skip.cashDelta).toBe(0);
    expect(skip.note).toMatch(/adjust_cash=false/);
    // Slot peek may be null when ambiguous — ledger still unchanged.
    expect(skip.cashes).toEqual(cashes);

    const ocbc = applyCashDelta(cashes, -20000, '2026-08-08', false, 'ocbc');
    expect(ocbc.adjusted).toBe(false);
    expect(ocbc.cash?.channel).toBe('ocbc');
    expect(ocbc.cash?.amount).toBe(9809.97);
  });

  it('clearCash can clear one channel or all', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    setCashes(state, [
      { amount: 10, currency: 'USD', updated_at: '2026-07-29', channel: 'a' },
      { amount: 20, currency: 'USD', updated_at: '2026-07-29', channel: 'b' },
    ]);
    clearCash(state, 'a');
    expect(getCashes(state)).toHaveLength(1);
    expect(getCashes(state)[0].channel).toBe('b');
    clearCash(state);
    expect(getCashes(state)).toHaveLength(0);
    expect(getCash(state)).toBeNull();
  });

  it('totalCash converts multi-currency with FX rates', async () => {
    const total = totalCash(
      [
        { amount: 100, currency: 'USD', updated_at: '2026-07-29', channel: 'a' },
        { amount: 100, currency: 'SGD', updated_at: '2026-07-29', channel: 'b' },
      ],
      { reportingCurrency: 'USD', fxRates: { SGD: 0.74 } },
    );
    expect(total).not.toBeNull();
    expect(total!.currency).toBe('USD');
    expect(total!.amount).toBeCloseTo(100 + 74, 10);
  });

  it('totalCash fails multi-currency without FX', async () => {
    expect(() =>
      totalCash([
        { amount: 100, currency: 'USD', updated_at: '2026-07-29', channel: 'a' },
        { amount: 100, currency: 'SGD', updated_at: '2026-07-29', channel: 'b' },
      ]),
    ).toThrow(/reporting_currency|live FX|currencies/);
  });

  it('cashStrategyMetrics sums multi-channel cash', async () => {
    const m = cashStrategyMetrics(
      [
        { amount: 100, currency: 'USD', updated_at: '2026-07-29', channel: 'a' },
        { amount: 400, currency: 'USD', updated_at: '2026-07-29', channel: 'b' },
      ],
      500,
      10,
    );
    expect(m.cash?.amount).toBe(500);
    expect(m.totalNav).toBe(1000);
    expect(m.cashWeightPct).toBeCloseTo(50, 5);
    expect(m.cashes).toHaveLength(2);
  });

  it('assertFixedDeposit validates required fields fail-fast', async () => {
    const valid = {
      id: 'fd-1',
      amount: 50000,
      interest: 875,
      currency: 'USD',
      start_date: '2026-07-01',
      end_date: '2027-01-01',
      updated_at: '2026-07-29',
      channel: 'jude_futu',
      label: '6M bank TD',
    };
    const d = assertFixedDeposit(valid);
    expect(d.id).toBe('fd-1');
    expect(d.amount).toBe(50000);
    expect(d.interest).toBe(875);
    expect(d.currency).toBe('USD');
    expect(d.channel).toBe('jude_futu');
    expect(d.label).toBe('6M bank TD');

    expect(() => assertFixedDeposit({ ...valid, amount: -1 })).toThrow(/amount/);
    expect(() => assertFixedDeposit({ ...valid, interest: -1 })).toThrow(/interest/);
    expect(() => assertFixedDeposit({ ...valid, currency: '' })).toThrow(/currency/);
    expect(() => assertFixedDeposit({ ...valid, start_date: 'bad' })).toThrow(/start_date/);
    expect(() =>
      assertFixedDeposit({ ...valid, start_date: '2027-01-02', end_date: '2027-01-01' }),
    ).toThrow(/end_date/);
    expect(() => assertFixedDeposit({ ...valid, id: '' })).toThrow(/id/);
    expect(() => assertFixedDeposit({ ...valid, channel: 1 })).toThrow(/channel/);
  });

  it('normalizeDeposits rejects duplicate ids; allows multi per channel', async () => {
    expect(normalizeDeposits(null)).toEqual([]);
    const a = {
      id: 'fd-a',
      amount: 1000,
      interest: 10,
      currency: 'USD',
      start_date: '2026-01-01',
      end_date: '2026-07-01',
      updated_at: '2026-07-29',
      channel: 'jude_futu',
    };
    const b = {
      id: 'fd-b',
      amount: 2000,
      interest: 20,
      currency: 'USD',
      start_date: '2026-02-01',
      end_date: '2026-08-01',
      updated_at: '2026-07-29',
      channel: 'jude_futu',
    };
    expect(normalizeDeposits([a, b])).toHaveLength(2);
    expect(() => normalizeDeposits([a, { ...b, id: 'fd-a' }])).toThrow(/Duplicate deposit id/);
  });

  it('upsert/remove/clear deposits persist multi per channel', async () => {
    const stateSnapshot = await loadInvestor('alice');
    const state = stateSnapshot.state;
    const d1 = assertFixedDeposit({
      id: 'fd-1',
      amount: 10000,
      interest: 100,
      currency: 'USD',
      start_date: '2026-07-01',
      end_date: '2027-01-01',
      updated_at: '2026-07-29',
      channel: 'jude_futu',
    });
    const d2 = assertFixedDeposit({
      id: 'fd-2',
      amount: 20000,
      interest: 200,
      currency: 'USD',
      start_date: '2026-07-15',
      end_date: '2026-10-15',
      updated_at: '2026-07-29',
      channel: 'jude_futu',
    });
    upsertDeposit(state, d1);
    upsertDeposit(state, d2);
    expect(getDeposits(state)).toHaveLength(2);
    expect(totalDepositsPrincipal(getDeposits(state))?.amount).toBe(30000);
    expect(findDepositById(getDeposits(state), 'fd-1')?.amount).toBe(10000);

    upsertDeposit(state, { ...d1, amount: 12000, updated_at: '2026-07-30' });
    expect(findDepositById(getDeposits(state), 'fd-1')?.amount).toBe(12000);
    expect(getDeposits(state)).toHaveLength(2);

    removeDeposit(state, 'fd-2');
    expect(getDeposits(state)).toHaveLength(1);
    expect(() => removeDeposit(state, 'missing')).toThrow(/not found/);

    clearDeposits(state, 'jude_futu');
    expect(getDeposits(state)).toHaveLength(0);

    setDeposits(state, [d1, d2]);
    clearDeposits(state);
    expect(getDeposits(state)).toHaveLength(0);
  });

  it('generateDepositId is unique and includes channel/date', async () => {
    const id = generateDepositId('jude_futu', '2026-07-01', []);
    expect(id).toMatch(/^fd-jude_futu-20260701/);
    const id2 = generateDepositId('jude_futu', '2026-07-01', [{ id } as never]);
    expect(id2).not.toBe(id);
    const unassigned = generateDepositId(undefined, '2026-07-01', []);
    expect(unassigned).toMatch(/^fd-default-20260701/);
  });
});
