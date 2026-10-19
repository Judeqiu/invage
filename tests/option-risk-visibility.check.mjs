import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('Management toggle hides calculator by default and updates the existing manifest registration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'velovest-calculator-visibility-'));
  Object.assign(process.env, { UTARUS_LOADED_BY_HOST: '1', UTARUS_AGENT_NAME: 'Velovest',
    UTARUS_DATA_ROOT: root, INVAGE_PRODUCT_PROFILE: 'consultant' });
  try {
    const { readAgentConfig, saveAgentConfig, buildWebUiManifest } = await import('utarus');
    const { dashboardConfig, readDashboardConfig } = await import('../src/webapp/dashboard-config.ts');
    const { createInvageWebUi } = await import('../src/webapp/invage-webui.ts');
    const { assertDomainChromeKeys, mergeAgentCatalogs } = await import('../node_modules/utarus/dist/l10n/domain-catalog.js');
    const webUi = createInvageWebUi();
    const field = dashboardConfig.fields.find(f => f.id === 'show_option_risk_calculator');
    assert.equal(field.type, 'boolean'); assert.equal(field.default, false);
    const shown = () => {
      const manifest = buildWebUiManifest({ webUi });
      return { nav: manifest.nav.some(n => n.path === '/option-risk'),
        route: manifest.routes.some(r => r.path === '/option-risk') };
    };
    assert.equal(readDashboardConfig().showOptionRiskCalculator, false);
    assert.deepEqual(shown(), { nav: false, route: false });
    // Saving through the same API as Management must take effect without
    // reconstructing the WebUI object or restarting the server.
    saveAgentConfig(dashboardConfig, { ...readAgentConfig(dashboardConfig), show_option_risk_model_view: true, show_option_risk_calculator: true });
    assert.deepEqual(shown(), { nav: true, route: true });
    const catalog = JSON.parse(readFileSync('l10n/en.json', 'utf8'));
    assertDomainChromeKeys({ webUi }, mergeAgentCatalogs(['en'], { en: catalog }).en, 'invage');
    saveAgentConfig(dashboardConfig, { ...readAgentConfig(dashboardConfig), show_option_risk_calculator: false });
    assert.deepEqual(shown(), { nav: false, route: false });
    assert.equal(readDashboardConfig().showOptionRiskModelView, true);
    assert.ok(webUi.nav.some(n => n.path === '/dashboard'));
    assert.ok(webUi.routes.some(r => r.path === '/positions'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
