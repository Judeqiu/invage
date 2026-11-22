import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import puppeteer from 'puppeteer-core';
import { createSession, createState, createFramework, notifyUser } from 'utarus';
import { useTestDatabase } from './helpers/database.js';
import { buildInvageApp } from '../src/webapp/server.js';
import { createInvageChatQuestionLibrary } from '../src/webapp/chat-questions.js';
import { managementRepository } from '../src/management/repository.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { readBrokerPositionSnapshot } from '../src/brokers/accounts.js';
import { yf } from '../src/market/yf-client.js';
import { buildFrameworkAgentList } from '../src/agents/framework-agents.js';
import { HOST_AGENT_ID } from '../src/agents/roster.js';
import { createOptionDecisionReportTool } from '../src/tools/option_decision_report.js';
import { runOnDemandOptionReport } from '../src/premarket/on-demand.js';
import { runPremarketScans } from '../src/premarket/scheduler.js';
import { scanPremarket } from '../src/premarket/scan.js';
import { readTradingDay } from '../src/premarket/session.js';

const modelServer = await vi.hoisted(async () => {
  const { createServer } = await import('node:http');
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  vi.stubEnv('UTARUS_AGENT_NAME', 'Velovest');
  vi.stubEnv('INVAGE_PRODUCT_PROFILE', 'consultant');
  vi.stubEnv('INVAGE_REQUIRE_BOOKS_FOR_PORTFOLIO', 'true');
  vi.stubEnv('WEB_ONLY', 'true');
  // Match deployed profiles and routing. All model transport stays on loopback.
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  vi.stubEnv('DEEPSEEK_API_KEY', 'isolated-fixture');
  vi.stubEnv('KIMI_API_KEY', 'isolated-fixture');
  vi.stubEnv('UTARUS_LLM_BASE_URL', baseUrl);
  vi.stubEnv('UTARUS_LLM_PROFILES', JSON.stringify({
    daily: { provider: 'deepseek', baseUrl },
    vision: { provider: 'kimi', model: 'k3', baseUrl },
    heavy: { provider: 'kimi', model: 'k3', baseUrl },
  }));
  vi.stubEnv('UTARUS_LLM_ROUTING', JSON.stringify({ default: 'daily', has_images: 'vision', utility: 'daily', heavy: 'heavy' }));
  return server;
});

const day = '2026-11-23';
const expiry = '2026-12-21';
const rollExpiry = '2027-01-15';
const now = new Date(`${day}T12:00:00Z`);
const owner = randomUUID(), second = randomUUID();
const account = 'UTEST1';
function fixture(userId: string): InvestorState {
  return {
    user: { id: userId, created_at: day, auth_token: randomUUID() },
    profile: { display_name: 'Fixture investor', contact_email: `${userId}@test.local`, language: 'en' }, log: [],
    broker_sources: { source: { broker_id: 'ibkr', credentials: { token: 'fixture' } } },
    broker_connections: { primary: { broker_id: 'ibkr', source_id: 'source', channel: 'ibkr', label: 'Fixture broker',
      account_id: account, enabled: true, config: { activity_query_id: '1' } } },
    option_executions: [{ channel: 'ibkr', account_id: account, execution_id: 'opening', contract_id: '42',
      executed_at: '2026-11-20T11:00:00', underlying: 'AMD', right: 'put', expiry, strike: '100', multiplier: '100',
      contracts: '1', side: 'sell', effect: 'open', currency: 'USD', gross_premium: '1000', commission: '0' }],
  };
}
function flexPositions() {
  const dates = day.replaceAll('-', '');
  const openPosition = (exp: string, strike: number, quantity: number, conid: number) =>
    `<OpenPosition accountId="${account}" symbol="AMD   ${exp.slice(2).replaceAll('-', '')}P${String(strike * 1000).padStart(8, '0')}" assetCategory="OPT" position="${quantity}" strike="${strike}" expiry="${exp.replaceAll('-', '')}" putCall="P" underlyingSymbol="AMD" conid="${conid}" markPrice="15" costBasisMoney="-1000" currency="USD" multiplier="100" />`;
  return Buffer.from(`<FlexQueryResponse><FlexStatements><FlexStatement accountId="${account}" fromDate="${dates}" toDate="${dates}">
  <OpenPositions>${openPosition(expiry, 100, -1, 42)}${openPosition(expiry, 90, -1, 43)}${openPosition('2026-12-22', 110, -1, 44)}${openPosition(expiry, 110, 0, 45)}</OpenPositions>
  <CashReport><CashReportCurrency accountId="${account}" currency="USD" endingCash="99999" /></CashReport>
  </FlexStatement></FlexStatements></FlexQueryResponse>`);
}

