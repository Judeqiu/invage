import { describe, expect, it } from 'vitest';
import { createState } from 'utarus';
import { useTestDatabase } from './helpers/database.js';

await useTestDatabase();
import type { InvestorState } from '../src/state/portfolio-state.js';
import {
  applyReconChannel,
  decideReconLine,
  getRecon,
  listReconChannels,
  skipReconChannel,
  sourceReconPaste,
  startRecon,
} from '../src/recon/index.js';
import { createReconTools } from '../src/tools/recon.js';

function investor(over: Partial<InvestorState> = {}): InvestorState {
  return {
    user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' },
    log: [],
    ...over,
  };
}

describe('listReconChannels', () => {
  it('includes books channels plus enabled connectors, unassigned last', () => {
    const state = investor({
      cash: { amount: 100, currency: 'SGD', updated_at: '2026-08-01', channel: 'dbs' },
      portfolio: {
        AAPL: { avg_price: 10, units: 1, channel: 'ibkr' },
        MSFT: { avg_price: 20, units: 2 },
      },
      deposits: [
        {
          id: 'fd-1',
          amount: 1000,
          interest: 10,
          currency: 'SGD',
          start_date: '2026-01-01',
          end_date: '2026-07-01',
          updated_at: '2026-01-01',
          channel: 'dbs',
        },
      ],
      broker_connections: {
        ibkr: { enabled: true, credentials: { token: 't', activity_query_id: 'q' } },
      },
    });
    expect(listReconChannels(state)).toEqual(['ibkr', 'dbs', '']);
  });

  it('includes an enabled connector even when that sleeve has no lots yet', () => {
    const state = investor({
      broker_connections: {
        ibkr: { enabled: true, credentials: { token: 't', activity_query_id: 'q' } },
      },
    });
    expect(listReconChannels(state)).toEqual(['ibkr']);
  });

  it('does not invent a disabled catalog connector', () => {
    const state = investor({
      broker_connections: {
        ibkr: { enabled: false, credentials: { token: 't', activity_query_id: 'q' } },
      },
    });
    expect(listReconChannels(state)).toEqual([]);
  });
});

describe('startRecon', () => {
  it('fails without as_of', () => {
    expect(() => startRecon(investor({ cash: { amount: 1, currency: 'USD', updated_at: '2026-08-01' } }), { as_of: '' })).toThrow(
      /as_of/,
    );
  });

  it('fails when there are no sleeves unless channel is named', () => {
    expect(() => startRecon(investor(), { as_of: '2026-08-28' })).toThrow(/No custody sleeves/);
    const opened = startRecon(investor(), { as_of: '2026-08-28', channel: 'ocbc' });
    expect(opened.sleeves.map((s) => s.channel)).toEqual(['ocbc']);
    expect(opened.current_channel).toBe('ocbc');
    expect(opened.status).toBe('in_progress');
  });

  it('refuses a second start unless restart is true', () => {
    const state = investor({
      cash: { amount: 1, currency: 'USD', updated_at: '2026-08-01', channel: 'ibkr' },
    });
    startRecon(state, { as_of: '2026-08-28' });
    expect(() => startRecon(state, { as_of: '2026-08-29' })).toThrow(/in progress/);
    const restarted = startRecon(state, { as_of: '2026-08-29', restart: true });
    expect(restarted.as_of).toBe('2026-08-29');
  });
});

