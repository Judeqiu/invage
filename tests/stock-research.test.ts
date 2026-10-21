import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Framework, WorkflowRunContext } from 'utarus';
import { collectStockData, rankStockPeers, rankingValues, type ResearchProvider, type StockData } from '../src/research/stock-data.js';
import { assertResearchReferences, type ResearchAnalysis, type ResearchDiscovery } from '../src/research/stock-model.js';
import { buildStockResearchReport } from '../src/report/stock-research-template.js';
import { createStockResearchWorkflow } from '../src/workflows/stock-research.js';
import { bindWorkflowCatalog, clearWorkflowCatalogForTests } from '../node_modules/utarus/dist/workflows/catalog.js';
import { bindWorkflowRuntime, startWorkflowRuntime, stopWorkflowRuntime, stopWorkflowRuntimeForTests } from '../node_modules/utarus/dist/workflows/runtime.js';
import { createWorkflowsRouter } from '../node_modules/utarus/dist/webapp/workflows-router.js';
import { sourceCatalog } from '../node_modules/utarus/dist/question-library/spec.js';

const now = new Date('2026-10-21T00:00:00Z');
function provider(): ResearchProvider {
  return {
    quote: vi.fn().mockResolvedValue({ symbol: 'TEST', quoteType: 'EQUITY', longName: 'Test Industries', regularMarketPrice: 50,
      regularMarketTime: new Date('2026-10-20T20:00:00Z'), currency: 'USD', trailingPE: 10, marketCap: 1e9 }),
    summary: vi.fn().mockResolvedValue({ assetProfile: { industry: 'Software', sector: 'Technology', longBusinessSummary: 'A software company.' },
      financialData: { financialCurrency: 'USD', recommendationKey: 'buy', numberOfAnalystOpinions: 3, targetMeanPrice: 60 } }),
    annual: vi.fn().mockResolvedValue([
      { date: new Date('2025-12-31'), periodType: '12M', totalRevenue: 1000, operatingIncome: 200, netIncome: 120, totalAssets: 100, totalDebt: 10, freeCashFlow: 0 },
      { date: new Date('2024-12-31'), periodType: '12M', totalRevenue: 500, operatingIncome: 80 },
    ]),
  };
}
async function fixture(ticker = 'TEST'): Promise<StockData> {
  const stock = await collectStockData('TEST', { provider: provider(), now });
  return { ...stock, ticker };
}
const claim = { text: 'Company evidence supports further investigation.', sourceIds: ['data:TEST'] };
const discovery: ResearchDiscovery = { sources: [], business: [claim], competition: [], developments: [],
  peers: ['AAA', 'BBB', 'CCC'].map(ticker => ({ ticker, rationale: 'Software business comparison.' })), gaps: [] };
const analysis: ResearchAnalysis = { conclusion: claim, thesis: [], financials: [claim], valuation: [], catalysts: [], risks: [claim], gaps: [] };

