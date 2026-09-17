import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getBrokerAdapter } from '../src/brokers/adapter.js';
import { getBrokerConnector } from '../src/brokers/catalog.js';
import { BrokerParseError } from '../src/brokers/errors.js';
import { fetchMooMooRawBundle } from '../src/moomoo/moomoo-client.js';
import { looksLikeOptionCode, mapMooMooBundleToStatement } from '../src/moomoo/moomoo-map.js';
import { moomooSignContent, parseSignAlg, signMooMooRequest } from '../src/moomoo/moomoo-sign.js';
import type { MooMooEnvelope, MooMooRawBundle } from '../src/moomoo/moomoo-types.js';
import { sourceReconConnector } from '../src/recon/index.js';
import type { InvestorState } from '../src/state/portfolio-state.js';

const FIX = join(process.cwd(), 'tests/fixtures/moomoo');
const ED = readFileSync(join(FIX, 'ed25519-private.pem'), 'utf8');
const AUTHORIZED = JSON.parse(readFileSync(join(FIX, 'authorized.json'), 'utf8')) as MooMooEnvelope;
const FUNDS = JSON.parse(readFileSync(join(FIX, 'funds.json'), 'utf8')) as MooMooEnvelope;
const POSITIONS = JSON.parse(readFileSync(join(FIX, 'positions.json'), 'utf8')) as MooMooEnvelope;

describe('MooMoo signing', () => {
  it('pins the official 5-field signing string (empty body_part + trailing newline)', () => {
    expect(
      moomooSignContent({
        timestampMs: '1782357937000',
        method: 'GET',
        path: '/api/v1.0/quote/trading-days',
        query: 'market=HK&start=2025-12-22&end=2025-12-26',
        body: undefined,
      }),
    ).toBe(
      '1782357937000\nGET\n/api/v1.0/quote/trading-days\nmarket=HK&start=2025-12-22&end=2025-12-26\n',
    );
  });

  it('Ed25519-signs the string and defaults sign_alg', () => {
    expect(parseSignAlg(undefined)).toBe('Ed25519');
    const content = moomooSignContent({
      timestampMs: '1782357937000',
      method: 'GET',
      path: '/api/v1.0/accounts/authorized_trd_accs',
      query: '',
      body: undefined,
    });
    const sig = signMooMooRequest(content, ED, 'Ed25519');
    expect(sig.length).toBeGreaterThan(40);
    expect(() => Buffer.from(sig, 'base64')).not.toThrow();
  });
});

function bundle(over: Partial<MooMooRawBundle> = {}): MooMooRawBundle {
  return {
    schema: 'invage.moomoo.raw.v1',
    fetched_at: '2026-09-17T02:15:00.000Z',
    acc_id: '281756420273981734',
    authorized: AUTHORIZED,
    funds: FUNDS,
    positions: POSITIONS,
    ...over,
  };
}

describe('MooMoo mapping', () => {
  it('books per-ISO cash (skip negatives, keep zeros) and long equities', () => {
    const stmt = mapMooMooBundleToStatement(bundle(), 'moomoo');
    expect(stmt.account_id).toBe('281756420273981734');
    expect(stmt.as_of).toBe('2026-09-17');
    expect(stmt.cash).toEqual([
      { currency: 'USD', amount: 7000 },
      { currency: 'HKD', amount: 0 },
      { currency: 'JPY', amount: 0 },
      { currency: 'SGD', amount: 0 },
      { currency: 'KRW', amount: 0 },
    ]);
    expect(stmt.skipped.some((s) => s.currency === 'CNH')).toBe(true);
    expect(stmt.lots.map((l) => l.ticker)).toEqual(['AAPL', '0700.HK']);
    expect(stmt.skipped.some((s) => s.symbol === 'US.TSLA')).toBe(true);
    expect(stmt.skipped.some((s) => s.reason === 'option code not mapped')).toBe(true);
    expect(stmt.metrics?.buying_power).toBe(12500);
    expect(stmt.metrics?.currency).toBe('USD');
  });

  it('detects option codes without treating HK.00700 as an option', () => {
    expect(looksLikeOptionCode('TCH260629C390000')).toBe(true);
    expect(looksLikeOptionCode('00700')).toBe(false);
    expect(looksLikeOptionCode('AAPL')).toBe(false);
  });
});

