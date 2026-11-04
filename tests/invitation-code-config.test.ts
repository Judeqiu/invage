import { afterEach, beforeEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { readAgentConfig, saveAgentConfig } from 'utarus';
import { dashboardConfig } from '../src/webapp/dashboard-config.js';
import { configuredInvitationCode } from '../src/management/invitation-code.js';

const file = join(process.env.UTARUS_DATA_ROOT!, 'config', 'agent-config', dashboardConfig.id + '.json');
beforeEach(() => rmSync(file, { force: true }));
afterEach(() => rmSync(file, { force: true }));
it('defaults to IC and reads saved admin changes immediately without changing other settings', () => {
  expect(dashboardConfig.fields.find(field => field.id === 'invitation_code_prefix')).toMatchObject({type:'text',default:'IC'});
  expect(configuredInvitationCode()).toMatch(/^IC-[A-F0-9]{8}$/);
  for (const [value, prefix] of [[' partner ', 'PARTNER'], ['TEAM', 'TEAM'], ['', 'IC']]) {
    saveAgentConfig(dashboardConfig, {...readAgentConfig(dashboardConfig),invitation_code_prefix:value});
    expect(configuredInvitationCode().startsWith(prefix + '-')).toBe(true);
    expect(readAgentConfig(dashboardConfig).automatic_broker_sync_enabled).toBe(true);
  }
});
