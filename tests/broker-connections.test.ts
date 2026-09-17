import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertCatalogChannelEqualsId,
  assertIbkrChannelMatchesCatalog,
  getBrokerConnector,
} from '../src/brokers/catalog.js';
import { adapters, getBrokerAdapter } from '../src/brokers/adapter.js';
import {
  ChannelOffError,
  patchBrokerConnection,
  publicCatalog,
  readBrokerConnections,
  resolveConnectionForSync,
} from '../src/brokers/connections.js';
import { assertCsvTablesSpec } from '../src/brokers/csv-tables.js';
import { saveBrokerParserSpec } from '../src/brokers/parser-store.js';
import { readRecon, sourceReconConnector, startRecon } from '../src/recon/index.js';
import { readFlexEgressIpv4 } from '../src/brokers/egress.js';
import { IBKR_CHANNEL } from '../src/ibkr/flex-map.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { createInvageWebUi } from '../src/webapp/invage-webui.js';

const TOKEN = 'SECRETTOKEN9999';

function investor(over: Partial<InvestorState> = {}): InvestorState {
  return {
    user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' },
    log: [],
    ...over,
  };
}

describe('broker catalog', () => {
  it('IBKR channel id matches lot tag', () => {
    assertIbkrChannelMatchesCatalog();
    assertCatalogChannelEqualsId();
    expect(getBrokerConnector('ibkr').channel).toBe(IBKR_CHANNEL);
    expect(getBrokerConnector('tiger').channel).toBe('tiger');
    expect(getBrokerConnector('tiger').displayName).toBe('Tiger Brokers');
    expect(getBrokerConnector('moomoo').displayName).toBe('MooMoo');
    expect(getBrokerConnector('moomoo').channel).toBe('moomoo');
  });

  it('unknown id fails', () => {
    expect(() => getBrokerConnector('not-a-connector')).toThrow(/Unknown broker connector/);
  });
});

describe('readFlexEgressIpv4', () => {
  it('unset and empty are null', () => {
    expect(readFlexEgressIpv4({})).toBeNull();
    expect(readFlexEgressIpv4({ INVAGE_FLEX_EGRESS_IPV4: '  ' })).toBeNull();
  });

  it('accepts a dotted quad', () => {
    expect(readFlexEgressIpv4({ INVAGE_FLEX_EGRESS_IPV4: '203.0.113.10' })).toBe(
      '203.0.113.10',
    );
  });

  it('throws on a non-IPv4 value', () => {
    expect(() => readFlexEgressIpv4({ INVAGE_FLEX_EGRESS_IPV4: 'localhost' })).toThrow(
      /INVAGE_FLEX_EGRESS_IPV4/,
    );
  });
});

