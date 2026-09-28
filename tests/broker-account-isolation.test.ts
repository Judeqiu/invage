import { describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { bindDomainToolsToUser } from '../src/tools/bound-identity.js';
import { publicBrokerAccounts } from '../src/brokers/accounts.js';
import type { InvestorState } from '../src/state/portfolio-state.js';

function investor(slug: string, broker: string): InvestorState {
  return {
    user: { id: slug, slug, created_at: '2026-01-01' },
    profile: { display_name: slug, contact_email: `${slug}@example.com` },
    log: [],
    broker_connections: {
      [broker]: { enabled: true, credentials: {} },
    },
  };
}

describe('broker account isolation', () => {
  it('lists configured accounts, not the four supported catalog entries', () => {
    const alice = publicBrokerAccounts(investor('alice', 'ibkr'));
    const bob = publicBrokerAccounts(investor('bob', 'moomoo'));
    expect(alice.catalog.length).toBeGreaterThan(1);
    expect(alice.connections.map(c => c.broker_id)).toEqual(['ibkr']);
    expect(bob.connections.map(c => c.broker_id)).toEqual(['moomoo']);
  });

  it('uses authenticated identity even if model arguments name another user or channel', async () => {
    const execute = vi.fn(async (_id: string, raw: unknown) => ({ content: [], details: raw }));
    const tool = { name: 'read', label: 'read', description: 'read', parameters: Type.Object({}), execute } as AgentTool;
    const [bound] = bindDomainToolsToUser([tool], 'alice');
    await bound.execute('call', { user_slug: 'bob', telegram_user_id: 123, slack_user_id: 'BOB' });
    expect(execute.mock.calls[0]?.[1]).toEqual({
      user_slug: 'alice', telegram_user_id: undefined, slack_user_id: undefined,
    });
    expect(() => bindDomainToolsToUser([tool], '')).toThrow(/identity/);
  });
});