describe('stock research data and peer screen', () => {
  it('preserves zeros, finite values, native currencies and actual quote times', async () => {
    const stock = await fixture();
    expect(stock.annual[0]).toMatchObject({ end: '2025-12-31', freeCashFlow: 0, operatingCashFlow: null });
    expect(stock.quote?.asOf).toBe('2026-10-20T20:00:00.000Z');
    expect(stock.financialCurrency).toBe('USD');
    expect(rankingValues(stock)).toEqual({ growth: 1, profitability: 0.2, balanceSheet: 0.1, valuation: 10 });
  });
  it('keeps company evidence when a provider request fails, without leaking provider messages', async () => {
    const p = provider();
    vi.mocked(p.annual).mockRejectedValue(new Error('secret-token=never-publish'));
    const stock = await collectStockData('TEST', { provider: p, now });
    expect(stock.name).toBe('Test Industries'); expect(stock.annual).toEqual([]);
    expect(stock.gaps).toContain('Annual statements unavailable from Yahoo Finance.');
    expect(JSON.stringify(stock)).not.toContain('never-publish');
    expect(rankStockPeers([stock], now).targetRank).toBeNull();
  });
  it('excludes ambiguous duplicate, future and non-annual periods', async () => {
    const p = provider();
    vi.mocked(p.annual).mockResolvedValue([
      { date: '2025-12-31', periodType: '12M', totalRevenue: 10 },
      { date: '2025-12-31', periodType: '12M', totalRevenue: 20 },
      { date: '2026-06-30', periodType: '3M', totalRevenue: 5 },
      { date: '2027-12-31', periodType: '12M', totalRevenue: 100 },
    ]);
    expect((await collectStockData('TEST', { provider: p, now })).annual).toEqual([]);
  });
  it('rejects ticker ambiguity, non-equities and invalid symbols', async () => {
    const p = provider(); vi.mocked(p.quote).mockResolvedValue({ symbol: 'OTHER' });
    await expect(collectStockData('TEST', { provider: p, now })).rejects.toThrow('different ticker');
    vi.mocked(p.quote).mockResolvedValue({ symbol: 'TEST', quoteType: 'ETF' });
    await expect(collectStockData('TEST', { provider: p, now })).rejects.toThrow('listed equities');
    await expect(collectStockData('../TEST', { provider: p, now })).rejects.toThrow('ticker');
  });
  it('uses a named complete cohort, handles ties, and never invents a market rank', async () => {
    const stocks = await Promise.all(['TEST', 'AAA', 'BBB', 'CCC'].map(fixture));
    const tied = rankStockPeers(stocks, now);
    expect(tied.targetRank).toBe(1); expect(tied.targetScore).toBe(50);
    stocks[1].annual[0].operatingIncome = 500;
    const result = rankStockPeers(stocks, now);
    expect(result.scores[0].ticker).toBe('AAA'); expect(result.targetRank).toBe(2);
    expect(result.methodology).toContain('not an analyst recommendation');
    expect(result.eligible).toEqual(['TEST', 'AAA', 'BBB', 'CCC']);
  });
  it('withholds the composite for stale, mismatched, loss-making or incomplete peers', async () => {
    const stocks = await Promise.all(['TEST', 'AAA', 'BBB', 'CCC'].map(fixture));
    stocks[1].industry = 'Banks'; stocks[2].trailingPE = -4; stocks[3].annual[0].end = '2020-12-31';
    const result = rankStockPeers(stocks, now);
    expect(result.targetRank).toBeNull(); expect(result.scores).toEqual([]);
    expect(result.rows.every((row, i) => i === 0 || row.reason !== null)).toBe(true);
    const bank = await fixture(); bank.industry = 'Banks - Regional';
    expect(rankStockPeers([bank], now).rows[0].reason).toContain('sector-specific');
    bank.industry = 'Software'; bank.annual[1].end = '2022-12-31';
    expect(rankingValues(bank).growth).toBeNull();
    const stale = await fixture(); stale.quote!.asOf = '2026-10-01T20:00:00Z';
    expect(rankStockPeers([stale], now).rows[0].reason).toContain('Quote timestamp');
  });
});