describe('broker_connections store', () => {
  it('never-configured IBKR is off, not needs_credentials', () => {
    const views = publicCatalog(investor());
    expect(views).toHaveLength(3);
    const ibkr = views.find((v) => v.id === 'ibkr');
    expect(ibkr).toMatchObject({
      id: 'ibkr',
      enabled: false,
      status: 'off',
      last_sync: null,
    });
    expect(ibkr!.ip_whitelist_help).toBe(true);
    expect(ibkr!.help_href_label).toBe('Flex Web Service docs');
    expect(ibkr!.credential_fields.map((f) => f.id)).toEqual([
      'token',
      'activity_query_id',
      'tradeconf_query_id',
    ]);
  });

  it('maps legacy ibkr_flex in memory with enabled true', () => {
    const state = investor({
      ibkr_flex: { token: TOKEN, activity_query_id: '111222' },
    } as InvestorState);
    const map = readBrokerConnections(state);
    expect(map.ibkr.enabled).toBe(true);
    expect(map.ibkr.credentials.token).toBe(TOKEN);
    const json = JSON.stringify(publicCatalog(state));
    expect(json).not.toContain(TOKEN);
    expect(json).toContain('"last4":"9999"');
    expect(publicCatalog(state).find((v) => v.id === 'ibkr')?.status).toBe('connected');
  });

  it('throws if both keys exist', () => {
    const state = investor({
      broker_connections: {
        ibkr: { enabled: false, credentials: {} },
      },
      ibkr_flex: { token: TOKEN, activity_query_id: '1' },
    } as InvestorState);
    expect(() => readBrokerConnections(state)).toThrow(/Conflicting IBKR config/);
  });

  it('throws on unknown connector keys', () => {
    const state = investor({
      broker_connections: { webull: { enabled: false, credentials: {} } },
    });
    expect(() => readBrokerConnections(state)).toThrow(
      /Unknown broker connector "webull" in broker_connections/,
    );
  });

  it('enabled without token is needs_credentials', () => {
    const state = investor();
    expect(() =>
      patchBrokerConnection(state, 'ibkr', { enabled: true }),
    ).toThrow(/Flex Web Service token is required/);
    state.broker_connections = {
      ibkr: { enabled: true, credentials: { activity_query_id: '123456' } },
    };
    expect(publicCatalog(state).find((v) => v.id === 'ibkr')?.status).toBe('needs_credentials');
  });

  it('PATCH {} is a no-op and does not persist a row', () => {
    const state = investor();
    const r = patchBrokerConnection(state, 'ibkr', {});
    expect(r.persisted).toBe(false);
    expect(state.broker_connections).toBeUndefined();
  });

  it('omitted secret keeps stored token; empty string is rejected', () => {
    const state = investor();
    patchBrokerConnection(state, 'ibkr', {
      enabled: true,
      credentials: { token: TOKEN, activity_query_id: '111' },
    });
    const keep = patchBrokerConnection(state, 'ibkr', {
      credentials: { activity_query_id: '222' },
    });
    expect(keep.view.credentials.token).toEqual({ configured: true, last4: '9999' });
    expect(readBrokerConnections(state).ibkr.credentials.token).toBe(TOKEN);
    expect(() =>
      patchBrokerConnection(state, 'ibkr', { credentials: { token: '' } }),
    ).toThrow(/non-empty/);
  });

  it('disable does not drop credentials or require them', () => {
    const state = investor();
    patchBrokerConnection(state, 'ibkr', {
      enabled: true,
      credentials: { token: TOKEN, activity_query_id: '111' },
    });
    const off = patchBrokerConnection(state, 'ibkr', { enabled: false });
    expect(off.view.status).toBe('off');
    expect(readBrokerConnections(state).ibkr.credentials.token).toBe(TOKEN);
    expect(() => resolveConnectionForSync(state, 'ibkr')).toThrow(ChannelOffError);
    expect(() => resolveConnectionForSync(state, 'ibkr')).toThrow(
      /Interactive Brokers channel is off\. Enable it in Settings before sync\./,
    );
  });

  it('short token is configured without last4', () => {
    const state = investor();
    patchBrokerConnection(state, 'ibkr', {
      enabled: true,
      credentials: { token: 'abc', activity_query_id: '1' },
    });
    const view = publicCatalog(state).find((v) => v.id === 'ibkr');
    expect(view?.credentials.token).toEqual({ configured: true });
  });

  it('reads existing connection YAML without metrics or extras', () => {
    const state = investor({
      broker_connections: {
        ibkr: {
          enabled: true,
          credentials: { token: TOKEN, activity_query_id: '1612545' },
          last_sync: {
            at: '2026-08-22T04:12:00.000Z',
            ok: true,
            as_of: '2026-08-21',
            account_id: 'U20877136',
            lots_upserted: 0,
            lots_removed: 0,
          },
        },
      },
    });
    const conn = readBrokerConnections(state).ibkr;
    expect(conn.enabled).toBe(true);
    expect(conn.metrics).toBeUndefined();
    expect(conn.last_sync?.account_id).toBe('U20877136');
    expect(publicCatalog(state).find((v) => v.id === 'ibkr')?.status).toBe('connected');
  });

  it('parses and preserves optional metrics; rejects unknown keys', () => {
    const state = investor({
      broker_connections: {
        ibkr: {
          enabled: true,
          credentials: { token: TOKEN, activity_query_id: '111' },
          metrics: {
            as_of: '2026-07-31',
            currency: 'USD',
            buying_power: 25000,
            excess_liquidity: 8000,
            maintenance_margin: 3000,
          },
        },
      },
    });
    expect(readBrokerConnections(state).ibkr.metrics).toEqual({
      as_of: '2026-07-31',
      currency: 'USD',
      buying_power: 25000,
      excess_liquidity: 8000,
      maintenance_margin: 3000,
    });
    patchBrokerConnection(state, 'ibkr', { credentials: { activity_query_id: '222' } });
    expect(readBrokerConnections(state).ibkr.metrics?.buying_power).toBe(25000);
    expect(readBrokerConnections(state).ibkr.credentials.activity_query_id).toBe('222');

    expect(() =>
      readBrokerConnections(
        investor({
          broker_connections: {
            ibkr: {
              enabled: false,
              credentials: {},
              sma: 1,
            },
          },
        } as InvestorState),
      ),
    ).toThrow(/unknown field "sma"/);
  });
});

