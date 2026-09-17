import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getBrokerAdapter } from '../src/brokers/adapter.js';
import { normalizePem } from '../src/brokers/pem.js';
import { yahooSymbolFromBroker } from '../src/brokers/yahoo-symbol.js';
import { BrokerParseError } from '../src/brokers/errors.js';
import { shanghaiTimestamp, signTigerRequest, tigerSignContent } from '../src/tiger/tiger-sign.js';
import { TIGER_PUBLIC_KEY_PEM, SANDBOX_TIGER_PUBLIC_KEY_PEM } from '../src/tiger/tiger-keys.js';
import { fetchTigerRawBundle } from '../src/tiger/tiger-client.js';
import { mapTigerBundleToStatement, positionItems } from '../src/tiger/tiger-map.js';
import type { TigerRawBundle } from '../src/tiger/tiger-types.js';
import { createBookkeeperTools } from '../src/tools/index.js';

const FIX = join(process.cwd(), 'tests/fixtures/tiger');
const PRIVATE = readFileSync(join(FIX, 'test-private.pem'), 'utf8');
const SIGN_STRING = readFileSync(join(FIX, 'sign-string.txt'), 'utf8').trim();
const EXPECTED_SIGN = readFileSync(join(FIX, 'expected-sign.txt'), 'utf8').trim();
const POSITIONS = JSON.parse(readFileSync(join(FIX, 'positions-stk-opt.json'), 'utf8')) as {
  data: unknown;
};
const PRIME = JSON.parse(readFileSync(join(FIX, 'prime-assets.json'), 'utf8'));

describe('yahooSymbolFromBroker', () => {
  it('maps US/HK/SG/AU/JP and skips CN', () => {
    expect(yahooSymbolFromBroker({ market: 'US', symbol: 'AAPL' })).toBe('AAPL');
    expect(yahooSymbolFromBroker({ market: 'HK', symbol: '700' })).toBe('0700.HK');
    expect(yahooSymbolFromBroker({ market: 'SEHK', symbol: '00700' })).toBe('0700.HK');
    expect(yahooSymbolFromBroker({ market: 'SG', symbol: 'D05' })).toBe('D05.SI');
    expect(yahooSymbolFromBroker({ market: 'AU', symbol: 'BHP' })).toBe('BHP.AX');
    expect(yahooSymbolFromBroker({ market: 'JP', symbol: '9984' })).toBe('9984.T');
    expect(yahooSymbolFromBroker({ market: 'CN', symbol: '600519' })).toEqual({
      skip: 'market CN is not imported',
    });
  });
});

describe('Tiger signing', () => {
  it('formats timestamps in Asia/Shanghai without offset', () => {
    const ts = shanghaiTimestamp(new Date('2026-09-17T02:00:00.000Z'));
    expect(ts).toBe('2026-09-17 10:00:00');
    expect(ts).not.toMatch(/Z|[+-]\d{2}:\d{2}/);
  });

  it('matches the golden sign-string and RSA-SHA1 signature', () => {
    const params: Record<string, string> = {
      biz_content: '{"account":"123456"}',
      charset: 'UTF-8',
      method: 'accounts',
      sign_type: 'RSA',
      tiger_id: '20150000',
      timestamp: '2026-09-17 10:00:00',
      version: '1.0',
    };
    expect(tigerSignContent(params)).toBe(SIGN_STRING);
    expect(signTigerRequest(params, PRIVATE)).toBe(EXPECTED_SIGN);
  });

  it('pins official prod vs sandbox public keys', () => {
    expect(TIGER_PUBLIC_KEY_PEM).toContain(
      readFileSync(join(FIX, 'prod-public.pem'), 'utf8').replace(/-----[^-]+-----|\s/g, '').slice(0, 32),
    );
    expect(SANDBOX_TIGER_PUBLIC_KEY_PEM).toContain(
      readFileSync(join(FIX, 'sandbox-public.pem'), 'utf8').replace(/-----[^-]+-----|\s/g, '').slice(0, 32),
    );
    expect(TIGER_PUBLIC_KEY_PEM).not.toBe(SANDBOX_TIGER_PUBLIC_KEY_PEM);
  });
});

describe('PEM normalize', () => {
  it('accepts PKCS#8 and escaped newlines', () => {
    const escaped = PRIVATE.trim().replace(/\n/g, '\\n');
    expect(normalizePem(escaped)).toContain('BEGIN');
    const b64 = PRIVATE.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    expect(normalizePem(b64)).toContain('BEGIN');
  });
});

function emptyPositions() {
  return { code: 0, message: 'success', data: { items: [] } };
}

function bundle(over: Partial<TigerRawBundle> = {}): TigerRawBundle {
  return {
    schema: 'invage.tiger.raw.v1',
    fetched_at: '2026-09-17T02:15:00.000Z',
    gateway: 'https://openapi.tigerfintech.com/hkg/gateway',
    account: '1234567',
    license: 'TBSG',
    account_kind: 'prime',
    managed_accounts: null,
    assets: { method: 'prime_assets', envelope: PRIME },
    positions: {
      STK: { code: 0, data: { items: (POSITIONS.data as { items: unknown[] }).items.filter((i) => (i as { secType: string }).secType === 'STK') } },
      OPT: { code: 0, data: { items: (POSITIONS.data as { items: unknown[] }).items.filter((i) => (i as { secType: string }).secType === 'OPT') } },
      FUND: emptyPositions(),
    },
    ...over,
  };
}

