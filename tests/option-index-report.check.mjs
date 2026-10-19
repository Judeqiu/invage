import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, symbol } from './helpers/option-index-fixture.mjs';

const root = mkdtempSync(join(tmpdir(), 'velovest-index-report-'));
Object.assign(process.env, { UTARUS_DATA_ROOT: root, UTARUS_LOADED_BY_HOST: '1', UTARUS_AGENT_NAME: 'Velovest', INVAGE_PRODUCT_PROFILE: 'consultant' });
const { createOptionIndexReportTool } = await import('../src/tools/option_index_report.ts');
const { createOptionIndexBatchDependencies, generateOptionIndex } = await import('../src/risk/option-index.ts');
const { createInvageChatQuestionLibrary, createInvageChatQuestionStarters } = await import('../src/webapp/chat-questions.ts');
const { prepareQuestion, sourceCatalog } = await import('../node_modules/utarus/dist/question-library/spec.js');
const { createInvageWebUi } = await import('../src/webapp/invage-webui.ts');
const { assertDomainChromeKeys, mergeAgentCatalogs } = await import('../node_modules/utarus/dist/l10n/domain-catalog.js');
const holding = { instrument: 'option', currency: 'USD', units: 1, channel: 'ibkr', option: { underlying: 'SPY', expiry: '2026-11-20', strike: 95,
  right: 'put', side: 'short', multiplier: 100, settlement: 'physical' } };

it('prepares the Reports preset without a ticker/form and includes all startup localization keys', () => {
  const catalog = sourceCatalog(createInvageChatQuestionLibrary());
  const preset = catalog.presets.find(p => p.id === 'option_index_report');
  assert.ok(preset); assert.equal(preset.categoryId, 'reports'); assert.equal((preset.fields ?? []).length, 0);
  assert.match(prepareQuestion(preset, {}), /all my recorded open option positions/);
  assert.match(prepareQuestion(preset, {}), /Automatically fetch/);
  assert.equal(catalog.presets.filter(p => p.categoryId === 'reports').length, 2);
  const starter = createInvageChatQuestionStarters().find(p => p.id === 'question_option_index_report');
  const strings = JSON.parse(readFileSync('l10n/en.json', 'utf8'));
  for (const k of ['label', 'description', 'message']) assert.equal(strings[`chat.empty.starter.${starter.id}.${k}`], starter[k]);
  assertDomainChromeKeys({ webUi: createInvageWebUi() }, mergeAgentCatalogs(['en'], { en: strings }).en, 'invage');
});
it('reuses a chain, dividend feed and official rate across different strikes in a report', async () => {
  const f = fixture(); let histories = 0, rates = 0;
  const div = f.deps.dividends, rate = f.deps.rate;
  f.deps.dividends = async (...args) => { histories++; return div(...args); };
  f.deps.rate = async (...args) => { rates++; return rate(...args); };
  f.chain.options[0].puts.push({ ...f.row, strike: 96, contractSymbol: 'SPY261120P00096000' });
  const batch = createOptionIndexBatchDependencies(f.deps);
  const scores = await Promise.all([generateOptionIndex({ contract: symbol }, batch), generateOptionIndex({ contract: 'SPY261120P00096000' }, batch)]);
  assert.equal(scores.length, 2); assert.equal(f.calls(), 1); assert.equal(histories, 1); assert.equal(rates, 1);
});
it('publishes all lots with correct sides/quantities, deduplicates contracts and preserves unsupported rows', async () => {
  const f = fixture(); let html, owner, resolved;
  const snapshot = { revision: 1, state: { user: { id: 'owner' }, portfolio: {
    '<script>lot</script>': holding, second: { ...holding, units: 2, channel: 'tiger' }, unsupported: { ...holding, currency: 'EUR' },
  } } };
  const tool = createOptionIndexReportTool({ context: () => ({ userId: 'owner' }), resolve: async p => { resolved = p; return snapshot; },
    batch: () => createOptionIndexBatchDependencies(f.deps), publish: async p => { html = p.html; owner = p.ownerUserId; return { sessionUrl: 'https://test.example.com/view/report', drivePath: 'report.html' }; } });
  const r = await tool.execute('test', {});
  assert.equal(owner, 'owner'); assert.deepEqual(resolved, { user_id: 'owner' });
  assert.equal(r.details.scoredLots, 2); assert.equal(r.details.unavailableLots, 1); assert.equal(r.details.totalLots, 3);
  assert.equal(f.calls(), 1); assert.match(html, /Unsupported contract/); assert.match(html, /Do not sum these indexes/);
  assert.doesNotMatch(html, /<script>lot/); assert.match(html, /&lt;script&gt;lot/);
  assert.match(r.content[0].text, /https:\/\/test.example.com\/view\/report/);
});
it('rejects cross-owner and incognito report requests before resolving private data or publishing', async () => {
  let calls = 0;
  for (const context of [{ userId: 'owner' }, { userId: 'owner', incognito: true }]) {
    const tool = createOptionIndexReportTool({ context: () => context, resolve: async () => { calls++; throw new Error('must not resolve'); } });
    const result = await tool.execute('test', { user_id: 'another-owner' });
    assert.equal(result.details, null);
  }
  assert.equal(calls, 0);
});
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