describe('stock research workflow publication', () => {
  function context(approved = true): WorkflowRunContext {
    return { runId: 'run-123', ownerUserId: '11111111-2222-4333-8444-555555555555',
      workflowId: 'stock-research-report', ownerAgentId: 'invage', callerAgentId: 'invage',
      input: { ticker: 'TEST' }, signal: new AbortController().signal, agentBudget: 3, admitted: 0,
      worker: vi.fn().mockResolvedValueOnce(structuredClone(discovery)).mockResolvedValueOnce(structuredClone(analysis)),
      parallel: vi.fn(), parallelVerify: vi.fn().mockResolvedValue([{ approved, findings: approved ? [] : ['Unsupported claim.'] }]), log: vi.fn() };
  }
  it('publishes reviewed HTML only to the authenticated workflow owner with a durable side-panel URL', async () => {
    const collect = vi.fn(async (ticker: string) => fixture(ticker));
    const publish = vi.fn().mockResolvedValue({ filename: 'stock.html', sessionUrl: 'https://test.example.com/api/files/stock.html/view' });
    const def = createStockResearchWorkflow({ collect, publish, now: () => now }); const ctx = context();
    const result = await def.run(ctx);
    expect(def.agent_budget).toBe(3); expect(ctx.worker).toHaveBeenCalledTimes(2); expect(ctx.parallelVerify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ctx.worker).mock.calls.every(([spec]) => spec.llmProfile === 'heavy' && spec.task.includes('one bare JSON object'))).toBe(true);
    expect(vi.mocked(ctx.parallelVerify).mock.calls[0][0][0].llmProfile).toBe('heavy');
    expect(publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ownerUserId: ctx.ownerUserId,
      filename: 'stock-research-TEST-run-123.html', html: expect.stringContaining('Peer comparison & ranking') }));
    expect(result.body).toContain('https://test.example.com/api/files/stock.html/view');
    expect(result.details).toMatchObject({ published: true, peerCount: 3, peerRank: 1 });
  });
  it('does not publish after a rejected audit, unknown source reference or cancellation', async () => {
    const publish = vi.fn(); const def = createStockResearchWorkflow({ collect: async ticker => fixture(ticker), publish, now: () => now });
    await expect(def.run(context(false))).rejects.toThrow('did not approve');
    const ctx = context(); vi.mocked(ctx.worker).mockReset().mockResolvedValueOnce({ ...discovery, business: [{ ...claim, sourceIds: ['invented'] }] });
    await expect(def.run(ctx)).rejects.toThrow('outside this run');
    const controller = new AbortController(); const aborted = context();
    vi.mocked(aborted.parallelVerify).mockImplementation(async () => { controller.abort(); return [{ approved: true, findings: [] }]; });
    Object.defineProperty(aborted, 'signal', { value: controller.signal });
    await expect(def.run(aborted)).rejects.toThrow(); expect(publish).not.toHaveBeenCalled();
  });
  it('rejects identity injection and duplicate comparison tickers before reading data', async () => {
    const collect = vi.fn(); const def = createStockResearchWorkflow({ collect });
    for (const input of [{ ticker: 'TEST', owner_user_id: 'someone-else' }, { ticker: 'TEST', peers: ['AAA', 'aaa'] }, { peers: [] }]) {
      const ctx = context(); Object.defineProperty(ctx, 'input', { value: input }); await expect(def.run(ctx)).rejects.toThrow();
    }
    expect(collect).not.toHaveBeenCalled();
  });
  it('accepts bounded extra findings and caps collected peer proposals at six', async () => {
    const collect = vi.fn(async (ticker: string) => fixture(ticker));
    const publish = vi.fn().mockResolvedValue({ filename: 'stock.html', sessionUrl: 'https://test.example.com/api/files/stock.html/view' });
    const def = createStockResearchWorkflow({ collect, publish, now: () => now }); const ctx = context();
    vi.mocked(ctx.worker).mockReset().mockResolvedValueOnce({ ...discovery,
      business: Array(8).fill(claim), peers: Array.from({ length: 9 }, (_, i) => ({ ticker: `PEER${i}`, rationale: 'Business comparison.' })) }).mockResolvedValueOnce(analysis);
    await def.run(ctx);
    expect(collect).toHaveBeenCalledTimes(7);
    expect(publish).toHaveBeenCalledOnce();
  });
  it('evaluates later peer quotes against the current clock after slow issuer research', async () => {
    let current = now;
    const collect = vi.fn(async (ticker: string, options?: { now?: Date }) => {
      const s = await fixture(ticker); s.quote!.asOf = options!.now!.toISOString(); s.fetchedAt = options!.now!.toISOString(); return s;
    });
    const publish = vi.fn().mockResolvedValue({ filename: 'stock.html', sessionUrl: 'https://test.example.com/api/files/stock.html/view' });
    const def = createStockResearchWorkflow({ collect, publish, now: () => current }); const ctx = context();
    vi.mocked(ctx.worker).mockReset().mockImplementationOnce(async () => {
      current = new Date(now.getTime() + 180_000); return structuredClone(discovery);
    }).mockResolvedValueOnce(analysis);
    const result = await def.run(ctx);
    expect(collect.mock.calls.slice(1).every(([, options]) => options?.now === current)).toBe(true);
    expect(result.details?.peerRank).toBe(1);
  });
  it('escapes untrusted company and model text and rejects unsafe source links', async () => {
    const stock = await fixture(); stock.name = '<script>alert(1)</script>'; stock.description = '<img src=x onerror=alert(1)>';
    const sources = [{ id: 'data:TEST', title: '<bad>', url: 'https://example.com/filing', date: '2026-10-20', evidence: 'Source evidence.' }];
    assertResearchReferences([claim], sources);
    const html = buildStockResearchReport({ generatedAt: now.toISOString(), stocks: [stock], ranking: rankStockPeers([stock], now),
      discovery, analysis, sources, auditFindings: [] });
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('name="viewport"'); expect(html).toContain('Unavailable');
    expect(() => assertResearchReferences([claim], [{ ...sources[0], url: 'javascript:alert(1)' }])).toThrow('invalid source URL');
  });
});

