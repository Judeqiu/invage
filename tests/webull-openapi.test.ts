import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getBrokerAdapter } from '../src/brokers/adapter.js';
import { getBrokerConnector } from '../src/brokers/catalog.js';
import { BrokerParseError } from '../src/brokers/errors.js';
import { fetchWebullRawBundle, parseWebullRegion } from '../src/webull/webull-client.js';
import { mapWebullBundleToStatement, marketForWebullSymbol } from '../src/webull/webull-map.js';
import { rfc3986Encode, signWebullRequest, webullSignContent } from '../src/webull/webull-sign.js';
import type { WebullRawBundle } from '../src/webull/webull-types.js';

const FIX = join(process.cwd(), 'tests/fixtures/webull');
const ACCOUNTS = JSON.parse(readFileSync(join(FIX, 'accounts.json'), 'utf8')) as unknown;
const BALANCES = JSON.parse(readFileSync(join(FIX, 'balances.json'), 'utf8')) as unknown;
const POSITIONS = JSON.parse(readFileSync(join(FIX, 'positions.json'), 'utf8')) as unknown;

describe('Webull signing', () => {
  it('builds the official path+sorted params string and HMAC-SHA256 with secret&', () => {
    const encoded = webullSignContent({
      path: '/trading/accounts/list',
      query: {},
      host: 'api.webull.com',
      appKey: '776da210ab4a452795d74e726ebd74b6',
      timestamp: '2022-01-04T03:55:31Z',
      nonce: '48ef5afed43d4d91ae514aaeafbc29ba',
    });
    const raw =
      '/trading/accounts/list&host=api.webull.com&x-app-key=776da210ab4a452795d74e726ebd74b6&x-signature-algorithm=HMAC-SHA256&x-signature-nonce=48ef5afed43d4d91ae514aaeafbc29ba&x-signature-version=1.0&x-timestamp=2022-01-04T03:55:31Z';
    expect(encoded).toBe(rfc3986Encode(raw));
    const sig = signWebullRequest(encoded, '0f50a2e853334a9aae1a783bee120c1f');
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(sig, 'base64').length).toBe(32);
  });

  it('parses region ids', () => {
    expect(parseWebullRegion('US')).toBe('us');
    expect(parseWebullRegion('sg')).toBe('sg');
    expect(() => parseWebullRegion('cn')).toThrow(/region/);
  });
});

function bundle(over: Partial<WebullRawBundle> = {}): WebullRawBundle {
  return {
    schema: 'invage.webull.raw.v1',
    fetched_at: '2026-09-17T02:15:00.000Z',
    region: 'us',
    host: 'api.webull.com',
    account_id: 'LOJOQITOD49R6G9BPQM489CISA',
    accounts: ACCOUNTS,
    balances: BALANCES,
    positions: POSITIONS,
    ...over,
  };
}

describe('Webull mapping', () => {
  it('books per-ISO cash (skip negatives, keep zeros) and long equities', () => {
    const stmt = mapWebullBundleToStatement(bundle(), 'webull');
    expect(stmt.account_id).toBe('LOJOQITOD49R6G9BPQM489CISA');
    expect(stmt.as_of).toBe('2026-09-17');
    expect(stmt.cash).toEqual([
      { currency: 'USD', amount: 7000 },
      { currency: 'HKD', amount: 0 },
    ]);
    expect(stmt.skipped.some((s) => s.currency === 'CNH')).toBe(true);
    expect(stmt.lots.map((l) => l.ticker)).toEqual(['AAPL', '0700.HK']);
    expect(stmt.lots[0]?.holding.broker_ref?.native_id).toBe('POS-AAPL');
    expect(stmt.skipped.some((s) => s.symbol === 'TSLA')).toBe(true);
    expect(stmt.skipped.some((s) => s.reason === 'option lots are not imported')).toBe(true);
    expect(stmt.metrics?.buying_power).toBe(12500);
    expect(stmt.metrics?.currency).toBe('USD');
  });

  it('does not book total_cash_balance', () => {
    const stmt = mapWebullBundleToStatement(bundle(), 'webull');
    expect(stmt.cash.reduce((n, c) => n + c.amount, 0)).toBe(7000);
  });

  it('maps HK numeric tickers and skips unmapped currencies', () => {
    expect(marketForWebullSymbol({ symbol: '700', region: 'us', currency: 'HKD' })).toBe('HK');
    expect(marketForWebullSymbol({ symbol: 'AAPL', region: 'us', currency: 'USD' })).toBe('US');
    expect(marketForWebullSymbol({ symbol: 'VOD', region: 'uk', currency: 'GBP' })).toEqual({
      skip: 'currency GBP is not mapped for region uk',
    });
  });
});

describe('Webull fetchRaw', () => {
  function mockFetch(): typeof fetch {
    return async (url) => {
      const href = String(url);
      expect(href).toMatch(/^https:\/\/api\.webull\.com\//);
      if (href.includes('/trading/accounts/list')) return Response.json(ACCOUNTS);
      if (href.includes('/trading/assets/balances/get')) {
        expect(href).toContain('account_id=LOJOQITOD49R6G9BPQM489CISA');
        return Response.json(BALANCES);
      }
      if (href.includes('/trading/assets/positions/list')) return Response.json(POSITIONS);
      throw new Error(`unexpected ${href}`);
    };
  }

  it('uses the unique account_id', async () => {
    const raw = await fetchWebullRawBundle(
      { app_key: 'ak', app_secret: 'sk', region: 'us' },
      { fetchImpl: mockFetch() },
    );
    expect(raw.account_id).toBe('LOJOQITOD49R6G9BPQM489CISA');
    expect(raw.schema).toBe('invage.webull.raw.v1');
    expect(raw.host).toBe('api.webull.com');
  });

  it('fails when multiple accounts and account_id is omitted', async () => {
    const two = [
      { account_id: '1', account_class: 'INDIVIDUAL_CASH' },
      { account_id: '2', account_class: 'INDIVIDUAL_MARGIN' },
    ];
    await expect(
      fetchWebullRawBundle(
        { app_key: 'ak', app_secret: 'sk', region: 'us' },
        {
          fetchImpl: async (url) => {
            if (String(url).includes('/trading/accounts/list')) return Response.json(two);
            throw new Error(String(url));
          },
        },
      ),
    ).rejects.toThrow(/paste account_id/);
  });

  it('hints to paste access_token on 401', async () => {
    await expect(
      fetchWebullRawBundle(
        { app_key: 'ak', app_secret: 'sk', region: 'us' },
        {
          fetchImpl: async () =>
            new Response(JSON.stringify({ error_code: 'UNAUTHORIZED', message: 'token required' }), {
              status: 401,
            }),
        },
      ),
    ).rejects.toThrow(/access token/);
  });

  it('throws BrokerParseError on bad schema', () => {
    expect(() =>
      mapWebullBundleToStatement({ ...bundle(), schema: 'nope' } as WebullRawBundle, 'webull'),
    ).toThrow(BrokerParseError);
  });
});

describe('adapter + catalog', () => {
  it('registers webull without csv_tables', () => {
    expect(getBrokerConnector('webull').displayName).toBe('Webull');
    expect(getBrokerAdapter('webull').usesCsvTables).toBe(false);
  });

  it('src/webull has no trade method names', () => {
    const dir = join(process.cwd(), 'src/webull');
    const blob = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    expect(blob).not.toMatch(/place_order|cancel_order|modify_order|preview_order/);
  });
});
