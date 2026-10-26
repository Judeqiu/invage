import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { positionsFixture } from './helpers/positions-fixture.js';
import { withPageProjections } from './helpers/portfolio-projection.js';
import { tradesFixture } from './helpers/trades-fixture.js';
import { tradesOpenBook } from '../src/webapp/trades-v2-data.js';

const chrome = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(chrome))('shows fifteen stock, obligation and trade rows and releases the shell header on scroll', async () => {
  const root = resolve('webui'), payload = positionsFixture();
  const originals = structuredClone(payload.model.live.positions);
  for (let i=0;i<20;i++) for (const original of originals.filter((p: any) => p.channel === 'ibkr')) {
    const p = structuredClone(original), ticker = `TEST${String(i).padStart(2,'0')}`;
    const old = p.ticker; p.ticker = `${ticker}-${p.option?.right || 'stock'}`;
    if (p.option) p.option.underlying = ticker;
    payload.model.live.positions.push(p);
    payload.equityPrices[ticker] = 100;
    if (payload.optionTradeDetails[old]) payload.optionTradeDetails[p.ticker] = payload.optionTradeDetails[old];
  }
  const book = tradesOpenBook(tradesFixture());
  book.rows = Array.from({length:30},(_,i) => ({ ...book.rows[0],id:`trade-${i}`,optionId:`option-${i}` }));
  const server = createServer((req,res) => {
    const url = new URL(req.url!,'http://localhost');
    const json = (data: unknown) => {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
    if (url.pathname === '/shell') {
      res.setHeader('Content-Type','text/html');
      return res.end(`<body style="margin:0"><style>.trading-shell{height:100dvh;overflow:hidden;display:flex;flex-direction:column;--shell-header-height:68px}.trading-header{height:68px;flex-shrink:0}.domain-page-frame{width:100%;border:0;flex-shrink:0}</style><div class="trading-shell"><header class="trading-header">Velovest</header><iframe class="domain-page-frame" src="/${url.searchParams.get('page')}/v2.html"></iframe></div>`);
    }
    if (url.pathname.endsWith('/dashboard-cache')) return json(null);
    if (url.pathname.endsWith('/dashboard')) return json(withPageProjections(payload));
    if (url.pathname.endsWith('/trades-v2')) return json(book);
    const file = resolve(root,'.'+url.pathname);
    if (!file.startsWith(root+'/') || !existsSync(file)) {res.statusCode=404;return res.end();}
    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'} as Record<string,string>)[extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise<void>(done => server.listen(0,'127.0.0.1',done));
  const browser = await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
  try {
    const page = await browser.newPage(), errors: string[] = []; page.on('pageerror',e => errors.push(e.message));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.setRequestInterception(true);page.on('request',req => req.url().startsWith(origin) ? req.continue() : req.abort());
    await page.setViewport({width:1440,height:900});
    for (const name of ['positions','trades']) {
      await page.goto(`${origin}/shell?page=${name}`);
      const frame = page.frames().find(f => f.url().includes(`/${name}/v2.html`))!;
      await frame.waitForSelector(name === 'positions' ? '#stocksTable tbody tr' : '[data-row]');
      const selectors = name === 'positions' ? ['#stocksTable','#obligationsTable'] : ['#journalTable'];
      for (const selector of selectors) {
        // Bring each section into view; the table itself remains at its first row.
        await frame.$eval(selector,node => node.closest('section')!.scrollIntoView());
        const visible = await frame.$eval(selector,node => {
          const bounds = node.getBoundingClientRect();
          return [...node.querySelectorAll('tbody tr')].filter(row => {
            if (!row.matches('[data-row]') && !row.closest('.positions-table')) return false;
            const box = row.getBoundingClientRect();
            return box.top >= Math.max(0,bounds.top) && box.bottom <= Math.min(innerHeight,bounds.bottom);
          }).length;
        });
        expect(visible,selector).toBeGreaterThanOrEqual(15);
        expect(await frame.$eval(selector,node => node.scrollTop)).toBe(0);
      }
      await frame.evaluate(() => scrollTo(0,100));
      await expect.poll(() => page.$eval('.trading-header',node => getComputedStyle(node).visibility)).toBe('hidden');
      await frame.evaluate(() => scrollTo(0,0));
      await expect.poll(() => page.$eval('.trading-header',node => getComputedStyle(node).visibility)).toBe('visible');
      expect(await frame.$eval('body',node => getComputedStyle(node).fontFamily)).toContain('Proxima Nova');
      await page.screenshot({path:`/tmp/invage-feedback-${name}.png`});
    }
    expect(errors).toEqual([]);
  } finally {await browser.close();server.closeAllConnections();await new Promise<void>(done => server.close(() => done()));}
},30000);
