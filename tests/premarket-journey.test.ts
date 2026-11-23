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
import { REPORT_ARCHIVE_NAME } from '../src/premarket/report.js';

const modelServer = await vi.hoisted(async () => {
  const { createServer } = await import('node:http');
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  vi.stubEnv('UTARUS_AGENT_NAME', 'Velovest');
  vi.stubEnv('INVAGE_PRODUCT_PROFILE', 'consultant');
  vi.stubEnv('INVAGE_REQUIRE_BOOKS_FOR_PORTFOLIO', 'true');
  vi.stubEnv('UTARUS_DYNAMIC_WORKFLOWS', 'true');
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
const cloudAccount = '101';
const cloudKey = await readFile(new URL('./fixtures/moomoo/ed25519-private.pem', import.meta.url), 'utf8');
function fixture(userId: string): InvestorState {
  return {
    user: { id: userId, created_at: day, auth_token: randomUUID() },
    profile: { display_name: 'Fixture investor', contact_email: `${userId}@test.local`, language: 'en' }, log: [],
    broker_sources: { source: { broker_id: 'ibkr', credentials: { token: 'fixture' } },
      cloud: { broker_id: 'futubull', credentials: { app_key: 'fixture-cloud', private_key: cloudKey } } },
    broker_connections: { primary: { broker_id: 'ibkr', source_id: 'source', channel: 'ibkr', label: 'Fixture broker',
      account_id: account, enabled: true, config: { activity_query_id: '1' } },
      futu: { broker_id: 'futubull', source_id: 'cloud', channel: 'futubull', label: 'Fixture Futu',
        account_id: cloudAccount, enabled: true, config: { acc_id: cloudAccount } } },
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
  <OpenPositions>${openPosition(expiry, 100, -1, 42)}${openPosition('2026-12-18', 90, -1, 43)}${openPosition('2026-12-22', 110, -1, 44)}${openPosition(expiry, 110, 0, 45)}</OpenPositions>
  <CashReport><CashReportCurrency accountId="${account}" currency="USD" endingCash="99999" /></CashReport>
  </FlexStatement></FlexStatements></FlexQueryResponse>`);
}

function cloudMarketFixture() {
  const definitions = [
    { expiry, strike: 100, right: 'PUT', bid: 13, ask: 16 },
    { expiry: rollExpiry, strike: 95, right: 'PUT', bid: 16, ask: 17 },
    { expiry: rollExpiry, strike: 97, right: 'PUT', bid: 16.5, ask: 17.5 },
    ...[expiry, rollExpiry].map(date => ({ expiry: date, strike: 115, right: 'CALL', bid: 3, ask: 4 })),
    { expiry: rollExpiry, strike: 120, right: 'CALL', bid: 4.5, ask: 5 },
  ];
  const contracts = definitions.map(item => ({ ...item, code: `US.AMD${item.expiry.slice(2).replaceAll('-', '')}${item.right[0]}${item.strike * 1000}` }));
  const [held, replacement, alternative, heldCall, , callRoll] = contracts;
  const snapshotTime = '2026-11-20T20:58:00.000Z';
  const exchangeTime = '2026-11-20T20:59:20.000Z';
  const replacementTime = '2026-11-20T20:59:25.000Z';
  let noCreditRolls = false;
  const originalFetch = globalThis.fetch;
  const chains: Array<{ from: string | null; through: string | null; requestedAt: number }> = [];
  const bookCodes: string[] = [];
  vi.stubGlobal('fetch', (async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname === '127.0.0.1') return originalFetch(input, init);
    expect(url.hostname).toBe('webapi.futunn.com');
    expect(new Headers(init?.headers).get('X-Api-Key')).toBe('fixture-cloud');
    const reply = (data: unknown) => Response.json({ ret_code: 0, data });
    switch (url.pathname) {
      case '/api/v1.0/accounts/authorized_trd_accs':
        return Response.json({ s: 'ok', d: { accounts: [{ account_id: cloudAccount }] } });
      case `/api/v1.0/accounts/${cloudAccount}/funds`:
        return Response.json({ s: 'ok', d: { currency: 'USD', us_cash: '10000' } });
      case `/api/v1.0/accounts/${cloudAccount}/positions`:
        return Response.json({ s: 'ok', d: [
          { code: heldCall.code, qty: '-2', position_side: 'SHORT', currency: 'USD',
            contract_size: 100, cost_price: '3', cost_price_valid: true, nominal_price: '4' },
          { code: 'US.AMD', qty: '150', position_side: 'LONG', currency: 'USD',
            cost_price: '95', cost_price_valid: true, nominal_price: '110' },
        ] });
      case '/api/v1.0/quote/US.AMD/corporate-actions/dividends':
        return reply({ dividend_list: [] });
      case '/api/v1.0/quote/US.AMD/corporate-actions/splits':
        return reply({ split_list: [] });
      case '/api/v1.0/quote/US.AMD/option-expiration':
        return reply({ expiration_list: [expiry, rollExpiry].map(strike_time => ({ strike_time })) });
      case '/api/v1.0/quote/US.AMD/option-chain': {
        const from = url.searchParams.get('start'), through = url.searchParams.get('end');
        chains.push({ from, through, requestedAt: Date.now() });
        if (chains.length === 1) return Response.json({ ret_code: -11 }, { headers: { 'Retry-After': '1' } });
        return reply({ option_chain: contracts.filter(item => from && through && item.expiry >= from && item.expiry <= through)
          .map(item => ({ code: item.code, stock_owner: 'US.AMD', strike_time: item.expiry, strike_price: item.strike,
            option_type: item.right, lot_size: 100, option_standard_type: 'STANDARD' })) });
      }
      case '/api/v1.0/quote/snapshot': {
        const { code_list } = JSON.parse(String(init?.body));
        expect(code_list).toEqual(contracts.map(item => item.code));
        return reply({ snapshot_list: contracts.map(item => ({ code: item.code, option_valid: true, option_type: item.right,
          option_strike_price: item.strike, option_contract_size: 100, option_contract_multiplier: '100',
          option_area_type: 'AMERICAN', bid_price: noCreditRolls && [replacement.code, alternative.code].includes(item.code) ? 14 : item.bid,
          ask_price: item.ask, bid_vol: 23, ask_vol: 19, volume: 0,
          option_open_interest: 20, option_implied_volatility: 38, delta: -.3, gamma: .04, theta: -.02, vega: .1, rho: -.01,
          update_time: Date.parse(snapshotTime), data_date: snapshotTime.slice(0, 10) })) });
      }
      case '/api/v1.0/quote/order-book': {
        const { code } = JSON.parse(String(init?.body));
        bookCodes.push(code);
        expect([held.code, replacement.code, alternative.code, heldCall.code, callRoll.code]).toContain(code);
        const isReplacement = code !== held.code && code !== heldCall.code;
        const call = code === heldCall.code ? heldCall : code === callRoll.code ? callRoll : null;
        return reply([{ code, books: [{ exchange: 'US', order_volume_precision: 0,
          exchange_data_time_ms: Date.parse(isReplacement ? replacementTime : exchangeTime), bid_flag: 1, ask_flag: 1,
          bid_list: [{ price: call?.bid ?? (code === alternative.code ? 17 : 14), volume: 39 }],
          ask_list: [{ price: call?.ask ?? (isReplacement ? 18 : 15), volume: 33 }] }] }]);
      }
      default:
        throw new Error(`Unexpected test market endpoint ${url.pathname}`);
    }
  }) satisfies typeof fetch);
  return { chains, bookCodes, snapshotTime, exchangeTime, replacementTime, heldCode: held.code, replacementCode: replacement.code,
    alternativeCode: alternative.code, heldCallCode: heldCall.code, callRollCode: callRoll.code,
    removeCreditRolls() { noCreditRolls = true; } };
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
  const market = cloudMarketFixture();
  const calendar = vi.fn(async (date: string) => readTradingDay(date, async () =>
    new Response('Holiday Name,Date,Regular Trading Hours,Global Trading Hours\nThanksgiving,2026-11-26,None,None\n')));
  const scan = vi.fn((...args: Parameters<typeof scanPremarket>) =>
    scanPremarket(args[0], args[1], args[2], args[3], {
      readBrokerPositionSnapshot: async (state, id) => {
        if (id === 'primary') return broker(state, id);
        const snapshot = await readBrokerPositionSnapshot(state, id);
        expect(snapshot.statement.account_id).toBe(cloudAccount);
        expect(snapshot.statement.lots).toEqual(expect.arrayContaining([
          expect.objectContaining({ ticker: 'AMD', holding: expect.objectContaining({ units: 150, instrument: 'equity' }) }),
          expect.objectContaining({ holding: expect.objectContaining({ units: 2, option: expect.objectContaining({ right: 'call', side: 'short' }) }) }),
        ]));
        // The Cloud account fixture describes the fixed U.S. trading date.
        return { ...snapshot, statement: { ...snapshot.statement, as_of: day } };
      },
    }));
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
    quote.preMarketPrice = 95;
    await chat.focus(composer);
    await chat.keyboard.sendCharacter('现在生成期权决策报告');
    const weekendHref = await sendDraft();
    const weekend = await api(weekendHref.replace('/notes/', '/api/notes/'), token);
    expect(weekend.status).toBe(200);
    const weekendNote = (await weekend.json()).note;
    expect(weekendNote.title).toBe(`Options decision report · ${manualNow.toISOString()}`);
    for (const expected of ['U.S. weekend', 'Same-session stock prices were unavailable for all positions shown',
      'Historical quote from', 'Historical order book from', '## Cash needed if assigned, by stock', 'USD 10,000 for positions with verified share deliverables',
      '1 with unknown assignment cash', 'Buying back the puts would cost USD 1,500', 'If assigned, you would pay USD 10,000 for 100 shares',
      'Breakeven USD 90 per share for the current put', 'a gain of USD 500 for the current put before future charges', 'Whole-strategy figures are unavailable',
      'Credit roll with less cash due if assigned and a later expiry', 'the credit would be USD 198 after estimated fees (USD 200 before fees)',
      'Selling the USD 97 put expiring Jan 15, 2027 would bring in USD 1,700',
      'you would pay USD 9,700 for 100 shares, compared with USD 10,000 on the current put',
      'The new put expires 25 days later than the current put',
      'USD 17 bid and USD 18 ask per unit. Historical order book from Nov 20, 2026 at 20:59:25 UTC',
      '## Urgent short calls', 'AMD USD 115 call', 'Urgency needs a same-session price',
      'If assigned, you would deliver 200 shares and receive USD 23,000 before charges',
      'The broker snapshot shows 150 shares in this account', 'Buying back the calls would cost USD 800',
      'Credit roll to a higher strike', 'the credit would be USD 97.4 after estimated fees (USD 100 before fees)',
      'Selling the USD 120 call expiring Jan 15, 2027 would bring in USD 900', '## Appendix', REPORT_ARCHIVE_NAME]) {
      expect(weekendNote.body).toContain(expected);
    }
    await expect(api(weekendHref.replace('/notes/', '/api/notes/'), secondToken)).resolves.toHaveProperty('status', 404);
    const weekendAttachments = weekendHref.replace('/notes/', '/api/notes/') + '/attachments';
    const { items: [weekendArchive] } = await (await api(weekendAttachments, token)).json();
    expect(weekendArchive.name).toBe(REPORT_ARCHIVE_NAME);
    const fullWeekend = await api(`${weekendAttachments}/${weekendArchive.id}`, token);
    expect(fullWeekend.status).toBe(200);
    const fullWeekendText = await fullWeekend.text();
    for (const detail of ['A same-session underlying quote in the contract currency is unavailable.',
      '39 / 33', market.exchangeTime, market.snapshotTime, 'futubull Cloud /api/v1.0/quote/order-book',
      'Hold and accept possible assignment', 'Sell a covered call after assignment', 'Roll the put', 'Close the put',
      'Current put breakeven per share before future charges', 'Current put expiry P&amp;L at scan stock price before future charges',
      'New exercise cash / shares received', '23 / 19', 'USD 1,700', 'USD -100 / USD -102', market.replacementTime,
      'futubull Cloud chain unavailable for 2026-12-22.', 'Roll the call', 'Shares to deliver / proceeds if assigned before charges',
      'USD 115 call · reference roll cash USD -200']) {
      expect(fullWeekendText).toContain(detail);
    }
    expect(weekendNote.body).not.toContain('39 / 33');
    expect(weekendNote.body).not.toContain('Selling the USD 95 put');
    expect(market.bookCodes).toEqual([market.heldCode, market.heldCallCode, market.replacementCode, market.callRollCode, market.alternativeCode]);
    expect(market.chains.map(({ from, through }) => [from, through])).toEqual([
      ['2026-12-18', rollExpiry], ['2026-12-18', rollExpiry], ['2026-12-18', '2026-12-18'], ['2026-12-22', '2026-12-22'],
    ]);
    expect(market.chains[1].requestedAt - market.chains[0].requestedAt).toBeGreaterThanOrEqual(1000);
    expect((await api(`${weekendAttachments}/${weekendArchive.id}`, secondToken)).status).toBe(404);
    // The preset prepares a draft in the same chat. This request makes a fresh
    // scan before the automatic window and its updated spot excludes the puts.
    manualNow = new Date(`${day}T11:59:55Z`);
    quote.preMarketPrice = 110;
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
    const sameDayNote = (await sameDay.json()).note;
    expect(sameDayNote.body).toContain('No positions met the scan criteria');
    expect(sameDayNote.body).toContain(REPORT_ARCHIVE_NAME);
    expect(sameDayNote.body).not.toContain('2026-11-23T11:59:50.000Z');
    const sameDayAttachments = sameDayHref.replace('/notes/', '/api/notes/') + '/attachments';
    const { items: [sameDayArchive] } = await (await api(sameDayAttachments, token)).json();
    expect(sameDayArchive.name).toBe(REPORT_ARCHIVE_NAME);
    expect(await (await api(`${sameDayAttachments}/${sameDayArchive.id}`, token)).text()).toContain('2026-11-23T11:59:50.000Z');
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
    await openedChatNote!.waitForSelector(`${preview} h3`, { visible: true, timeout: 8000 });
    expect(await openedChatNote!.$eval(preview, node => node.textContent)).toContain('the credit would be USD 198 after estimated fees');
    expect(await openedChatNote!.$eval(preview, node => node.textContent)).toContain('Breakeven USD 90 per share for the current put');
    expect(await openedChatNote!.$$eval(`${preview} h3`, nodes => nodes.map(node => node.textContent?.split(' · ')[0])))
      .toEqual(['AMD USD 110 put', 'AMD USD 100 put', 'AMD USD 90 put', 'AMD USD 115 call']);
    await openedChatNote!.waitForSelector(`a[aria-label="Download ${REPORT_ARCHIVE_NAME}"]`, { visible: true });
    const noteTimes = '[aria-label="Note timestamps"] time';
    await openedChatNote!.waitForSelector(noteTimes, { visible: true });
    expect(await openedChatNote!.$$eval(noteTimes, times => times.map(time => time.getAttribute('datetime'))))
      .toEqual([weekendNote.created_at, weekendNote.updated_at]);
    await openedChatNote!.close();
    market.removeCreditRolls();
    await page.bringToFront();
    await page.goto(`${url}/settings/premarket-options`, { waitUntil: 'domcontentloaded' });
    frame = await (await settingsFrame())!.contentFrame();
    await frame!.waitForSelector('#enabled:not([disabled])');
    expect(await frame!.$eval('#enabled', input => (input as HTMLInputElement).checked)).toBe(false);
    await tick(now);
    expect(scan).toHaveBeenCalledTimes(2);
    const createNote = runtime.notes.createInTransaction.bind(runtime.notes);
    const noteWrites = vi.spyOn(runtime.notes, 'createInTransaction')
      .mockRejectedValueOnce(new Error('Fixture note storage unavailable'))
      .mockImplementationOnce(async (client, note) => {
        await createNote(client, note);
        throw new Error('Fixture interruption before attachment publication');
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
    expect((await notes(token)).items).toHaveLength(2);
    expect((await inbox(token)).items).toHaveLength(2);
    await tick(new Date('2026-11-23T12:02:00Z'));
    await tick(new Date('2026-11-23T12:03:00Z'));
    expect(broker).toHaveBeenCalledTimes(3);
    expect(broker.mock.calls.every(([state]) => state.user.id === owner)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(new Set(noteWrites.mock.calls.map(([, note]) => note.id)).size).toBe(1);

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
      body: expect.stringContaining('2 positions meet the scan criteria') });
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
    await report.waitForSelector(`${preview} li`, { timeout: 8000 });
    const headings = await report.$$eval(`${preview} h2`, nodes => nodes.map(node => node.textContent));
    expect(headings).toEqual(['Positions to review', 'Urgent short calls', 'Appendix']);
    expect(await report.$$eval(`${preview} h3`, nodes => nodes.length)).toBe(2);
    const contents = await report.$eval(preview, node => node.textContent);
    for (const detail of ['If assigned, you would pay USD 10,000 for 100 shares', 'Buying back the puts would cost USD 1,500', 'expires Dec 21, 2026', REPORT_ARCHIVE_NAME,
      'Historical order book from', 'a loss of USD 500 for the current put before the closing fee',
      'No credit roll was found in the available quotes', 'Expires in 28 calendar days',
      'AMD USD 115 call', 'If assigned, you would deliver 200 shares and receive USD 23,000 before charges',
      'The broker snapshot shows 150 shares in this account', 'Credit roll to a higher strike',
      'The new call expires 25 days later than the current call',
      'Breakeven USD 90 per share for the current put', 'a gain of USD 1,000 for the current put before future charges', 'Whole-strategy figures are unavailable']) {
      expect(contents).toContain(detail);
    }
    const dailyAttachments = `/api/notes/${noteId}/attachments`;
    const { items: [dailyArchive] } = await (await api(dailyAttachments, token)).json();
    expect(dailyArchive.name).toBe(REPORT_ARCHIVE_NAME);
    const completeDaily = await (await api(`${dailyAttachments}/${dailyArchive.id}`, token)).text();
    for (const detail of [rollExpiry, 'New exercise cash / shares received', 'USD 1,400', 'USD -100 / USD -102',
      'SHA-256', '39 / 33', market.exchangeTime]) {
      expect(completeDaily).toContain(detail);
    }
    for (const detail of ['SHA-256', '39 / 33', 'New exercise cash / shares received', 'Credit roll with']) expect(contents).not.toContain(detail);
    await report.setViewport({ width: 390, height: 844 });
    await report.waitForSelector(`${preview} li`, { visible: true });
    expect(await report.$eval(preview, node => node.scrollWidth)).toBe(await report.$eval(preview, node => node.clientWidth));
    expect(market.bookCodes).toEqual([market.heldCode, market.heldCallCode, market.replacementCode, market.callRollCode,
      market.alternativeCode, market.heldCode, market.heldCallCode, market.callRollCode]);
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
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 45000);
