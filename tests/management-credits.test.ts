import { afterEach, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({
  query: vi.fn(),
  manager: {userId:'manager',admin:false,deleted:false,manager:true},
}));
vi.mock('../src/management/repository.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/management/repository.js')>();
  const repository = new actual.ManagementRepository({query:identity.query} as never);
  return {...actual,managementRepository:() => repository};
});
let release: (() => void) | undefined;
afterEach(async () => {
  const {setBillingExtension} = await import('../node_modules/utarus/dist/billing/plans.js');
  setBillingExtension(undefined);
  release?.();release=undefined;
  vi.unstubAllEnvs();vi.resetModules();
});

it('gives only active Velovest managers the live credit exemption and restores limits on revocation', async () => {
  vi.stubEnv('INVAGE_PRODUCT_PROFILE','consultant');
  const {invageExtension} = await import('../src/extension.js');
  const {setBillingExtension} = await import('../node_modules/utarus/dist/billing/plans.js');
  const {getEffectiveCap} = await import('../node_modules/utarus/dist/billing/entitlements.js');
  const {checkTurnAllowed} = await import('../node_modules/utarus/dist/billing/gate.js');
  const {bindDatabaseRuntime} = await import('../node_modules/utarus/dist/database/binding.js');
  release = bindDatabaseRuntime({
    close:async () => {},
    users:{readIdentityById:async () => ({state:{user:{admin:false}}})},
    usage:{read:async () => ({state:{period:new Date().toISOString().slice(0,7),period_credits:5000}}),
      creditsBetween:async () => 5000},
    webAuth:{},registration:{},billing:{},trialReset:{},invites:{},adminCodes:{},
  } as never);
  vi.stubEnv('UTARUS_BILLING_ENABLED','false');
  setBillingExtension(invageExtension.billing);
  const exempt = invageExtension.billing!.creditExempt!;
  expect(invageExtension.billing!.weeklyCreditLimit?.credits).toBe(1000);
  identity.query.mockResolvedValue({rows:[identity.manager]});
  expect(await exempt('manager')).toBe(true);
  expect(await getEffectiveCap('manager','credits')).toBeUndefined();
  expect(await checkTurnAllowed('manager',false)).toBeNull();
  expect(identity.query).toHaveBeenLastCalledWith(expect.any(String),['manager']);
  for (const row of [
    {...identity.manager,manager:false},
    {...identity.manager,deleted:true},
    {...identity.manager,admin:true},
    null,
  ]) {
    identity.query.mockResolvedValue({rows:row ? [row] : []});
    expect(await exempt('manager')).toBe(false);
    expect(await getEffectiveCap('manager','credits')).toBe(1000);
    expect(await checkTurnAllowed('manager',false)).toMatchObject({code:'cap_exceeded',cap:1000});
  }
}, 30000);

it('does not add the Velovest exemption to the full product profile', async () => {
  vi.stubEnv('INVAGE_PRODUCT_PROFILE','full');
  const {invageExtension} = await import('../src/extension.js');
  expect(invageExtension.billing?.creditExempt).toBeUndefined();
});
