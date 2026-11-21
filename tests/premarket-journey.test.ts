import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import puppeteer from 'puppeteer-core';
import { createSession, createState, createFramework } from 'utarus';
import { useTestDatabase } from './helpers/database.js';
import { buildInvageApp } from '../src/webapp/server.js';
import { createInvageChromeCatalogs, createInvageWebUi } from '../src/webapp/invage-webui.js';
import { INVAGE_CREDIT_RATES } from '../src/credit-rates.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { readBrokerPositionSnapshot } from '../src/brokers/accounts.js';
import { yf } from '../src/market/yf-client.js';
import { runPremarketScans } from '../src/premarket/scheduler.js';
import { scanPremarket } from '../src/premarket/scan.js';
import { readTradingDay } from '../src/premarket/session.js';

vi.hoisted(() => {
  // The shell reads model metadata at login. No model requests leave this test.
  vi.stubEnv('DEEPSEEK_API_KEY', 'isolated-fixture');
  vi.stubEnv('UTARUS_LLM_PROVIDER', 'deepseek');
  vi.stubEnv('UTARUS_LLM_MODEL', 'deepseek-v4-flash');
  vi.stubEnv('UTARUS_LLM_BASE_URL', 'http://127.0.0.1:1');
  vi.stubEnv('UTARUS_LLM_PROFILES', '');
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

it('runs the opted-in browser journey with PostgreSQL, native Flex parsing, options evidence, and the owner inbox', async () => {
  const root = await mkdtemp(join(tmpdir(), 'velovest-premarket-'));
  vi.stubEnv('UTARUS_DATA_ROOT', root);
  vi.stubEnv('UTARUS_REPORTS_URL', 'http://127.0.0.1');
  vi.stubEnv('INVAGE_PRODUCT_PROFILE', 'consultant');
  vi.stubEnv('INVAGE_REQUIRE_BOOKS_FOR_PORTFOLIO', 'true');
  const { runtime } = await useTestDatabase();
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
  const tick = (at: Date) => runPremarketScans(at, { readTradingDay: calendar, scanPremarket: (snapshot, session, startedAt, archive) =>
    scanPremarket(snapshot, session, startedAt, archive, { readBrokerPositionSnapshot: broker }) });
  const framework = await createFramework({
    database: runtime, startTaskScheduler: false, startLifecycleMailScheduler: false, startWorkflowRuntime: false,
    extension: {
      purpose: 'Isolated Velovest premarket journey', tools: [], skills: [], webUi: createInvageWebUi(),
      billing: { creditRates: INVAGE_CREDIT_RATES },
      l10n: { defaultLanguage: 'en', languages: ['en'], catalogs: createInvageChromeCatalogs() },
    },
  });
  const server = buildInvageApp(framework).listen(0, '127.0.0.1');
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await createState(fixture(owner));
    await createState(fixture(second));
    const auth = (userId: string) => createSession({ type: 'user', userId, displayName: 'Fixture investor' });
    const [token, secondToken] = await Promise.all([auth(owner), auth(second)]);
    browser = await puppeteer.launch({ executablePath: process.env.TEST_CHROMIUM_PATH ?? '/usr/bin/chromium',
      protocolTimeout: 8000, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(8000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    await page.setCookie({ name: 'bindrive_session', value: token, url });
    const nav = await page.goto(`${url}/settings/premarket-options`, { waitUntil: 'domcontentloaded' });
    expect(nav?.status()).toBe(200);
    const manifest = await page.evaluate(async () => {
      const response = await fetch('/api/webui/manifest');
      return { status: response.status, manifest: await response.json() };
    });
    expect(manifest.status).toBe(200);
    expect(manifest.manifest.visibleSettingsSections).toContain('premarket-options');
    const element = await page.waitForSelector('iframe[src*="/settings/premarket/"]', { timeout: 8000 }).catch(async error => {
      throw new Error(`Settings frame unavailable at ${page.url()}. ${(await page.$eval('body', node => node.innerText)).slice(0, 500)} ${pageErrors.join(' / ')}`, {cause:error});
    });
    const frame = await element!.contentFrame();
    await frame!.waitForSelector('#enabled:not([disabled])', { timeout: 8000 });
    expect(await frame!.$eval('#enabled', input => (input as HTMLInputElement).checked)).toBe(false);
    await tick(now);
    expect(calendar).not.toHaveBeenCalled();
    expect(broker).not.toHaveBeenCalled();
    await frame!.click('#enabled');
    await frame!.click('#save');
    await frame!.waitForFunction(() => document.querySelector('#message')?.textContent === 'Daily short-put scan is on.', { timeout: 8000 });
    await tick(new Date('2026-11-23T11:59:00Z'));
    await tick(new Date('2026-11-26T12:00:00Z'));
    expect(broker).not.toHaveBeenCalled();
    await tick(now);
    await tick(new Date('2026-11-23T12:01:00Z'));
    expect(broker).toHaveBeenCalledTimes(1);
    expect(broker.mock.calls[0][0].user.id).toBe(owner);
    const inbox = async (session: string) => (await fetch(`${url}/api/notifications`, {
      headers: { Cookie: `bindrive_session=${session}` }, signal: AbortSignal.timeout(8000),
    })).json();
    const ownInbox = await inbox(token);
    expect(ownInbox.items).toHaveLength(1);
    expect(ownInbox.items[0].body).toContain('1 confirmed triggers');
    expect((await inbox(secondToken)).items).toEqual([]);
    const { href } = ownInbox.items[0];
    const inboxPage = await page.browserContext().newPage();
    await inboxPage.goto(`${url}/notifications`, { waitUntil: 'domcontentloaded' });
    const link = await inboxPage.waitForSelector(`a[href="${href}"]`);
    await Promise.all([browser.waitForTarget(t => t.url() === url + href, { timeout: 8000 }), link!.click()]);
    // Attachment to a popup can race its initialization. Read the same authenticated
    // document via an owned page after observing the browser open the inbox link.
    const report = await page.browserContext().newPage();
    await report.setCacheEnabled(false);
    expect((await report.goto(url + href, { waitUntil: 'domcontentloaded', timeout: 8000 }))?.status()).toBe(200);
    await report.waitForSelector('article h3', { timeout: 8000 });
    const contents = await report.$eval('body', node => node.textContent);
    for (const heading of ['Hold and accept possible assignment', 'Sell a covered call after assignment', 'Roll the put', 'Close the put',
      'USD 10,000', 'USD 1,500', expiry, rollExpiry, 'SHA-256']) expect(contents).toContain(heading);
    expect(await report.$$eval('article', rows => rows.length)).toBe(1);
    const foreign = await fetch(url + href + `?slug=${owner}`, { headers: { Cookie: `bindrive_session=${secondToken}` }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    expect(foreign.ok).toBe(false);
    await page.bringToFront();
    await frame!.click('#enabled');
    await frame!.click('#save');
    await frame!.waitForFunction(() => document.querySelector('#message')?.textContent === 'Daily short-put scan is off.', { timeout: 8000 });
    await tick(new Date('2026-11-24T12:00:00Z'));
    expect(broker).toHaveBeenCalledTimes(1);
    expect((await inbox(token)).items).toHaveLength(1);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await framework.stop();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}, 45000);
