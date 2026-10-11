import { describe, expect, it } from 'vitest';
import { createState } from 'utarus';
import { useTestDatabase } from './helpers/database.js';
import { loadInvestor, saveInvestor } from '../src/state/investor-store.js';
import type { InvestorState } from '../src/state/portfolio-state.js';

await useTestDatabase();

const fixture: InvestorState & { treasury: { reporting_currency: string; updated_at: string }; custom_domain_extension: { nested: [string, { exact: number }]; enabled: boolean } } = {
  user: {
    id: '14ab8d35-f59e-4698-bd80-cf6a38d217b4', slug: 'domain-preservation',
    created_at: '2026-09-15', telegram_user_ids: [1909001], slack_user_ids: ['U_DOMAIN'],
    auth_token: 'existing-domain-auth-token', password_hash: 'existing-password-hash',
  },
  profile: { display_name: 'Domain Preservation', contact_email: 'domain@example.test' },
  log: [{ ts: '2026-09-15', action: 'migration_fixture' }],
  portfolio: {
    'AAPL@ibkr': { avg_price: 198.125, units: 12.5, channel: 'ibkr', category: 'Long term' },
    'GOLD@ocbc': { avg_price: 9983.81, units: 1, channel: 'ocbc', instrument: 'fund',
      fund: { quote_source: 'manual', mark: 7547.3, name: 'Precious metals' } },
  },
  cash: [
    { channel: 'dbs', currency: 'SGD', amount: 8123.45, updated_at: '2026-09-15' },
    { channel: 'ibkr', currency: 'USD', amount: -12.34, updated_at: '2026-09-15' },
  ],
  deposits: [{ id: 'fd-existing', amount: 20000, interest: 350.5, currency: 'SGD',
    channel: 'dbs', start_date: '2026-01-01', end_date: '2027-01-01', updated_at: '2026-09-15' }],
  playbook: { watchlists: { markets: ['US'], sectors: ['Technology'], themes: ['AI'],
    products: [{ symbol: 'MSFT', instrument: 'equity', added_at: '2026-09-01', note: 'Original note' }] } },
  treasury: { reporting_currency: 'SGD', updated_at: '2026-09-15' },
  custom_domain_extension: { nested: ['retained', { exact: 0.125 }], enabled: false },
};

describe('database investor snapshots', () => {
  it('preserves identity, credentials and all domain fields through reads and optimistic writes', async () => {
    await createState(fixture);
    const original = await loadInvestor(fixture.user.slug);
    expect(original.state).toEqual(fixture);
    const stale = await loadInvestor(fixture.user.slug);
    const startingRevision = original.revision;
    original.state.profile.display_name = 'Updated display name';
    await saveInvestor(original);
    expect(original.revision).toBe(startingRevision + 1);
    const persisted = await loadInvestor(fixture.user.slug);
    expect(persisted).toEqual(original);
    expect(persisted.state).toEqual({ ...fixture, profile: { ...fixture.profile, display_name: 'Updated display name' } });

    stale.state.cash = [];
    await expect(saveInvestor(stale)).rejects.toThrow('User revision conflict or user not found');
    expect(stale.revision).toBe(startingRevision);
    expect(await loadInvestor(fixture.user.slug)).toEqual(persisted);
  });
});
