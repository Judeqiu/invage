/**
 * CDP smoke test — drives system Chrome via puppeteer-core.
 *
 * Flow:
 *  1. Open https://chat.investor.lextok.com
 *  2. Login with auth_token (Token tab)
 *  3. Send a message
 *  4. Listen to /api/chat/stream/* SSE for ack → tool events → done
 *  5. Capture assistant reply text
 *
 * Pass criteria:
 *  - HTTP 200 on /health, /, /api/onboard/login
 *  - SSE delivers at least one { type: 'ack' } and a final { type: 'done' | 'end' }
 *  - Assistant reply is non-empty and DOES NOT contain re-onboard language
 *    ("I don't have a profile for you", "create one", "What display name")
 *
 * Usage:
 *   AUTH_TOKEN=cf13f4af-... node tests/smoke-cdp.mjs
 *
 * No vitest — this is a one-off script. Exits 0 on success, 1 on failure.
 */

import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'timers/promises';

const AUTH_TOKEN = process.env.AUTH_TOKEN;
const PASSWORD = process.env.PASSWORD ?? '';
const IDENTIFIER = process.env.IDENTIFIER ?? '';
const URL_BASE = process.env.URL_BASE ?? 'https://chat.investor.lextok.com';
const CHROME_PATH =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!AUTH_TOKEN && !PASSWORD) {
  console.error('Either AUTH_TOKEN or PASSWORD (with IDENTIFIER) env var required');
  process.exit(2);
}
if (PASSWORD && !IDENTIFIER) {
  console.error('PASSWORD env var requires IDENTIFIER (user slug or email)');
  process.exit(2);
}

