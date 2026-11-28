import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import puppeteer from 'puppeteer-core';
import { createFramework, createSession, createState, getConversation } from 'utarus';
import { expect, it, vi } from 'vitest';
import { buildFrameworkAgentList } from '../src/agents/framework-agents.js';
import { HOST_AGENT_ID } from '../src/agents/roster.js';
import { listBrokerSyncRuns } from '../src/brokers/sync-history.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { managementRepository } from '../src/management/repository.js';
import { buildInvageApp } from '../src/webapp/server.js';
import { useTestDatabase } from './helpers/database.js';

const { modelServer, modelReady } = vi.hoisted(() => {
  // Keep the production roster and profiles. The regression uses isolated provider transports.
  process.env.INVAGE_PRODUCT_PROFILE = 'consultant';
  process.env.UTARUS_AGENT_NAME = 'Victor Consultant';
  const modelServer = import('node:http').then(({ createServer }) => createServer());
  const modelReady = modelServer.then(server => new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      process.env.DEEPSEEK_API_KEY = 'fixture';
      process.env.KIMI_API_KEY = 'fixture';
      process.env.FIRECRAWL_API_KEY = 'fixture';
      process.env.UTARUS_LLM_PROFILES = JSON.stringify({
        daily: { provider: 'deepseek', baseUrl }, vision: { provider: 'kimi', model: 'k3', baseUrl },
        heavy: { provider: 'kimi', model: 'k3', baseUrl },
      });
      process.env.UTARUS_LLM_ROUTING = JSON.stringify({ default: 'daily', utility: 'daily', has_images: 'vision', heavy: 'heavy' });
      server.unref();
      resolve();
    });
  }));
  return { modelServer, modelReady };
});

const account = 'US-FIXTURE-ACCOUNT';
const token = 'fixture-secret-not-for-chat';
const statementDate = '20261127';
const guidance = 'In Client Portal, edit the Activity Flex Query and include Currency and Ending Cash in Cash Report. Then run Preview in Brokers.';
const documentation = 'https://www.ibkrguides.com/clientportal/performanceandstatements/activityflex.htm';

function fixture(userId: string, previousSync = false): InvestorState {
  return {
    user: { id: userId, created_at: '2026-11-27', auth_token: randomUUID() },
    profile: { display_name: 'Test investor', contact_email: `${userId}@test.invalid`, language: 'en' },
    log: [],
    broker_sources: { access: { broker_id: 'ibkr', credentials: { token } } },
    broker_connections: { primary: { broker_id: 'ibkr', source_id: 'access', channel: 'ibkr', label: 'Test Interactive Brokers',
      enabled: true, account_id: account, config: { activity_query_id: '421236' },
      ...(previousSync ? { last_sync: { ok: true, at: '2026-11-27T09:00:00Z', as_of: '2026-11-27', account_id: account } } : {}) },
    },
  };
}

