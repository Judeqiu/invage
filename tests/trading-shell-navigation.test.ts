import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import puppeteer, { type Page } from 'puppeteer-core';
import { buildWebUiManifest } from 'utarus';
import { expect, it, vi } from 'vitest';
import { createInvageChromeCatalogs, createInvageWebUi } from '../src/webapp/invage-webui.js';
import { tradingShellFirstPaint } from '../src/webapp/trading-shell.js';

const composer = '[data-tour="chat-composer"] textarea';
const chatTab = '[data-tour="shell-nav-item-chat"]';

async function waitForDashboard(page: Page) {
  await page.waitForFunction(() => location.pathname === '/dashboard' &&
    document.querySelector<HTMLIFrameElement>('iframe.domain-page-frame')?.contentDocument
      ?.querySelector('#loadProgress')?.getAttribute('aria-valuenow') === '8');
}

async function waitForChat(page: Page) {
  await page.waitForSelector(composer, { visible: true });
  expect(new URL(page.url()).pathname).toBe('/');
  expect(await page.$eval(chatTab, tab => tab.getAttribute('aria-current'))).toBe('page');
  expect(await page.$('iframe.domain-page-frame')).toBeNull();
}

it('opens AI Chat on the first tap after a direct entry and preserves the browser history', async () => {
  vi.stubEnv('INVAGE_PRODUCT_PROFILE', 'consultant');
  vi.stubEnv('UTARUS_AGENT_NAME', 'Velovest');
  const manifest = buildWebUiManifest({ webUi: createInvageWebUi() } as Parameters<typeof buildWebUiManifest>[0]);
  const catalog = JSON.parse(readFileSync('node_modules/utarus/src/l10n/en.json', 'utf8'));
  const userId = randomUUID();
  const conversationId = randomUUID();
  const timestamp = new Date().toISOString();
  const existingReply = 'Reply from the saved discussion.';
  const user = { type: 'user', userId, displayName: 'Navigation test' };
  const language = { language: 'en', languages: ['en'], defaultLanguage: 'en',
    catalogs: { en: { ...catalog, ...createInvageChromeCatalogs('consultant').en } },
    countries: [], languageByCountry: {} };
  const fixtures = new Map<string, unknown>([
    ['/api/chat/agent', { ...user, agentName: 'Velovest', isStreaming: false }],
    ['/api/onboard/login-config', { ...language, defaultPath: manifest.defaultPath, productName: manifest.productName }],
    ['/api/onboard/profile/l10n', { ...language, location: null, needsLanguagePick: false }],
    ['/api/onboard/profile/preferences', { conversation_font_size: 'sm', product_tour_completed: true, product_tour_version: 1 }],
    ['/api/webui/manifest', { ...manifest, nav: manifest.nav.filter(item => !item.adminOnly) }],
    ['/api/domain/invage/dashboard', { empty: true, productProfile: 'consultant', model: null }],
    ['/api/domain/invage/broker-sync/status', { running: false, updatedAt: null, items: [] }],
    ['/api/chat/conversations', { conversations: [] }],
    [`/api/chat/conversations/${conversationId}`, { id: conversationId, title: 'Saved discussion',
      messages: [{ id: randomUUID(), role: 'assistant', text: existingReply, created_at: timestamp }],
      created_at: timestamp, updated_at: timestamp }],
    ['/api/chat/agents', { agents: [], multi_local: false, agent_api_enabled: false }],
    ['/api/questions', { agents: [] }],
    ['/api/orgs/context', { enabled: false, required: false, org: null, members: [] }],
    ['/api/agent/v1/me/connections', { connections: [] }],
    ['/api/agent/v1/me/authority-connections', { supported: false, connections: [] }],
    ['/api/embeds', { embeds: [] }],
  ]);
  const app = express();
  const dist = 'node_modules/utarus/web/dist';
  const index = readFileSync(`${dist}/index.html`, 'utf8');
  app.use(tradingShellFirstPaint);
  app.use('/assets', express.static(`${dist}/assets`));
  app.use('/domain-assets/invage', express.static('webui'));
  app.get('/login', (_req, res) => res.type('html').send(readFileSync('webui/login/shell.html', 'utf8')));
  app.use('/login', express.static('node_modules/utarus/login-static'));
  app.post('/api/onboard/login', (_req, res) => res.json(user));
  app.get('/api/chat/live', (_req, res) => res.type('text/event-stream').end());
  app.get(/^\/api\//, (req, res) => res.json(fixtures.get(req.path) ?? { count: 0 }));
  app.get(['/', '/dashboard'], (_req, res) => res.type('html').send(index));
  const server = app.listen(0, '127.0.0.1');
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_BINARY || '/usr/bin/chromium',
      headless: true, pipe: true, args: ['--no-sandbox', '--ozone-platform=headless'] });
    for (const viewport of [
      { width: 390, height: 844, isMobile: true, hasTouch: true },
      { width: 1440, height: 900, isMobile: false, hasTouch: false },
    ]) {
      const context = await browser.createBrowserContext();
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        await page.setViewport(viewport);
        await page.setRequestInterception(true);
        page.on('request', request => {
          const url = new URL(request.url());
          return url.origin === origin || url.protocol === 'data:' ? request.continue() : request.abort();
        });
        const openChat = async () => {
          const button = (await page.waitForSelector(chatTab, { visible: true }))!;
          await button.scrollIntoView();
          if (viewport.hasTouch) await button.tap();
          else await button.click();
          await waitForChat(page);
        };

        await page.goto(`${origin}/dashboard`, { waitUntil: 'domcontentloaded' });
        await waitForDashboard(page);
        await openChat();
        await page.evaluate(() => history.back());
        await waitForDashboard(page);
        await page.evaluate(() => history.forward());
        await waitForChat(page);

        await page.evaluate(() => sessionStorage.clear());
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await waitForDashboard(page);
        await openChat();

        await page.evaluate(() => sessionStorage.clear());
        await page.goto(`${origin}/?c=${conversationId}`, { waitUntil: 'domcontentloaded' });
        await waitForChat(page);
        await page.waitForFunction(reply => document.querySelector('main')?.textContent?.includes(reply), {}, existingReply);
        await page.locator('[data-tour="shell-nav-item-dashboard"]').click();
        await waitForDashboard(page);
        await openChat();

        await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
        await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-login-ready="true"]');
        await page.locator('#identifier').fill('navigation@example.invalid');
        await page.locator('#password').fill(randomUUID());
        await page.focus('#password');
        await page.keyboard.press('Enter');
        await waitForDashboard(page);
        await openChat();
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.unstubAllEnvs();
  }
}, 45_000);
