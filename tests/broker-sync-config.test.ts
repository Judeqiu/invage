import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAgentConfig, saveAgentConfig } from 'utarus';
import { dashboardConfig, readBrokerSyncConfig, readDashboardConfig } from '../src/webapp/dashboard-config.js';
const directory = join(process.env.UTARUS_DATA_ROOT!, 'config', 'agent-config');
const file = join(directory, dashboardConfig.id + '.json');
beforeEach(() => rmSync(file, { force: true }));
afterEach(() => rmSync(file, { force: true }));

it('registers validated time controls in the existing agent configuration with 2 pm Singapore defaults', () => {
  expect(readBrokerSyncConfig()).toEqual({ enabled: true, time: '14:00', timezone: 'Asia/Singapore', minuteOfDay: 840 });
  expect(dashboardConfig.fields.find(field => field.id === 'automatic_broker_sync_enabled')).toMatchObject({ type: 'boolean', default: true });
  expect(dashboardConfig.fields.find(field => field.id === 'automatic_broker_sync_hour')).toMatchObject({ type: 'select', default: '14' });
  expect(dashboardConfig.fields.find(field => field.id === 'automatic_broker_sync_minute')).toMatchObject({ type: 'select', default: '00' });
});
it('preserves existing agent settings and supplies schedule defaults for old saved configurations', () => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, JSON.stringify({ dashboard_version: 'v2', show_realized_pnl: false }));
  expect(readBrokerSyncConfig().time).toBe('14:00');
  expect(readDashboardConfig()).toMatchObject({ dashboardVersion: 'v2', showRealizedPnl: false });
  saveAgentConfig(dashboardConfig, { ...readAgentConfig(dashboardConfig), automatic_broker_sync_enabled: false,
    automatic_broker_sync_hour: '17', automatic_broker_sync_minute: '35' });
  expect(readBrokerSyncConfig()).toMatchObject({ enabled: false, time: '17:35', minuteOfDay: 1055 });
  expect(readDashboardConfig()).toMatchObject({ dashboardVersion: 'v2', showRealizedPnl: false });
  expect(JSON.parse(readFileSync(file, 'utf8')).automatic_broker_sync_minute).toBe('35');
});
it('rejects invalid times and supports the full Singapore day with minute precision', () => {
  for (const patch of [{ automatic_broker_sync_hour: '24' }, { automatic_broker_sync_minute: '60' },
    { automatic_broker_sync_minute: '5' }, { automatic_broker_sync_hour: 14 }, { automatic_broker_sync_enabled: 'yes' }]) {
    expect(() => saveAgentConfig(dashboardConfig, { ...readAgentConfig(dashboardConfig), ...patch })).toThrow();
  }
  for (const [hour, minute, minuteOfDay] of [['00', '00', 0], ['23', '59', 1439]] as const) {
    saveAgentConfig(dashboardConfig, { ...readAgentConfig(dashboardConfig), automatic_broker_sync_hour: hour, automatic_broker_sync_minute: minute });
    expect(readBrokerSyncConfig()).toMatchObject({ time: `${hour}:${minute}`, minuteOfDay });
  }
});