describe('Tiger position mapping', () => {
  it('reads flat data.items and imports short OPT', () => {
    const stmt = mapTigerBundleToStatement(bundle(), 'tiger');
    expect(stmt.account_id).toBe('1234567');
    expect(stmt.as_of).toBe('2026-09-17');
    expect(stmt.lots.map((l) => l.ticker)).toEqual(['AAPL', 'AAPL-P-230-20260116-S']);
    const opt = stmt.lots[1]!.holding;
    expect(opt.instrument).toBe('option');
    expect(opt.option?.side).toBe('short');
    expect(opt.option?.mark).toBe(210);
    expect(opt.option?.settlement).toBe('physical');
    expect(stmt.cash).toEqual([
      { currency: 'USD', amount: 123844.77 },
      { currency: 'SGD', amount: 0 },
    ]);
    expect(stmt.skipped.some((s) => s.currency === 'HKD')).toBe(true);
    expect(stmt.metrics?.buying_power).toBe(495623.1);
    expect(stmt.metrics?.excess_liquidity).toBe(125259.83);
    expect(stmt.cash.find((c) => c.amount === 5000)).toBeUndefined();
  });

  it('skips OPT without underlyingSymbol', () => {
    const stmt = mapTigerBundleToStatement(
      bundle({
        positions: {
          STK: emptyPositions(),
          OPT: {
            code: 0,
            data: {
              items: [
                {
                  symbol: 'AAPL  260116P00230000',
                  secType: 'OPT',
                  market: 'US',
                  currency: 'USD',
                  positionQty: 1,
                  averageCost: 1,
                  latestPrice: 2,
                  multiplier: 100,
                  expiry: '20260116',
                  strike: 230,
                  right: 'PUT',
                },
              ],
            },
          },
          FUND: emptyPositions(),
        },
      }),
      'tiger',
    );
    expect(stmt.lots).toEqual([]);
    expect(stmt.skipped[0]?.reason).toMatch(/underlying/);
  });

  it('pads HK symbols and skips duplicate map keys', () => {
    const stmt = mapTigerBundleToStatement(
      bundle({
        positions: {
          STK: {
            code: 0,
            data: {
              items: [
                { symbol: '700', secType: 'STK', market: 'HK', currency: 'HKD', positionQty: 100, averageCost: 300 },
                { symbol: '00700', secType: 'STK', market: 'HK', currency: 'HKD', positionQty: 50, averageCost: 310 },
              ],
            },
          },
          OPT: emptyPositions(),
          FUND: emptyPositions(),
        },
      }),
      'tiger',
    );
    expect(stmt.lots.map((l) => l.ticker)).toEqual(['0700.HK']);
    expect(stmt.skipped.some((s) => s.reason === 'duplicate map key')).toBe(true);
  });

  it('reads nested contract.* as a fallback', () => {
    expect(
      positionItems({
        items: [{ contract: { symbol: 'MSFT' }, positionQty: 1, averageCost: 1, secType: 'STK', currency: 'USD', market: 'US' }],
      }).length,
    ).toBe(1);
    const stmt = mapTigerBundleToStatement(
      bundle({
        positions: {
          STK: {
            code: 0,
            data: {
              items: [
                {
                  contract: { symbol: 'MSFT', secType: 'STK', market: 'US', currency: 'USD' },
                  positionQty: 2,
                  averageCost: 300,
                },
              ],
            },
          },
          OPT: emptyPositions(),
          FUND: emptyPositions(),
        },
      }),
      'tiger',
    );
    expect(stmt.lots[0]?.ticker).toBe('MSFT');
  });
});

describe('Tiger fetchRaw', () => {
  it('TBHK without token fails before HTTP', async () => {
    await expect(
      fetchTigerRawBundle({
        tiger_id: '1',
        account: '123',
        license: 'TBHK',
        private_key: PRIVATE,
      }),
    ).rejects.toBeInstanceOf(BrokerParseError);
  });

  it('skips OPT/FUND non-zero code and still maps STK+cash', async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      const href = String(url);
      if (href.includes('play-analytics')) {
        return new Response('no', { status: 500 });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { method: string; biz_content: string };
      if (body.method === 'accounts') {
        return Response.json({ code: 1, message: 'nope', data: [] });
      }
      if (body.method === 'prime_assets') {
        return Response.json(PRIME);
      }
      const biz = JSON.parse(body.biz_content) as { sec_type?: string };
      if (body.method === 'positions' && biz.sec_type === 'STK') {
        return Response.json({
          code: 0,
          data: { items: (POSITIONS.data as { items: unknown[] }).items.filter((i) => (i as { secType: string }).secType === 'STK') },
        });
      }
      return Response.json({ code: 11, message: 'unsupported', data: null });
    };
    const raw = await fetchTigerRawBundle(
      { tiger_id: '20150000', account: '1234567', license: 'TBSG', private_key: PRIVATE },
      { fetchImpl, gateway: 'https://openapi.tigerfintech.com/hkg/gateway' },
    );
    expect(raw.positions.STK.code).toBe(0);
    expect(raw.positions.OPT.data).toEqual({ items: [] });
    const stmt = mapTigerBundleToStatement(raw, 'tiger');
    expect(stmt.lots.map((l) => l.ticker)).toEqual(['AAPL']);
    expect(stmt.cash.some((c) => c.currency === 'USD')).toBe(true);
  });
});

describe('adapter registry', () => {
  it('registers tiger with usesCsvTables false', () => {
    const ad = getBrokerAdapter('tiger');
    expect(ad.usesCsvTables).toBe(false);
  });

  it('src/tiger has no trade method names', () => {
    const dir = join(process.cwd(), 'src/tiger');
    const blob = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    expect(blob).not.toMatch(/place_order|cancel_order|modify_order|preview_order/);
  });
});

describe('tools', () => {
  it('registers configure_broker and sync_broker', () => {
    const names = createBookkeeperTools().map((t) => t.name);
    expect(names).toContain('configure_broker');
    expect(names).toContain('sync_broker');
  });
});