describe('skip and paste compare', () => {
  it('skip postpones the current sleeve and advances', () => {
    const state = investor({
      cash: [
        { amount: 1, currency: 'USD', updated_at: '2026-08-01', channel: 'ibkr' },
        { amount: 2, currency: 'SGD', updated_at: '2026-08-01', channel: 'dbs' },
      ],
    });
    startRecon(state, { as_of: '2026-08-28' });
    expect(getRecon(state).current_channel).toBe('ibkr');
    skipReconChannel(state, 'ibkr');
    expect(getRecon(state).current_channel).toBe('dbs');
    expect(getRecon(state).sleeves.find((s) => s.channel === 'ibkr')?.status).toBe('skipped');
  });

  it('paste statement compares cash and lots; matches auto-keep; mismatch needs decide then take updates units', async () => {
    const state = investor({
      cash: { amount: 100, currency: 'USD', updated_at: '2026-08-01', channel: 'ibkr' },
      portfolio: {
        'AAPL@ibkr': { avg_price: 10, units: 5, channel: 'ibkr' },
        'MSFT@ibkr': { avg_price: 20, units: 2, channel: 'ibkr' },
      },
    });
    startRecon(state, { as_of: '2026-08-28' });
    sourceReconPaste(state, 'ibkr', {
      cash: [{ currency: 'USD', amount: 100 }],
      lots: [
        { ticker: 'AAPL', units: 5, avg_price: 10 },
        { ticker: 'MSFT', units: 3, avg_price: 20 },
      ],
      deposits: [],
    });
    const view = getRecon(state);
    expect(view.next).toBe('decide');
    const open = view.open_lines;
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe('lot');
    expect(open[0].id).toMatch(/MSFT/);
    decideReconLine(state, open[0].id, 'take');
    await applyReconChannel(state, 'ibkr');
    expect(state.portfolio?.['MSFT@ibkr']?.units).toBe(3);
    expect(state.portfolio?.['AAPL@ibkr']?.units).toBe(5);
    expect(getRecon(state).sleeves[0].status).toBe('applied');
    expect(getRecon(state).status).toBe('done');
  });

  it('identical snapshot auto-applies the sleeve', () => {
    const state = investor({
      cash: { amount: 50, currency: 'USD', updated_at: '2026-08-01', channel: 'ocbc' },
    });
    startRecon(state, { as_of: '2026-08-28' });
    sourceReconPaste(state, 'ocbc', {
      cash: [{ currency: 'USD', amount: 50 }],
      lots: [],
      deposits: [],
    });
    expect(getRecon(state).sleeves[0].status).toBe('applied');
    expect(getRecon(state).status).toBe('done');
    expect(getRecon(state).next).toBe('done');
  });

  it('cash take without books of record fails before mutating lots', async () => {
    const state = investor({
      cash: { amount: 50, currency: 'USD', updated_at: '2026-08-01', channel: 'ocbc' },
      portfolio: { 'AAPL@ocbc': { avg_price: 10, units: 1, channel: 'ocbc' } },
    });
    startRecon(state, { as_of: '2026-08-28' });
    sourceReconPaste(state, 'ocbc', {
      cash: [{ currency: 'USD', amount: 80 }],
      lots: [{ ticker: 'AAPL', units: 1, avg_price: 10 }],
      deposits: [],
    });
    const cashLine = getRecon(state).open_lines.find((l) => l.kind === 'cash');
    expect(cashLine).toBeTruthy();
    decideReconLine(state, cashLine!.id, 'take');
    await expect(applyReconChannel(state, 'ocbc')).rejects.toThrow(
      /INVAGE_BOOKS_DATABASE_URL|Books of record/,
    );
    expect(state.portfolio?.['AAPL@ocbc']?.units).toBe(1);
  });

  it('refuses to remount source after the sleeve is applied', () => {
    const state = investor({
      cash: { amount: 50, currency: 'USD', updated_at: '2026-08-01', channel: 'ocbc' },
    });
    startRecon(state, { as_of: '2026-08-28' });
    sourceReconPaste(state, 'ocbc', {
      cash: [{ currency: 'USD', amount: 50 }],
      lots: [],
      deposits: [],
    });
    expect(() =>
      sourceReconPaste(state, 'ocbc', {
        cash: [{ currency: 'USD', amount: 50 }],
        lots: [],
        deposits: [],
      }),
    ).toThrow(/applied/);
  });
});

describe('recon tools', () => {
  it('start_recon then get_recon through the Bookkeeper tools', async () => {
    const state = investor({
      user: { id: 'de519d1a-d3a7-4a9d-a941-d1520b7a6174', slug: 'recon-tool', created_at: '2026-01-01' },
      cash: { amount: 10, currency: 'USD', updated_at: '2026-08-01', channel: 'ibkr' },
    });
    await createState(state);
    const tools = createReconTools();
    const start = tools.find((t) => t.name === 'start_recon');
    const get = tools.find((t) => t.name === 'get_recon');
    expect(start && get).toBeTruthy();
    const started = await start!.execute('1', {
      user_slug: 'recon-tool',
      as_of: '2026-08-28',
    });
    expect(started.details).toMatchObject({ status: 'in_progress', next: 'source' });
    const got = await get!.execute('2', { user_slug: 'recon-tool' });
    expect(got.details).toMatchObject({ current_channel: 'ibkr', next: 'source' });
  });
});