describe('broker fetch adapter', () => {
  it('normalizes a PEM private_key on PATCH', () => {
    const pem = readFileSync(join(process.cwd(), 'tests/fixtures/tiger/test-private.pem'), 'utf8');
    const state = investor();
    patchBrokerConnection(state, 'tiger', {
      enabled: true,
      credentials: {
        tiger_id: '20150000',
        account: '1234567',
        license: 'TBSG',
        private_key: pem.trim().replace(/\n/g, '\\n'),
      },
    });
    const stored = readBrokerConnections(state).tiger.credentials.private_key;
    expect(stored).toContain('BEGIN');
    expect(stored).toContain('\n');
    expect(stored).not.toContain('\\n');
  });

  it('resolves the IBKR Flex adapter', () => {
    const ad = getBrokerAdapter('ibkr');
    expect(ad.id).toBe('ibkr');
    expect(ad.usesCsvTables).toBe(true);
    expect(adapters.ibkr).toBe(ad);
  });

  it('unknown catalog id fails like getBrokerConnector', () => {
    expect(() => getBrokerAdapter('not-a-connector')).toThrow(/Unknown broker connector/);
  });

  it('catalog id without an adapter is a programmer error', () => {
    const prev = adapters.ibkr;
    delete adapters.ibkr;
    try {
      expect(() => getBrokerAdapter('ibkr')).toThrow(/no fetch adapter/);
    } finally {
      adapters.ibkr = prev;
    }
  });

  it('recon connector fetch ignores a saved csv_tables spec', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Activity" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567" fromDate="20260811" toDate="20260817" period="Last7CalendarDays" whenGenerated="20260818;090000">
      <OpenPositions>
        <OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" listingExchange="NASDAQ" quantity="10" multiplier="1" costBasisPrice="150" costBasisMoney="1500" markPrice="190" positionValue="1900" />
      </OpenPositions>
      <CashReport>
        <CashReportCurrency accountId="U1234567" currency="USD" endingCash="100" />
      </CashReport>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;
    const spec = assertCsvTablesSpec({
      kind: 'csv_tables',
      skipCurrencies: ['BASE_SUMMARY'],
      cash: {
        headerMustInclude: ['EndingCash', 'CurrencyPrimary'],
        columns: {
          accountId: 'ClientAccountID',
          fromDate: 'FromDate',
          toDate: 'ToDate',
          currency: 'CurrencyPrimary',
          amount: 'EndingCash',
        },
      },
      positions: {
        headerMustInclude: ['Symbol', 'AssetClass'],
        columns: {
          accountId: 'ClientAccountID',
          symbol: 'Symbol',
          quantity: 'Quantity',
          currency: 'CurrencyPrimary',
          assetCategory: 'AssetClass',
          markPrice: 'MarkPrice',
          costBasisPrice: 'CostBasisPrice',
          costBasisMoney: 'CostBasisMoney',
        },
      },
    });
    const state = investor({
      cash: { amount: 100, currency: 'USD', updated_at: '2026-08-01', channel: 'ibkr' },
      portfolio: {
        'AAPL@ibkr': { avg_price: 150, units: 10, channel: 'ibkr' },
      },
      broker_connections: {
        ibkr: { enabled: true, credentials: { token: 'tok', activity_query_id: '99' } },
      },
    });
    saveBrokerParserSpec('alice', 'ibkr', spec);
    startRecon(state, { as_of: '2026-08-17' });
    await sourceReconConnector(state, 'ibkr', {
      kind: 'ibkr',
      flex: {
        get: async (path) => {
          if (path === 'SendRequest') {
            return Buffer.from(
              `<FlexStatementResponse><Status>Success</Status><ReferenceCode>ref1</ReferenceCode></FlexStatementResponse>`,
            );
          }
          return Buffer.from(xml);
        },
      },
    });
    const sleeve = readRecon(state)?.sleeves[0];
    expect(sleeve?.source).toBe('connector');
    expect(sleeve?.status).toBe('applied');
    expect(sleeve?.statement?.lots).toEqual([
      { ticker: 'AAPL', units: 10, avg_price: 150, instrument: 'equity' },
    ]);
    expect(sleeve?.statement?.cash).toEqual([{ currency: 'USD', amount: 100 }]);
  });
});

describe('createInvageWebUi brokers section', () => {
  it('registers Brokers iframe and session API', () => {
    const ui = createInvageWebUi();
    expect(ui.settingsSections).toEqual([
      {
        id: 'brokers',
        title: 'Brokers',
        description: 'Connect read-only brokerage channels',
        icon: 'landmark',
        iframeSrc: '/domain-assets/invage/settings/brokers/index.html',
        iframeHeightPx: 760,
      },
    ]);
    expect(ui.apiRouters?.length).toBe(2);
    expect(ui.nav?.some((n) => n.path === '/brokers')).toBe(true);
    expect(ui.routes?.some((r) => r.path === '/brokers' && r.iframeSrc?.includes('/brokers/'))).toBe(
      true,
    );
  });

  it('Brokers page treats Tiger and MooMoo as live catalog cards, not coming-soon', () => {
    const js = readFileSync(join(process.cwd(), 'webui/brokers/app.js'), 'utf8');
    expect(js).toMatch(/payload\.connectors/);
    expect(js).toMatch(/UPCOMING/);
    expect(js).toMatch(/Webull/);
    expect(js).not.toMatch(/name:\s*'Tiger Brokers'/);
    expect(js).not.toMatch(/name:\s*'MooMoo'/);
    const settings = readFileSync(join(process.cwd(), 'webui/settings/brokers/app.js'), 'utf8');
    expect(settings).toMatch(/payload\.connectors/);
    expect(settings).toMatch(/data-manage/);
  });

  it('GET catalog lists IBKR, Tiger Brokers, and MooMoo as live connectors', () => {
    const views = publicCatalog(investor());
    expect(views.map((v) => v.id)).toEqual(['ibkr', 'tiger', 'moomoo']);
    expect(views.map((v) => v.display_name)).toEqual([
      'Interactive Brokers',
      'Tiger Brokers',
      'MooMoo',
    ]);
    expect(views.every((v) => v.status === 'off')).toBe(true);
  });
});
