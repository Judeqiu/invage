import { describe, expect, it } from 'vitest';
import {
  assertIbkrChannelMatchesCatalog,
  getBrokerConnector,
} from '../src/brokers/catalog.js';
import {
  ChannelOffError,
  patchBrokerConnection,
  publicCatalog,
  readBrokerConnections,
  resolveConnectionForSync,
} from '../src/brokers/connections.js';
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
    expect(getBrokerConnector('ibkr').channel).toBe(IBKR_CHANNEL);
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
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      id: 'ibkr',
      enabled: false,
      status: 'off',
      last_sync: null,
    });
    expect(views[0].credential_fields.map((f) => f.id)).toEqual([
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
    expect(publicCatalog(state)[0].status).toBe('connected');
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
      broker_connections: { tiger: { enabled: false, credentials: {} } },
    });
    expect(() => readBrokerConnections(state)).toThrow(
      /Unknown broker connector "tiger" in broker_connections/,
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
    expect(publicCatalog(state)[0].status).toBe('needs_credentials');
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
    const view = publicCatalog(state)[0];
    expect(view.credentials.token).toEqual({ configured: true });
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
        iframeHeightPx: 400,
      },
    ]);
    expect(ui.apiRouters?.length).toBe(2);
    expect(ui.nav?.some((n) => n.path === '/brokers')).toBe(true);
    expect(ui.routes?.some((r) => r.path === '/brokers' && r.iframeSrc?.includes('/brokers/'))).toBe(
      true,
    );
  });
});
