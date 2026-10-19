import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const root = mkdtempSync(join(tmpdir(), 'velovest-auto-index-'));
Object.assign(process.env, { UTARUS_DATA_ROOT: root, UTARUS_LOADED_BY_HOST: '1', UTARUS_AGENT_NAME: 'Velovest' });
const { generateOptionIndex, parseIndexRequest, trailingDividendYield } = await import('../src/risk/option-index.ts');
const { createOptionRiskIndexTool } = await import('../src/tools/option_risk_index.ts');
const { createOptionIndexRouter } = await import('../src/webapp/option-index-api.ts');
const day = 86400000;
import { now, symbol, fixture } from './helpers/option-index-fixture.mjs';
describe('automatic contract risk index', () => {
  it('accepts exact OCC or plain contracts and rejects ambiguity and manual pricing', () => {
    assert.equal(parseIndexRequest({ contract: 'SPY 2026-11-20 95 PUT' }).symbol, symbol);
    assert.equal(parseIndexRequest({ contract: 'SPY   261120P00095000' }).symbol, symbol);
    for (const contract of ['SPY', 'SPY261132P00095000', 'SPY1 2026-11-20 95 PUT', 'SPY 2026-11-20 0 PUT'])
      assert.throws(() => parseIndexRequest({ contract }));
    assert.throws(() => parseIndexRequest({ contract: symbol, iv: .5 }));
  });
  it('fetches all inputs once and returns both scores with an explicit notional denominator', async () => {
    const f = fixture(), result = await generateOptionIndex({ contract: symbol }, f.deps);
    assert.equal(f.calls(), 1); assert.equal(result.scores.length, 2);
    assert.equal(result.normalization.denominator, 10000); assert.equal(result.normalization.contracts, 1);
    for (const score of result.scores) {
      assert.equal(score.scenarios.length, 15);
      assert.equal(score.index, score.stressLoss / 10000 * 100);
    }
    assert.equal(result.market.optionAsOf, new Date(now - 60000).toISOString());
    assert.equal(result.expectedShortfall, null); assert.equal(result.accountEquityImpact, null);
    assert.ok(result.market.dividendReference.includes('trailing'));
  });
  it('does not silently discard unbounded naked-call risk', async () => {
    const f = fixture(); f.row.contractSymbol = 'SPY261120C00095000'; f.chain.options[0].calls = [f.row];
    const r = await generateOptionIndex({ contract: f.row.contractSymbol, side: 'short' }, f.deps);
    assert.equal(r.scores.length, 1); assert.equal(r.scores[0].unboundedLoss, true); assert.equal(r.scores[0].maximumLoss, null);
  });
  it('refuses missing IV, wrong metadata, wrong history and stale/missing rates instead of inventing inputs', async () => {
    for (const change of [f => { f.row.impliedVolatility = undefined; }, f => { f.row.contractSize = 'MINI'; },
      f => { f.row.expiration = new Date('2026-11-21'); }, f => { f.chain.quote.quoteType = 'INDEX'; },
      f => { f.history.meta.symbol = 'OTHER'; }, f => { f.history.quotes = []; },
      f => { f.deps.rate = async () => 'observation_date,DGS1\n2020-01-01,4\n'; }]) {
      const f = fixture(); change(f); await assert.rejects(generateOptionIndex({ contract: symbol }, f.deps));
    }
    const f = fixture(); await assert.rejects(generateOptionIndex({ contract: 'SPY 2025-01-01 95 PUT' }, f.deps)); assert.equal(f.calls(), 0);
  });
  it('keeps dated input evidence and warns on stale or unsynchronized quotes', async () => {
    const f = fixture(); f.row.lastTradeDate = new Date(now - 10 * day);
    const r = await generateOptionIndex({ contract: symbol }, f.deps);
    assert.ok(r.warnings.some(w => w.includes('not synchronized')));
    assert.ok(r.warnings.some(w => w.includes('24 hours')));
  });
  it('rejects ambiguous dividend share bases after a split', () => {
    const f = fixture(); f.history.events.dividends[0].amount = 2;
    f.history.events.splits = [{ date: new Date(now - 10 * day), numerator: 2, denominator: 1 }];
    assert.throws(() => trailingDividendYield(f.history, 100, now), /split/);
  });
  it('calculates directly through the chat tool, and reports provider failure without a fabricated score', async () => {
    const f = fixture(), tool = createOptionRiskIndexTool(raw => generateOptionIndex(raw, f.deps));
    const r = await tool.execute('test', { contract: symbol });
    assert.equal(r.details.scores.length, 2); assert.match(r.content[0].text, /Buyer:/); assert.match(r.content[0].text, /Seller:/);
    f.deps.options = async () => { throw new Error('provider credential must not leak'); };
    const bad = await tool.execute('test', { contract: symbol });
    assert.equal(bad.details, null); assert.doesNotMatch(bad.content[0].text, /credential/); assert.match(bad.content[0].text, /No index/);
  });
  it('gates page lookups by session, visibility and origin before contacting providers', async () => {
    let enabled = true, authorized = true, calls = 0;
    const app = express(); app.use(express.json()); app.use(createOptionIndexRouter({ enabled: () => enabled,
      authenticate: async () => { if (!authorized) throw new Error('no session'); }, generate: async raw => { calls++; return { contract: raw }; } }));
    authorized = false; assert.equal((await request(app).get('/capabilities')).status, 401);
    authorized = true; enabled = false;
    assert.equal((await request(app).get('/capabilities')).body.enabled, false);
    assert.equal((await request(app).post('/').send({ contract: symbol })).status, 404);
    enabled = true; assert.equal((await request(app).post('/').send({ contract: symbol })).status, 403); assert.equal(calls, 0);
    const r = await request(app).post('/').set('Host', 'app.test').set('Origin', 'https://app.test').send({ contract: symbol });
    assert.equal(r.status, 200); assert.equal(calls, 1);
  });
});
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