it('generates native decision reports from chat and the independent opt-in schedule', async () => {
  const root = await mkdtemp(join(tmpdir(), 'velovest-premarket-'));
  vi.stubEnv('UTARUS_DATA_ROOT', root);
  const { runtime, databaseUrl } = await useTestDatabase();
  vi.stubEnv('UTARUS_DATABASE_URL', databaseUrl);
  vi.stubEnv('UTARUS_DATABASE_SSL_MODE', 'disable');
  vi.stubEnv('UTARUS_DATABASE_POOL_MAX', '2');
  const management = managementRepository();
  await management.pool.query(await readFile(new URL('../src/management/schema.sql', import.meta.url), 'utf8'));
  const quote = { symbol: 'AMD', currency: 'USD', quoteType: 'EQUITY', exchangeTimezoneName: 'America/New_York',
    marketState: 'PRE', preMarketPrice: 110, preMarketTime: new Date('2026-11-23T11:59:50Z') };
  vi.spyOn(yf, 'quote').mockImplementation(async () => quote as never);
  vi.spyOn(yf, 'options').mockImplementation(async (_symbol, args) => {
    const contract = (date: string, strike: number, right: 'C' | 'P', bid: number, ask: number) => ({
      contractSymbol: `AMD${date.slice(2).replaceAll('-', '')}${right}${String(strike * 1000).padStart(8, '0')}`,
      strike, expiration: new Date(date), currency: 'USD', contractSize: 'REGULAR', bid, ask,
      volume: 0, openInterest: 20, impliedVolatility: .35, lastTradeDate: new Date('2026-11-20T20:59:00Z'),
    });
    const date = args?.date ? new Date(args.date).toISOString().slice(0, 10) : expiry;
    return { quote, underlyingSymbol: 'AMD', expirationDates: [new Date(expiry), new Date(rollExpiry)],
      options: [{ expirationDate: new Date(date), puts: date === expiry ? [contract(expiry, 100, 'P', 14, 15)] : [contract(rollExpiry, 95, 'P', 15, 16)],
        calls: [contract(date, 115, 'C', 3, 4)] }] } as never;
  });
  const broker = vi.fn(async (state: InvestorState, id: string) => readBrokerPositionSnapshot(state, id, {
    kind: 'ibkr', flex: { get: async request => request === 'SendRequest'
      ? Buffer.from('<FlexStatementResponse><Status>Success</Status><ReferenceCode>ref</ReferenceCode></FlexStatementResponse>')
      : flexPositions() },
  }));
  const calendar = vi.fn(async (date: string) => readTradingDay(date, async () =>
    new Response('Holiday Name,Date,Regular Trading Hours,Global Trading Hours\nThanksgiving,2026-11-26,None,None\n')));
  const scan = vi.fn((...args: Parameters<typeof scanPremarket>) =>
    scanPremarket(args[0], args[1], args[2], args[3], { readBrokerPositionSnapshot: broker }));
  let manualNow = new Date('2026-11-28T12:00:00Z');
  const testGenerate: typeof runOnDemandOptionReport = async action => {
    const first = runOnDemandOptionReport(action, manualNow, { scanPremarket: scan, readTradingDay: calendar });
    const concurrent = runOnDemandOptionReport(action, manualNow, { scanPremarket: scan, readTradingDay: calendar });
    const [result, duplicate] = await Promise.all([first, concurrent]);
    expect(result).toEqual(duplicate);
    const replay = await runOnDemandOptionReport(action, manualNow, { scanPremarket: scan, readTradingDay: calendar });
    expect(replay).toEqual(result);
    return result;
  };
  const reportTool = createOptionDecisionReportTool(testGenerate);
  const requests: Array<{ model: string; tools?: Array<{ function: { name: string } }> }> = [];
  modelServer.on('request', async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString()) as typeof requests[number];
    const event = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({
      id: 'chatcmpl-isolated', object: 'chat.completion.chunk', model: 'deepseek-v4-flash',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (!payload.tools?.length) {
      response.end(event({ role: 'assistant', content: 'Options decision report' }) + event({}, 'stop') + 'data: [DONE]\n\n');
      return;
    }
    requests.push(payload);
    response.write(event({ role: 'assistant', tool_calls: [{ index: 0, id: randomUUID(), type: 'function',
      function: { name: reportTool.name, arguments: '{}' } }] }));
    response.end(event({}, 'tool_calls') + 'data: [DONE]\n\n');
  });
  const send = vi.fn(async (params: Parameters<typeof notifyUser>[0]) => {
    await notifyUser(params);
    throw new Error('Fixture interruption after the inbox was committed');
  });
  const tick = (at: Date) => runPremarketScans(at, { readTradingDay: calendar, notifyUser: send, scanPremarket: scan });
  const agents = buildFrameworkAgentList();
  const host = agents.find(agent => agent.id === HOST_AGENT_ID)!;
  const createTools = host.extension.tools;
  host.extension.tools = async (...args) => {
    const tools = typeof createTools === 'function' ? await createTools(...args) : createTools;
    return tools.map(tool => tool.name === reportTool.name ? { ...tool, execute: reportTool.execute } : tool);
  };
  const framework = await createFramework({
    database: runtime, startTaskScheduler: false, startLifecycleMailScheduler: false, startWorkflowRuntime: false,
    defaultAgentId: HOST_AGENT_ID, agents,
  });
  const server = buildInvageApp(framework).listen(0, '127.0.0.1');
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.stubEnv('UTARUS_PUBLIC_BASE_URL', url);
    await createState(fixture(owner));
    await createState(fixture(second));
    const auth = (userId: string) => createSession({ type: 'user', userId, displayName: 'Fixture investor' });
    const [token, secondToken] = await Promise.all([auth(owner), auth(second)]);
    browser = await puppeteer.launch({ executablePath: process.env.TEST_CHROMIUM_PATH ?? '/usr/bin/chromium',
      protocolTimeout: 8000, headless: true, defaultViewport: { width: 1280, height: 900 },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(8000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    await page.setCookie({ name: 'bindrive_session', value: token, url });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => location.pathname === '/dashboard');
    const nav = await page.goto(`${url}/settings/premarket-options`, { waitUntil: 'domcontentloaded' });
    expect(nav?.status()).toBe(200);
    const manifest = await page.evaluate(async () => {
      const response = await fetch('/api/webui/manifest');
      return { status: response.status, manifest: await response.json() };
    });
    expect(manifest.status).toBe(200);
    expect(manifest.manifest.visibleSettingsSections).toContain('premarket-options');
    const settingsFrame = () => page.waitForSelector('iframe[src*="/settings/premarket/"]', { timeout: 8000 }).catch(async error => {
      throw new Error(`Settings frame unavailable at ${page.url()}. ${(await page.$eval('body', node => node.innerText)).slice(0, 500)} ${pageErrors.join(' / ')}`, {cause:error});
    });
    let frame = await (await settingsFrame())!.contentFrame();
    await frame!.waitForSelector('#enabled:not([disabled])', { timeout: 8000 });
    expect(await frame!.$eval('#enabled', input => (input as HTMLInputElement).checked)).toBe(false);
    await tick(now);
    expect(calendar).not.toHaveBeenCalled();
    expect(broker).not.toHaveBeenCalled();
    const api = (path: string, session: string) => fetch(url + path, {
      headers: { Cookie: `bindrive_session=${session}` }, signal: AbortSignal.timeout(8000),
    });
    const inbox = async (session: string) => (await api('/api/notifications', session)).json();
    const notes = async (session: string) => (await api('/api/notes', session)).json();

    const chat = page;
    const composer = '[data-tour="chat-composer"] textarea';
    const reply = 'a[href^="/notes/"]';
    const preview = '[data-note-text-surface="preview"]';
    const sendDraft = async (previous?: string) => {
      await chat.focus(composer);
      await chat.keyboard.press('Enter');
      await chat.waitForFunction((selector, prior) =>
        document.querySelectorAll(selector).length > 0 && [...document.querySelectorAll(selector)].at(-1)?.getAttribute('href') !== prior,
      {}, reply, previous ?? null);
      return chat.$$eval(reply, links => links.at(-1)!.getAttribute('href')!);
    };
    await chat.locator('[data-tour="shell-nav-item-chat"]').click();
    await chat.waitForSelector(composer, { timeout: 7000 }).catch(async error => {
      throw new Error(`Composer unavailable at ${chat.url()}. ${(await chat.$eval('body', node => node.innerText)).slice(0, 500)} ${pageErrors.join(' / ')}`, { cause: error });
    });
    await chat.locator('::-p-aria([name="Skip tour"])').click();
    await chat.waitForSelector('[aria-labelledby="product-tour-title"]', { hidden: true });
    expect(requests).toHaveLength(0);
    await chat.focus(composer);
    await chat.keyboard.sendCharacter('现在生成期权决策报告');
    const weekendHref = await sendDraft();
    const weekend = await api(weekendHref.replace('/notes/', '/api/notes/'), token);
    expect(weekend.status).toBe(200);
    const weekendNote = (await weekend.json()).note;
    expect(weekendNote.title).toBe(`Options decision report · ${manualNow.toISOString()}`);
    for (const expected of ['U.S. weekend', 'A same-session underlying quote in the contract currency is unavailable.',
      'Hold and accept possible assignment', 'Sell a covered call after assignment', 'Roll the put', 'Close the put']) {
      expect(weekendNote.body).toContain(expected);
    }
    await expect(api(weekendHref.replace('/notes/', '/api/notes/'), secondToken)).resolves.toHaveProperty('status', 404);
    // The preset prepares a draft in the same chat. This request makes a fresh
    // scan before the automatic window and its updated spot excludes the puts.
    manualNow = new Date(`${day}T11:59:55Z`);
    vi.mocked(yf.quote).mockResolvedValueOnce({ ...quote, preMarketPrice: 150 } as never);
    const preset = createInvageChatQuestionLibrary().presets!.find(entry => entry.id === 'option_decision_report')!;
    await chat.bringToFront();
    await chat.click('button[aria-label="Questions"]');
    const questionSearch = '[role="dialog"] input[aria-label="Search questions"]';
    await chat.waitForSelector(questionSearch);
    await chat.type(questionSearch, preset.title);
    const entry = await chat.waitForFunction(title =>
      [...document.querySelectorAll<HTMLButtonElement>('button[data-question-entry]')].find(button =>
        button.firstElementChild?.textContent === title && !button.disabled && button.getAttribute('aria-disabled') !== 'true') ?? null,
    {}, preset.title);
    const prepared = chat.waitForResponse(response => new URL(response.url()).pathname === `/api/questions/${HOST_AGENT_ID}/prepare`,
      { timeout: 8000 }).catch(async error => {
      throw new Error(`Question was not prepared. ${(await chat.$eval('body', node => node.innerText)).slice(-850)}`, { cause: error });
    });
    await entry.asElement()!.click();
    const preparedResponse = await prepared;
    expect(preparedResponse.ok()).toBe(true);
    const draft = `@${host.label} ${preset.template}`;
    expect(await preparedResponse.json()).toMatchObject({ text: draft });
    await chat.waitForFunction((selector, expected) =>
      document.querySelector<HTMLTextAreaElement>(selector)?.value === expected, {}, composer, draft).catch(async error => {
      throw new Error(`Prepared question did not populate the composer. ${(await chat.$eval('body', node => node.innerText)).slice(-850)}`, { cause: error });
    });
    expect(requests).toHaveLength(1);
    expect(scan).toHaveBeenCalledTimes(1);
    const sameDayHref = await sendDraft(weekendHref);
    expect(sameDayHref).not.toBe(weekendHref);
    expect(await chat.$eval('body', node => node.innerText)).toContain('No positions matched in the available broker snapshots.');
    const sameDay = await api(sameDayHref.replace('/notes/', '/api/notes/'), token);
    expect(sameDay.status).toBe(200);
    expect((await sameDay.json()).note.body).toContain('2026-11-23T11:59:50.000Z');
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.model).toBe('deepseek-v4-flash');
      expect(request.tools?.some(tool => tool.function.name === reportTool.name)).toBe(true);
    }
    expect(scan).toHaveBeenCalledTimes(2);
    expect(broker).toHaveBeenCalledTimes(2);
    const manualNotifications = (await inbox(token)).items;
    expect(manualNotifications).toHaveLength(2);
    expect(manualNotifications.map(({ title }: { title: string }) => title)).toEqual([
      'Options decision report', 'Options decision report',
    ]);
    expect(manualNotifications.map(({ href, body }: { href: string; body: string }) => [href, body])).toEqual(
      expect.arrayContaining([weekendHref, sameDayHref].map(href => [href, url + href])),
    );
    const chatLink = `a[href="${weekendHref}"]`;
    const renderedLink = await chat.$eval(chatLink, link => link.outerHTML);
    const chatLinkTarget = browser.waitForTarget(target => target.url() === url + weekendHref, { timeout: 8000 }).catch(error => {
      throw new Error(`Chat Notes link did not open ${renderedLink}. Browser targets: ${browser.targets().map(target => target.url()).join(', ')}`, { cause: error });
    });
    await chat.locator(chatLink).click();
    const openedChatNote = await (await chatLinkTarget).page();
    expect(openedChatNote).not.toBeNull();
    await openedChatNote!.waitForFunction(selector => document.querySelector(selector)?.textContent?.includes('Close the put'),
      { timeout: 8000 }, preview);
    await openedChatNote!.close();
    await page.bringToFront();
    await page.goto(`${url}/settings/premarket-options`, { waitUntil: 'domcontentloaded' });
    frame = await (await settingsFrame())!.contentFrame();
    await frame!.waitForSelector('#enabled:not([disabled])');
    expect(await frame!.$eval('#enabled', input => (input as HTMLInputElement).checked)).toBe(false);
    await tick(now);
    expect(scan).toHaveBeenCalledTimes(2);
    const createNote = runtime.notes.create.bind(runtime.notes);
    const noteWrites = vi.spyOn(runtime.notes, 'create')
      .mockRejectedValueOnce(new Error('Fixture note storage unavailable'))
      .mockImplementationOnce(async note => {
        await createNote(note);
        throw new Error('Fixture interruption after the note was committed');
      });
    await page.bringToFront();
    await frame!.click('#enabled');
    await frame!.click('#save');
    await frame!.waitForFunction(() => document.querySelector('#message')?.textContent === 'Daily short-put scan is on.', { timeout: 8000 });
    await tick(new Date('2026-11-23T11:59:00Z'));
    await tick(new Date('2026-11-26T12:00:00Z'));
    expect(broker).toHaveBeenCalledTimes(2);
    await tick(now);
    expect((await notes(token)).items).toHaveLength(2);
    expect((await inbox(token)).items).toHaveLength(2);
    expect(send).not.toHaveBeenCalled();
    await tick(new Date('2026-11-23T12:01:00Z'));
    expect((await notes(token)).items).toHaveLength(3);
    expect((await inbox(token)).items).toHaveLength(2);
    await tick(new Date('2026-11-23T12:02:00Z'));
    await tick(new Date('2026-11-23T12:03:00Z'));
    expect(broker).toHaveBeenCalledTimes(3);
    expect(broker.mock.calls.every(([state]) => state.user.id === owner)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(new Set(noteWrites.mock.calls.map(([note]) => note.id)).size).toBe(1);

    const ownInbox = await inbox(token);
    expect(ownInbox.items).toHaveLength(3);
    expect((await inbox(secondToken)).items).toEqual([]);
    const { href, body, title } = ownInbox.items.find((item: { title: string }) => item.title === 'Premarket options report');
    const ownedNotes = (await notes(token)).items;
    expect(ownedNotes).toHaveLength(3);
    const dailyNote = ownedNotes.find((item: { title: string }) => item.title === `Premarket options · ${day}`);
    const noteId = dailyNote.id;
    expect(dailyNote).toMatchObject({ kind: 'markdown', title: `Premarket options · ${day}` });
    expect({ href, body, title }).toEqual({ href: `/notes/${noteId}`, body: `${url}/notes/${noteId}`, title: 'Premarket options report' });
    const stored = await api(`/api/notes/${noteId}`, token);
    expect(stored.status).toBe(200);
    expect((await stored.json()).note).toMatchObject({ owner_user_id: owner, provenance: 'system',
      body: expect.stringContaining('1 confirmed triggers') });
    expect((await notes(secondToken)).items).toEqual([]);
    expect((await api(`/api/notes/${noteId}?ownerUserId=${owner}`, secondToken)).status).toBe(404);

    const inboxPage = await page.browserContext().newPage();
    inboxPage.setDefaultTimeout(8000);
    await inboxPage.goto(`${url}/notifications`, { waitUntil: 'domcontentloaded' });
    const manualLink = await inboxPage.waitForSelector(`a[href="${sameDayHref}"]`);
    const openedManual = browser.waitForTarget(target => target.url() === url + sameDayHref, { timeout: 8000 });
    await manualLink!.click();
    await openedManual;
    await inboxPage.bringToFront();
    const link = await inboxPage.waitForSelector(`a[href="${href}"]`);
    const opened = browser.waitForTarget(target => target.url() === url + href, { timeout: 8000 });
    await link!.click();
    await opened;
    // Verify rendered content using an owned page while the popup initializes.
    const report = await page.browserContext().newPage();
    report.setDefaultTimeout(8000);
    await report.goto(url + href, { waitUntil: 'domcontentloaded', timeout: 8000 });
    await report.waitForFunction(selector => document.querySelector(selector)?.textContent?.includes('Close the put'),
      { timeout: 8000 }, preview);
    const headings = await report.$$eval(`${preview} h4`, nodes => nodes.map(node => node.textContent));
    expect(headings).toEqual(['Hold and accept possible assignment', 'Sell a covered call after assignment', 'Roll the put', 'Close the put']);
    expect(await report.$$eval(`${preview} h3`, nodes => nodes.length)).toBe(1);
    const contents = await report.$eval(preview, node => node.textContent);
    for (const detail of ['USD 10,000', 'USD 1,500', expiry, rollExpiry, 'SHA-256', 'New exercise cash / shares received']) {
      expect(contents).toContain(detail);
    }
    await page.bringToFront();
    await frame!.click('#enabled');
    await frame!.click('#save');
    await frame!.waitForFunction(() => document.querySelector('#message')?.textContent === 'Daily short-put scan is off.', { timeout: 8000 });
    await tick(new Date('2026-11-24T12:00:00Z'));
    expect(broker).toHaveBeenCalledTimes(3);
    expect((await inbox(token)).items).toHaveLength(3);
    expect((await notes(token)).items).toHaveLength(3);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await framework.stop();
    await management.pool.end();
    modelServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => modelServer.close(error => error ? reject(error) : resolve()));
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 45000);