it('opens Bookkeeper from first Preview and a recorded sync failure with private broker diagnostics', async () => {
  await modelReady;
  const model = await modelServer;
  const { runtime, databaseUrl } = await useTestDatabase();
  vi.stubEnv('UTARUS_DATABASE_URL', databaseUrl);
  vi.stubEnv('UTARUS_DATABASE_SSL_MODE', 'disable');
  vi.stubEnv('UTARUS_DATABASE_POOL_MAX', '2');
  const management = managementRepository();
  await management.pool.query(await readFile(new URL('../src/management/schema.sql', import.meta.url), 'utf8'));
  const fresh = randomUUID();
  const returning = randomUUID();
  await createState(fixture(fresh));
  await createState(fixture(returning, true));
  const sessions = await Promise.all([fresh, returning].map(userId => createSession({ type: 'user', userId, displayName: 'Test investor' })));
  const nativeFetch = globalThis.fetch;
  const requests: Array<{ model: string; stream: boolean }> = [];
  const documentationReads: string[] = [];
  vi.stubGlobal('fetch', (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'ndcdyn.interactivebrokers.com') {
      expect(url.searchParams.get('t')).toBe(token);
      if (url.pathname.endsWith('/SendRequest')) return new Response('<FlexStatementResponse><Status>Success</Status><ReferenceCode>ref</ReferenceCode></FlexStatementResponse>');
      return new Response(`<FlexQueryResponse><FlexStatements><FlexStatement accountId="${account}" fromDate="${statementDate}" toDate="${statementDate}">
        <OpenPositions></OpenPositions><CashReport><CashReportCurrency accountId="${account}" endingCash="1234.56" /></CashReport></FlexStatement></FlexStatements></FlexQueryResponse>`);
    }
    if (url.hostname === 'api.firecrawl.dev') {
      const body = JSON.parse(String(init?.body));
      documentationReads.push(body.url);
      expect(body.url).toBe(documentation);
      return Response.json({ success: true, data: { markdown: 'Flex Queries are configurable report templates in Client Portal.',
        metadata: { sourceURL: documentation } } });
    }
    return nativeFetch(input, init);
  }) satisfies typeof fetch);

  const sent: Array<{ text: string; pageContext: { broker_help_id: string } }> = [];
  const facts: Array<Record<string, unknown>> = [];
  const fixtureFailures: unknown[] = [];
  model.on('request', async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      requests.push({ model: payload.model, stream: !!payload.stream });
      const event = (delta: object, reason: string | null = null) => `data: ${JSON.stringify({
        id: 'chatcmpl-isolated', object: 'chat.completion.chunk', model: payload.model,
        choices: [{ index: 0, delta, finish_reason: reason }],
      })}\n\n`;
      const completion = JSON.stringify({ claims: [] });
      if (!payload.stream) {
        response.end(JSON.stringify({ id: 'chatcmpl-isolated', model: payload.model,
          choices: [{ index: 0, message: { role: 'assistant', content: completion }, finish_reason: 'stop' }] }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const tools = new Set(payload.tools?.map((tool: { function: { name: string } }) => tool.function.name) ?? []);
      if (!tools.has('inspect_broker_help')) {
        response.end(event({ role: 'assistant', content: completion }) + event({}, 'stop') + 'data: [DONE]\n\n');
        return;
      }
      const results = payload.messages.filter((message: { role: string }) => message.role === 'tool');
      const last = results.at(-1);
      const phase = results.length;
      if (phase === 1) facts.push(JSON.parse(last.content));
      const next = [
        ['inspect_broker_help', sent.at(-1)!.pageContext],
        ['firecrawl', { action: 'scrape', url: documentation }],
        ['commit_reply', { markdown: `${guidance}\n\n[IBKR Flex Web Service](${documentation})` }],
      ][phase];
      if (next) {
        response.write(event({ role: 'assistant', tool_calls: [{ index: 0, id: randomUUID(), type: 'function',
          function: { name: next[0], arguments: JSON.stringify(next[1]) } }] }));
        response.end(event({}, 'tool_calls') + 'data: [DONE]\n\n');
      } else {
        response.end(event({ role: 'assistant', content: '' }) + event({}, 'stop') + 'data: [DONE]\n\n');
      }
    } catch (error) {
      fixtureFailures.push(error);
      response.end();
    }
  });

  const framework = await createFramework({
    database: runtime, startTaskScheduler: false, startLifecycleMailScheduler: false, startWorkflowRuntime: false,
    defaultAgentId: HOST_AGENT_ID, agents: buildFrameworkAgentList(),
  });
  const app = express();
  app.use('/api/chat/messages', express.json(), (req, _res, next) => { sent.push(req.body); next(); });
  app.use(buildInvageApp(framework));
  const server = createServer(app).listen(0, '127.0.0.1');
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await puppeteer.launch({ executablePath: process.env.TEST_CHROMIUM_PATH ?? '/usr/bin/chromium',
      headless: true, args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    for (const [i, action] of ['preview', 'sync'].entries()) {
      const owner = [fresh, returning][i];
      const context = await browser.createBrowserContext();
      try {
        await context.setCookie({ name: 'bindrive_session', value: sessions[i], url });
        const page = await context.newPage();
        if (action === 'sync') await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        page.setDefaultTimeout(12000);
        await page.goto(url + '/settings/brokers', { waitUntil: 'domcontentloaded' });
        const frame = await (await page.waitForSelector('iframe[src*="/settings/brokers/"]'))!.contentFrame();
        const control = await frame!.waitForSelector(`[data-action="${action}"]:not([disabled])`);
        const failed = page.waitForResponse(response => response.url().endsWith('/primary/' + action));
        await control!.click();
        const result = await (await failed).json();
        expect(result.help_id).toBeTruthy();
        expect(listBrokerSyncRuns(owner, 'ibkr').total).toBe(i);
        const help = await frame!.waitForSelector(action === 'sync' ? '#sync-feedback [data-help]' : '.connector [data-help]', { visible: true });
        const newTab = browser.waitForTarget(target => target.browserContext() === context && target.url().startsWith(url + '/?c='));
        await help!.click();
        const chat = (await (await newTab).page())!;
        await chat.waitForFunction(text => document.querySelector('main')?.textContent?.includes(text), { timeout: 18000 }, guidance);
        expect(await chat.$eval(`main a[href="${documentation}"]`, link => link.textContent)).toBe('IBKR Flex Web Service');
        expect(new URL(page.url()).pathname).toBe('/settings/brokers');
        const conversationId = new URL(chat.url()).searchParams.get('c')!;
        const saved = await getConversation(owner, conversationId);
        expect(saved.messages.some(message => message.speaker === 'Bookkeeper')).toBe(true);
        expect(sent[i].pageContext).toEqual({ broker_help_id: result.help_id });
        expect(JSON.stringify(sent[i])).not.toContain(token);
        expect(facts[i]).toMatchObject({ step: action,
          failure: { message: expect.stringContaining('CashReport has no currency rows') },
          remoteResponse: { archived: action === 'sync', cash: { rows: 1, withCurrency: 0, withEndingCash: 1 } } });
        expect(JSON.stringify(facts[i])).not.toContain(account);
        expect(JSON.stringify(facts[i])).not.toContain('1234.56');
        const otherOwner = i === 0 ? 1 : 0;
        const reused = await nativeFetch(url + '/api/domain/invage/broker-help', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `bindrive_session=${sessions[otherOwner]}` },
          body: JSON.stringify({ attempt_id: result.help_id }),
        });
        expect(reused.status).toBe(404);
        if (action === 'sync') {
          await page.bringToFront();
          await page.reload({ waitUntil: 'domcontentloaded' });
          const reloaded = await (await page.waitForSelector('iframe[src*="/settings/brokers/"]'))!.contentFrame();
          await reloaded!.locator('[data-action="manage"]').click();
          const historicalHelp = await reloaded!.waitForSelector('.sync-run [data-help]', { visible: true });
          const savedScope = await historicalHelp!.evaluate(button => JSON.parse((button as HTMLElement).dataset.help!));
          expect(savedScope).toEqual({ connection_id: 'primary', run_id: listBrokerSyncRuns(owner, 'ibkr').runs[0].id });
        }
      } finally {
        await context.close();
      }
    }
    expect(documentationReads).toEqual([documentation, documentation]);
    expect(requests.filter(request => request.stream).every(request => request.model === 'deepseek-v4-flash')).toBe(true);
    expect(fixtureFailures).toEqual([]);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await framework.stop();
    await management.pool.end();
    model.closeAllConnections();
    await new Promise<void>(resolve => model.close(() => resolve()));
    vi.unstubAllGlobals();
  }
}, 75000);