describe('stock workflow runtime and catalog HTTP integration', () => {
  afterEach(() => { clearWorkflowCatalogForTests(); vi.unstubAllEnvs(); });
  it('exposes the report preset only on Velovest and routes reports to the catalog workflow', async () => {
    vi.stubEnv('INVAGE_PRODUCT_PROFILE', 'consultant');
    const { createInvageChatQuestionLibrary } = await import('../src/webapp/chat-questions.js');
    const { invageExtension, buildHostPurpose } = await import('../src/extension.js');
    expect(invageExtension.workflows?.map(w => w.id)).toContain('stock-research-report');
    const library = sourceCatalog(createInvageChatQuestionLibrary());
    expect(library.presets?.find(p => p.id === 'stock_research_report')).toMatchObject({ capabilityIds: ['stock_research.public'] });
    expect(buildHostPurpose('consultant')).toContain('list_workflows');
    expect(buildHostPurpose('consultant')).toContain('stock-research-report');
    expect(buildHostPurpose('full')).not.toContain('stock-research-report');
    vi.stubEnv('INVAGE_PRODUCT_PROFILE', 'full');
    expect(createInvageChatQuestionLibrary().presets?.some(p => p.id === 'stock_research_report')).toBe(false);
  });
  it('boots the actual runtime and serves the registered workflow through GET /api/workflows', async () => {
    vi.stubEnv('UTARUS_DYNAMIC_WORKFLOWS', 'true');
    const def = createStockResearchWorkflow();
    const fakeFramework = { defaultAgentId: 'invage' } as Framework;
    bindWorkflowCatalog([{ id: 'invage', extension: { workflows: [def] } as never }], new Map());
    bindWorkflowRuntime({ framework: fakeFramework, allToolsForAgent: () => [], mcpToolsForAgent: () => [] });
    startWorkflowRuntime();
    try {
      const app = express();
      app.use('/api', (req, _res, next) => { (req as unknown as { user: { userId: string } }).user = { userId: '11111111-2222-4333-8444-555555555555' }; next(); }, createWorkflowsRouter(fakeFramework));
      const response = await request(app).get('/api/workflows').expect(200);
      expect(response.body.workflows).toEqual([expect.objectContaining({ id: 'stock-research-report', agent_budget: 3,
        owner_agent_id: 'invage', input: { empty: false, properties: ['ticker', 'peers'] } })]);
    } finally { await stopWorkflowRuntime(fakeFramework); stopWorkflowRuntimeForTests(); }
  });
});
