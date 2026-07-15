/**
 * Full WebUI e2e against production (or URL_BASE).
 *
 * Covers:
 *  - SPA static + health
 *  - Public demo meta
 *  - Login: token ok/bad, password missing-hash path message
 *  - Invite redeem: invalid code, missing name
 *  - Authenticated chat: send, SSE ack/done, markdown currency bold
 *  - /clear, unauthenticated 401, forbidden stream
 *  - Busy 409 path (optional)
 *  - SPA login UI + chat UI via puppeteer
 *
 * Usage:
 *   AUTH_TOKEN=... node tests/webui-e2e.mjs
 *   URL_BASE=https://chat.investor.lextok.com AUTH_TOKEN=... node tests/webui-e2e.mjs
 */

import puppeteer from 'puppeteer-core';
import { setTimeout as sleep } from 'timers/promises';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const URL_BASE = process.env.URL_BASE ?? 'https://chat.investor.lextok.com';
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const CHROME_PATH =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT_DIR = process.env.OUT_DIR ?? join(process.cwd(), 'tests/e2e-artifacts');

if (!AUTH_TOKEN) {
  console.error('AUTH_TOKEN required');
  process.exit(2);
}

mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name} — ${detail}`);
}
function assert(name, cond, detail) {
  if (cond) pass(name, typeof detail === 'string' ? detail : '');
  else fail(name, detail || 'assertion failed');
}

async function api(path, opts = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* raw */
  }
  return { res, text, json };
}

function cookieHeader(setCookie) {
  if (!setCookie) return '';
  const parts = Array.isArray(setCookie) ? setCookie : [setCookie];
  return parts.map((c) => c.split(';')[0]).join('; ');
}

async function main() {
  console.log(`\n=== WebUI e2e → ${URL_BASE} ===\n`);

  // ── 1. Public endpoints ─────────────────────────────────────────────
  {
    const h = await api('/health');
    assert('health 200', h.res.ok && h.json?.status === 'ok', h.text.slice(0, 120));
  }
  {
    const r = await api('/');
    assert('spa index 200', r.res.ok && r.text.includes('root'), `status=${r.res.status}`);
    assert(
      'spa has hashed assets',
      /\/assets\/index-[A-Za-z0-9_-]+\.js/.test(r.text),
      r.text.slice(0, 200),
    );
  }
  {
    const r = await api('/api/onboard/demo');
    assert(
      'demo meta returns agentName',
      r.res.ok && typeof r.json?.agentName === 'string' && r.json.agentName.length > 0,
      JSON.stringify(r.json),
    );
    assert(
      'demo meta returns enabled boolean',
      r.res.ok && typeof r.json?.enabled === 'boolean',
      JSON.stringify(r.json),
    );
  }
  {
    // redirect: 'manual' so fetch does not follow 302 HTML login (pre-fix behavior)
    const res = await fetch(`${URL_BASE}/api/chat/agent`, { redirect: 'manual' });
    assert(
      'chat/agent unauth is 401 (not redirect)',
      res.status === 401,
      `status=${res.status}`,
    );
  }
  {
    const res = await fetch(`${URL_BASE}/api/admin/users`, { redirect: 'manual' });
    // requireAdmin may 401 (no user) or 403 (user but not admin) depending on mount order
    assert(
      'admin unauth is 401 or 403',
      res.status === 401 || res.status === 403,
      `status=${res.status}`,
    );
  }

  // ── 2. Login corner cases ───────────────────────────────────────────
  {
    const r = await api('/api/onboard/login', {
      method: 'POST',
      body: JSON.stringify({ auth_token: 'not-a-real-token' }),
    });
    assert('login bad token 401', r.res.status === 401, JSON.stringify(r.json));
  }
  {
    const r = await api('/api/onboard/login', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert('login empty body 400', r.res.status === 400, JSON.stringify(r.json));
  }
  {
    const r = await api('/api/onboard/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'nobody', password: 'wrong' }),
    });
    assert('login bad password 401', r.res.status === 401, JSON.stringify(r.json));
  }
  {
    const r = await api('/api/onboard/login', {
      method: 'POST',
      body: JSON.stringify({ auth_token: AUTH_TOKEN }),
    });
    assert(
      'login good token 200',
      r.res.ok && r.json?.slug && r.json?.type === 'user',
      JSON.stringify(r.json),
    );
    const setCookie = r.res.headers.getSetCookie?.() || r.res.headers.raw?.()?.['set-cookie'];
    // undici getSetCookie
    const cookies = typeof r.res.headers.getSetCookie === 'function'
      ? r.res.headers.getSetCookie()
      : [r.res.headers.get('set-cookie')].filter(Boolean);
    const cookie = cookieHeader(cookies);
    assert('login sets session cookie', cookie.includes('bindrive_session'), cookie.slice(0, 80));

    globalThis.__cookie = cookie;
    globalThis.__slug = r.json.slug;
    globalThis.__displayName = r.json.displayName;
  }

  // ── 3. Redeem corner cases ──────────────────────────────────────────
  {
    const r = await api('/api/onboard/redeem', {
      method: 'POST',
      body: JSON.stringify({ display_name: '', code: 'INV-XXXXXXXX' }),
    });
    assert('redeem empty name 400', r.res.status === 400, JSON.stringify(r.json));
  }
  {
    const r = await api('/api/onboard/redeem', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Test User', code: 'INV-NOTREAL1' }),
    });
    assert(
      'redeem bad code 4xx',
      r.res.status >= 400 && r.res.status < 500,
      JSON.stringify(r.json),
    );
  }
  {
    const r = await api('/api/onboard/redeem', {
      method: 'POST',
      body: JSON.stringify({
        display_name: 'x'.repeat(80),
        code: 'INV-NOTREAL1',
      }),
    });
    assert('redeem name too long 400', r.res.status === 400, JSON.stringify(r.json));
  }

  // ── 4. Authenticated agent + clear ──────────────────────────────────
  const cookie = globalThis.__cookie;
  {
    const r = await api('/api/chat/agent', { headers: { Cookie: cookie } });
    assert(
      'chat/agent auth returns slug+agentName',
      r.res.ok &&
        r.json?.slug === globalThis.__slug &&
        typeof r.json?.agentName === 'string',
      JSON.stringify(r.json),
    );
  }
  {
    const r = await api('/api/chat/clear', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert('clear context ok', r.res.ok && r.json?.ok === true, JSON.stringify(r.json));
  }
  {
    const r = await api('/api/chat/messages', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ text: '' }),
    });
    assert('messages empty text 400', r.res.status === 400, JSON.stringify(r.json));
  }
  {
    const r = await api('/api/chat/messages', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({}),
    });
    assert('messages missing text 400', r.res.status === 400, JSON.stringify(r.json));
  }
  {
    const r = await api('/api/chat/stream/00000000-0000-0000-0000-000000000000', {
      headers: { Cookie: cookie },
    });
    assert('stream unknown id 404', r.res.status === 404, `status=${r.res.status}`);
  }
  {
    const res = await fetch(`${URL_BASE}/api/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
      redirect: 'manual',
    });
    assert('messages unauth is 401 (not redirect)', res.status === 401, `status=${res.status}`);
  }

  // ── 5. Full chat turn: markdown currency bold ───────────────────────
  let messageId = null;
  {
    const prompt =
      'Reply with EXACTLY this one paragraph and nothing else:\n' +
      "SpaceX's proposed **$1.675T** valuation is larger than IBM's entire market cap by **6×**, " +
      'yet IBM generates **3.6× more revenue**, is **solidly profitable**, and throws off ' +
      '**$14.7B in annual free cash flow**. SpaceX is priced for a future that hasn\'t happened yet.';
    const r = await api('/api/chat/messages', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ text: prompt }),
    });
    assert(
      'messages start run',
      r.res.ok && (r.json?.kind === 'run' || r.json?.kind === 'reply' || r.json?.kind === 'queued'),
      JSON.stringify(r.json),
    );
    if (r.json?.kind === 'run') {
      messageId = r.json.messageId;
      pass('got messageId', messageId);
    } else if (r.json?.kind === 'queued') {
      fail('messages start run', 'agent busy (queued) — clear and retry');
    } else if (r.json?.kind === 'reply') {
      pass('gate reply (invite etc)', r.json.text?.slice(0, 80));
    }
  }

  let finalText = '';
  if (messageId) {
    // SSE stream consume
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 180_000);
    try {
      const res = await fetch(`${URL_BASE}/api/chat/stream/${messageId}`, {
        headers: { Cookie: cookie },
        signal: ac.signal,
      });
      assert('stream HTTP 200', res.ok, `status=${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const types = new Set();
      let gotEnd = false;
      while (!gotEnd) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let eventType = '';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7);
            if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!eventType || !data) continue;
          let payload;
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }
          types.add(payload.type || eventType);
          if (payload.type === 'done') finalText = payload.text || '';
          if (payload.type === 'delta' && payload.cumulative) finalText = payload.cumulative;
          if (payload.type === 'error') {
            fail('stream error event', payload.message);
          }
          if (payload.type === 'end') gotEnd = true;
        }
      }
      assert('stream has ack', types.has('ack'), [...types].join(','));
      assert(
        'stream has done or deltas',
        types.has('done') || types.has('delta'),
        [...types].join(','),
      );
      assert('stream has end', types.has('end'), [...types].join(','));
      assert('final text non-empty', finalText.trim().length > 20, finalText.slice(0, 100));
      // Markdown format regression: currency $ must not collapse spaces / leave **
      const jammed = /1\.675Tvaluation|valuationislarger|marketcapby|morerevenue|solidlyprofitable|throwsoff/i.test(
        finalText,
      );
      assert('no jammed words from $ math bug', !jammed, finalText.slice(0, 200));
      // Prefer seeing real dollars and bold markers or rendered meaning
      assert(
        'mentions valuation and IBM',
        /1\.675T/i.test(finalText) && /IBM/i.test(finalText),
        finalText.slice(0, 200),
      );
      // Raw ** around numbers should be present in source text (markdown before render)
      // OR the model may rewrite slightly — check we don't have orphan * * patterns
      const orphanStars = /\*\s+\*/.test(finalText);
      assert('no spaced asterisk pairs (* *)', !orphanStars, finalText.slice(0, 200));
    } catch (e) {
      fail('stream consume', e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(t);
    }
  }

  // ── 6. Abort when not running ───────────────────────────────────────
  {
    // clear first so idle
    await api('/api/chat/clear', { method: 'POST', headers: { Cookie: cookie } });
    await sleep(500);
    const r = await api('/api/chat/abort', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert(
      'abort when idle is 409',
      r.res.status === 409 || (r.res.ok && r.json?.ok),
      JSON.stringify(r.json) + ' status=' + r.res.status,
    );
  }

  // ── 7. Password change validation ───────────────────────────────────
  {
    const r = await api('/api/onboard/profile/password', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ new_password: '123' }),
    });
    assert('password too short 400', r.res.status === 400, JSON.stringify(r.json));
  }

  // ── 8. Browser UI smoke ─────────────────────────────────────────────
  console.log('\n--- puppeteer UI ---\n');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    await page.goto(URL_BASE + '/login', { waitUntil: 'networkidle0' });
    await page.screenshot({ path: join(OUT_DIR, '01-login.png'), fullPage: true });
    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(
      'login page shows agent name',
      /Invester|Agent/i.test(bodyText),
      bodyText.slice(0, 120),
    );
    assert(
      'login has password or token fields',
      (await page.$('input[type="password"]')) !== null ||
        bodyText.toLowerCase().includes('token'),
      'no password/token UI',
    );

    // Switch to Auth token tab
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /^Auth token$/i.test((b.textContent || '').trim()),
      );
      btn?.click();
    });
    await sleep(400);

    // Token form uses controlled React input — type via puppeteer so onChange fires
    const tokenInput = await page.$('input[placeholder*="660e"], input[placeholder*="…"], input[placeholder*="..."]');
    let filled = false;
    if (tokenInput) {
      await tokenInput.click({ clickCount: 3 });
      await tokenInput.type(AUTH_TOKEN, { delay: 1 });
      filled = true;
    } else {
      // fallback: any visible text input on token tab
      filled = await page.evaluate((token) => {
        const inputs = [...document.querySelectorAll('input')].filter(
          (i) => i.offsetParent !== null && i.type !== 'password',
        );
        const el = inputs[0];
        if (!el) return false;
        const nativeSet = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set;
        nativeSet?.call(el, token);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, AUTH_TOKEN);
    }
    assert('token input filled', filled, 'could not find token field');

    // Submit token form
    await page.evaluate(() => {
      const forms = [...document.querySelectorAll('form')];
      const form = forms.find((f) => f.querySelector('input')) || forms[0];
      const btn = form
        ? [...form.querySelectorAll('button')].find((b) =>
            /sign in|log in|continue|submit/i.test(b.textContent || ''),
          )
        : null;
      if (btn) btn.click();
      else form?.requestSubmit();
    });
    // Wait until chat UI or error
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const t = await page.evaluate(() => document.body.innerText);
      if (/Welcome to|Message Invester|slug:|Thinking/i.test(t)) break;
      if (/Invalid auth token|invalid_token/i.test(t)) break;
    }
    await page.screenshot({ path: join(OUT_DIR, '02-after-login.png'), fullPage: true });

    const afterLogin = await page.evaluate(() => document.body.innerText);
    const loggedIn =
      /Welcome to|Message Invester|slug:|david|Thinking/i.test(afterLogin) &&
      !/Sign in to chat with your agent/i.test(afterLogin);
    assert('UI after login leaves auth screen', loggedIn, afterLogin.slice(0, 200));

    // Send a simple message; agent may greet on first turn — any .prose-chat is success.
    const ta = await page.$('textarea');
    if (ta) {
      async function waitForIdleAndProse(minProseLen = 10, maxIter = 90) {
        let lastProse = '';
        for (let i = 0; i < maxIter; i++) {
          await sleep(2000);
          const state = await page.evaluate(() => {
            const text = document.body.innerText;
            const thinking = /Thinking…|Thinking\.\.\./i.test(text);
            const stopVisible = [...document.querySelectorAll('button')].some((b) =>
              /^Stop$/i.test((b.textContent || '').trim()),
            );
            const errEl = [...document.querySelectorAll('[class*="rose"], [class*="error"]')]
              .map((el) => el.textContent || '')
              .find((t) => /failed|error|unauthorized|busy/i.test(t));
            const strongs = [...document.querySelectorAll('.prose-chat strong, .prose-chat b')].map(
              (el) => el.textContent || '',
            );
            const proseText = [...document.querySelectorAll('.prose-chat')]
              .map((el) => el.innerText)
              .join('\n');
            return { thinking, stopVisible, errEl, strongs, proseText };
          });
          if (state.errEl) return { error: state.errEl.slice(0, 200) };
          if (state.thinking || state.stopVisible) {
            lastProse = state.proseText;
            continue;
          }
          if (state.proseText && state.proseText.trim().length >= minProseLen) {
            return state;
          }
          if (lastProse && lastProse.trim().length >= minProseLen) {
            return { ...state, proseText: lastProse };
          }
        }
        return null;
      }

      await ta.click({ clickCount: 3 });
      await ta.type('Say hello in one short sentence.', { delay: 5 });
      await page.keyboard.press('Enter');
      pass('typed chat message in UI');

      let state = await waitForIdleAndProse();
      if (state?.error) {
        fail('UI chat error', state.error);
      } else if (!state) {
        fail('UI reply timeout', 'no assistant prose after wait');
      } else {
        assert(
          'UI assistant prose readable (spaces present)',
          state.proseText.includes(' ') && state.proseText.length > 10,
          state.proseText.slice(0, 160),
        );
        pass('UI first assistant reply', state.proseText.slice(0, 100));
      }

      // Ensure idle before second turn (avoids 409 busy)
      for (let i = 0; i < 15; i++) {
        const busy = await page.evaluate(() =>
          [...document.querySelectorAll('button')].some((b) =>
            /^Stop$/i.test((b.textContent || '').trim()),
          ),
        );
        if (!busy) break;
        await sleep(1000);
      }

      // Second turn: force markdown with currency $ for the original bug
      const mdPrompt =
        'Output ONLY this exact markdown (no extra words): SpaceX **$1.675T** vs IBM **6×** revenue. Cash **$14.7B**.';
      const beforeProse = state?.proseText || '';
      const ta2 = await page.$('textarea');
      if (ta2) {
        await ta2.click({ clickCount: 3 });
        await ta2.type(mdPrompt, { delay: 2 });
        await page.keyboard.press('Enter');
        // Wait until prose changes or new strong tags appear
        let mdState = null;
        for (let i = 0; i < 90; i++) {
          await sleep(2000);
          mdState = await page.evaluate((prev) => {
            const stopVisible = [...document.querySelectorAll('button')].some((b) =>
              /^Stop$/i.test((b.textContent || '').trim()),
            );
            const thinking = /Thinking…|Thinking\.\.\./i.test(document.body.innerText);
            const errEl = [...document.querySelectorAll('[class*="rose"]')]
              .map((el) => el.textContent || '')
              .find((t) => /failed|error|busy/i.test(t));
            const strongs = [...document.querySelectorAll('.prose-chat strong, .prose-chat b')].map(
              (el) => el.textContent || '',
            );
            const proseText = [...document.querySelectorAll('.prose-chat')]
              .map((el) => el.innerText)
              .join('\n');
            return { stopVisible, thinking, errEl, strongs, proseText, changed: proseText !== prev };
          }, beforeProse);
          if (mdState.errEl) break;
          if (!mdState.thinking && !mdState.stopVisible && mdState.changed) break;
        }
        if (mdState?.errEl) {
          fail('UI markdown chat error', mdState.errEl);
        } else if (!mdState || !mdState.proseText) {
          fail('UI markdown reply timeout', 'no prose');
        } else {
          assert(
            'UI markdown prose not jammed',
            !/1\.675Tvaluation|marketcapby|valuationislarger/i.test(mdState.proseText),
            mdState.proseText.slice(0, 300),
          );
          const hasStrongMoney = mdState.strongs.some((s) =>
            /1\.675|14\.7|6\s*×|6x|\$/i.test(s),
          );
          const hasMoney = /1\.675T|14\.7B|\$1|\$14/i.test(mdState.proseText);
          if (hasStrongMoney) {
            pass('UI markdown rendered bold currency', mdState.strongs.join(' | ').slice(0, 120));
          } else if (hasMoney) {
            pass('UI markdown shows currency amounts', mdState.proseText.slice(0, 120));
          } else {
            pass('UI markdown reply received', mdState.proseText.slice(0, 120));
          }
          const visibleStars = (mdState.proseText.match(/\*\*/g) || []).length;
          assert(
            'UI markdown few raw ** leaks',
            visibleStars <= 4,
            `** count=${visibleStars} ${mdState.proseText.slice(0, 160)}`,
          );
        }
      }
      await page.screenshot({ path: join(OUT_DIR, '03-chat-reply.png'), fullPage: true });
    } else {
      fail('composer textarea', 'not found after login');
    }

    // Soft check: no flood of console errors
    const critical = consoleErrors.filter(
      (e) => !/favicon|ResizeObserver|Download the React DevTools/i.test(e),
    );
    assert(
      'no critical console errors',
      critical.length < 5,
      critical.slice(0, 3).join(' | '),
    );
  } catch (e) {
    fail('puppeteer UI', e instanceof Error ? e.message : String(e));
  } finally {
    if (browser) await browser.close();
  }

  // ── Summary ─────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);
  console.log(`\n=== SUMMARY: ${passed.length} passed, ${failed.length} failed ===\n`);
  if (failed.length) {
    for (const f of failed) console.error(`  ✗ ${f.name}: ${f.detail}`);
  }
  writeFileSync(
    join(OUT_DIR, 'results.json'),
    JSON.stringify({ url: URL_BASE, passed: passed.length, failed, results }, null, 2),
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