/** Collects SSE events seen on /api/chat/stream/* requests. */
function attachSSEListener(page) {
  const events = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/chat/stream/')) return;
    if (!response.ok) {
      events.push({ _error: `HTTP ${response.status()} on ${url}` });
      return;
    }
    try {
      const body = await response.text();
      for (const chunk of body.split('\n\n')) {
        const dataLine = chunk
          .split('\n')
          .find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        try {
          events.push(JSON.parse(dataLine.slice('data:'.length).trim()));
        } catch {
          // keepalive comment or partial — skip
        }
      }
    } catch (e) {
      events.push({ _error: `read body failed: ${e.message}` });
    }
  });
  return events;
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  console.log(`[smoke] launching chrome: ${CHROME_PATH}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(45_000);

  const sseEvents = attachSSEListener(page);
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  // 1. Load landing
  console.log(`[smoke] navigating to ${URL_BASE}/`);
  await page.goto(URL_BASE, { waitUntil: 'networkidle0' });
  const title = await page.title();
  console.log(`[smoke] title="${title}"`);

  // 2. Login. Two paths:
  //    - PASSWORD env (preferred — tests the new default username+password tab)
  //    - AUTH_TOKEN env (regression — switches to the "Auth token" tab)
  //    The new SPA defaults to the password tab; if we don't switch, typing
  //    into input[type=password] would hit the wrong form.
  if (PASSWORD) {
    console.log(`[smoke] performing password login as ${IDENTIFIER}`);
    await page.waitForSelector('input[type="text"]', { visible: true });
    await page.type('input[type="text"]', IDENTIFIER);
    await page.type('input[type="password"]', PASSWORD);
  } else {
    console.log('[smoke] performing token login (switching to Auth token tab)');
    // Click the "Auth token" tab button (second tab in the new SPA).
    const tabButtons = await page.$$('button[type="button"]');
    let clicked = false;
    for (const btn of tabButtons) {
      const text = await page.evaluate((el) => el.textContent ?? '', btn);
      if (/auth token/i.test(text)) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) fail('could not find "Auth token" tab button');
    await page.waitForSelector('input[type="password"]', { visible: true });
    await page.type('input[type="password"]', AUTH_TOKEN);
  }
  await page.click('button[type="submit"]');

  // 3. Wait for SPA to switch off the login screen
  await page.waitForFunction(
    () => !!document.querySelector('textarea, [data-testid="composer"], form[class*="chat"]'),
    { timeout: 30_000 },
  );
  console.log('[smoke] login succeeded; chat UI visible');
  await sleep(1000);

  // 4. Send a message
  const composer =
    (await page.$('textarea')) ??
    (await page.$('input[type="text"][placeholder*="essage"]'));
  if (!composer) fail('no composer/input found after login');
  const hello = "what's in my portfolio right now?";
  await composer.type(hello);
  await page.keyboard.press('Enter');
  console.log(`[smoke] sent: "${hello}"`);

  // 5. Wait for SSE ack + a terminal event
  const t0 = Date.now();
  const deadline = t0 + 60_000;
  while (Date.now() < deadline) {
    const last = sseEvents[sseEvents.length - 1];
    if (last && (last.type === 'done' || last.type === 'end')) break;
    await sleep(500);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[smoke] stream ended after ${elapsed}s; ${sseEvents.length} events`,
  );

  // 6. Capture assistant reply
  await sleep(1500);
  const bodyText = await page.evaluate(() => document.body.innerText ?? '');
  const lastError = consoleErrors[consoleErrors.length - 1];

  // ── Assertions ────────────────────────────────────────────────────
  const ack = sseEvents.find((e) => e.type === 'ack');
  if (!ack) fail('no ack event in SSE stream');
  const terminal = sseEvents.find(
    (e) => e.type === 'done' || e.type === 'end',
  );
  if (!terminal) fail('no terminal event in SSE stream');

  // Strict check — only actual profile-creation language, not generic
  // "let's get started with your empty portfolio" advice.
  const RE_ONBOARD_LANGUAGE =
    /I don't have a profile for you|I'll need to create one|What(?:'s| is) your (display name|contact email|display name and contact email)|let's set up your (profile|account)|create (your|a) (profile|account) for you/i;
  if (RE_ONBOARD_LANGUAGE.test(bodyText)) {
    console.error(
      '[smoke] assistant regressed to re-onboarding language:\n' +
        bodyText.slice(-500),
    );
    fail('assistant re-onboarded an existing user');
  }

  const toolEvents = sseEvents.filter((e) => e.type === 'tool_start');

  // The agent MUST NOT call resolve_user_by_slack (the pre-fix behavior).
  // If it does, enrichMessage didn't resolve the investor from the session.
  const sawResolveUserBySlack = toolEvents.some(
    (e) => typeof e.name === 'string' && e.name.includes('resolve_user_by_slack'),
  );
  if (sawResolveUserBySlack) {
    fail('agent called resolve_user_by_slack — investor context was not injected');
  }

  // Positive check: the reply must reference portfolio/holdings state.
  // This proves enrichMessage's "[Investor context: ... Saved holdings: N]"
  // prefix was applied. The agent can answer "empty" from the prefix alone,
  // so we don't require a get_portfolio tool call.
  const referencesPortfolio =
    /\b(portfolio|holdings|positions|empty|no holdings|0 holdings|nothing in your portfolio)\b/i.test(
      bodyText,
    );
  if (!referencesPortfolio) {
    console.error(
      '[smoke] reply did not reference portfolio state. Tail:\n' +
        bodyText.slice(-500),
    );
    fail('assistant reply did not engage the user portfolio context');
  }

  console.log('[smoke] ✅ PASS');
  console.log(`[smoke] terminal body length: ${bodyText.length} chars`);
  if (lastError) {
    console.log(`[smoke] (page console error noted: ${lastError.slice(0, 200)})`);
  }
  console.log('[smoke] event types:', sseEvents.map((e) => e.type).join(' → '));

  await browser.close();
}

main().catch((e) => {
  console.error('FAIL: uncaught', e);
  process.exit(1);
});