describe('MooMoo fetchRaw', () => {
  function mockFetch(envelopes: Record<string, unknown>, opts?: { skewOnce?: boolean }): typeof fetch {
    let skewed = false;
    return async (url) => {
      const href = String(url);
      expect(href).toMatch(/^https:\/\/webapi\.moomoo\.com\//);
      if (href.endsWith('/api/v1.0/server-time')) {
        return Response.json({ server_time_ms: '1782971427455' });
      }
      if (opts?.skewOnce && !skewed && href.includes('authorized_trd_accs')) {
        skewed = true;
        return Response.json({ s: 'error', errcode: -12006, errmsg: 'clock skew' });
      }
      if (href.includes('authorized_trd_accs')) return Response.json(envelopes.authorized);
      if (href.includes('/funds')) {
        expect(href).toContain('currency=USD');
        return Response.json(envelopes.funds);
      }
      if (href.includes('/positions')) return Response.json(envelopes.positions);
      throw new Error(`unexpected ${href}`);
    };
  }

  it('uses the unique authorized acc_id and requires funds?currency=USD', async () => {
    const raw = await fetchMooMooRawBundle(
      { app_key: 'ak', private_key: ED, sign_alg: 'Ed25519' },
      { fetchImpl: mockFetch({ authorized: AUTHORIZED, funds: FUNDS, positions: POSITIONS }) },
    );
    expect(raw.acc_id).toBe('281756420273981734');
    expect(raw.schema).toBe('invage.moomoo.raw.v1');
  });

  it('fails when multiple accounts and acc_id is omitted', async () => {
    const two = {
      s: 'ok',
      d: {
        accounts: [
          { account_id: '1', security_firm: 'FUTUSG' },
          { account_id: '2', security_firm: 'FUTUSG' },
        ],
      },
    };
    await expect(
      fetchMooMooRawBundle(
        { app_key: 'ak', private_key: ED, sign_alg: 'Ed25519' },
        { fetchImpl: mockFetch({ authorized: two, funds: FUNDS, positions: POSITIONS }) },
      ),
    ).rejects.toThrow(/paste acc_id/);
  });

  it('retries once on clock skew -12006', async () => {
    const raw = await fetchMooMooRawBundle(
      { app_key: 'ak', private_key: ED, sign_alg: 'Ed25519' },
      {
        fetchImpl: mockFetch(
          { authorized: AUTHORIZED, funds: FUNDS, positions: POSITIONS },
          { skewOnce: true },
        ),
      },
    );
    expect(raw.acc_id).toBe('281756420273981734');
  });

  it('throws BrokerParseError on bad schema', () => {
    expect(() =>
      mapMooMooBundleToStatement({ ...bundle(), schema: 'nope' } as MooMooRawBundle, 'moomoo'),
    ).toThrow(BrokerParseError);
  });
});

describe('adapter + catalog', () => {
  it('registers moomoo without csv_tables', () => {
    expect(getBrokerConnector('moomoo').displayName).toBe('MooMoo');
    expect(getBrokerAdapter('moomoo').usesCsvTables).toBe(false);
    expect(getBrokerAdapter('tiger').usesCsvTables).toBe(false);
    expect(getBrokerAdapter('ibkr').usesCsvTables).toBe(true);
  });

  it('src/moomoo has no trade method names', () => {
    const dir = join(process.cwd(), 'src/moomoo');
    const blob = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    expect(blob).not.toMatch(/place_order|unlock_trade|trade:write/);
  });
});

describe('jude_futu recon copy', () => {
  it('does not treat jude_futu as the moomoo connector', async () => {
    const state: InvestorState = {
      user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' },
      profile: { display_name: 'Alice', contact_email: 'a@example.com' },
      log: [],
      recon: {
        as_of: '2026-09-17',
        status: 'in_progress',
        current_channel: 'jude_futu',
        sleeves: [{ channel: 'jude_futu', status: 'pending' }],
      },
    };
    await expect(sourceReconConnector(state, 'jude_futu')).rejects.toThrow(/never reads jude_futu/);
  });
});
