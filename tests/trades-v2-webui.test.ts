import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { dashboardConfig, readDashboardConfig } from '../src/webapp/dashboard-config.js';
import { createInvageWebUi } from '../src/webapp/invage-webui.js';
import { tradesFixture, optionFill } from './helpers/trades-fixture.js';
import { tradesOpenBook, tradesHistory } from '../src/webapp/trades-v2-data.js';
it('switches Trades independently and preserves Dashboard, Positions and all V1 routes', () => {
  const dir = join(process.env.UTARUS_DATA_ROOT!,'config','agent-config'), file = join(dir,dashboardConfig.id+'.json'); mkdirSync(dir,{recursive:true});
  const route = (path: string) => createInvageWebUi().routes!.find(r => r.path === path)?.iframeSrc;
  try {
    expect(readDashboardConfig().tradesVersion).toBe('v1');
    expect(route('/trades')).toContain('/trades/index.html');
    writeFileSync(file,JSON.stringify({trades_version:'v2',dashboard_version:'v1',positions_version:'v2',show_total_premium:false}));
    expect(route('/trades')).toContain('/trades/v2.html');
    expect(route('/positions')).toContain('/positions/v2.html');
    expect(route('/dashboard')).toContain('/dashboard/index.html');
    expect(readDashboardConfig().showTotalPremium).toBe(false);
    writeFileSync(file,JSON.stringify({trades_version:'v1',dashboard_version:'v2'}));
    expect(route('/trades')).toContain('/trades/index.html');
    expect(route('/dashboard')).toContain('/dashboard/v2.html');
  } finally { rmSync(file,{force:true}); }
});
const executablePath = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executablePath))('renders both exact column sets, lazy history, filters, IDs, cash and accessible mobile details', async () => {
  const root = resolve('webui'), state = tradesFixture();
  const open = {...tradesOpenBook(state),revision:1};
  open.rows.push({...open.rows[0],id:'other-broker',optionId:'1648d3d4-f46f-8979-a9f3-7d76cefa9d15',channel:'tiger',underlying:'MSFT',currency:'HKD',premium:'500',netCash:'499'});
  open.rows.push({...open.rows[0],id:'unknown',optionId:'2648d3d4-f46f-8979-a9f3-7d76cefa9d15',underlying:'<IMG SRC=x ONERROR=alert(1)>',entryDate:null,entryThrough:null,premium:null,netCash:null});
  state.option_executions!.push(optionFill({execution_id:'close-2',executed_at:'2026-10-02T10:00:00',contracts:'1',side:'buy',effect:'close',gross_premium:'-49.99'}));
  const history = {...tradesHistory(state),revision:1,gaps:[{channel:'tiger',reason:'Incomplete archive <img src=x onerror=alert(1)>'}]};
  let openRequests = 0, historyRequests = 0, fail = false, noteFail = true;
  const server = createServer(async (req,res) => {
    const url = new URL(req.url!,'http://localhost');
    if (req.method === 'PUT' && url.pathname.endsWith('/note')) {
      let body = '';for await (const chunk of req) body += chunk;
      res.setHeader('Content-Type','application/json');
      if (noteFail) {res.statusCode = 409;return res.end(JSON.stringify({message:'Journal changed. Your draft is still shown.'}));}
      const note = JSON.parse(body);return res.end(JSON.stringify({text:note.text,revision:note.revision+1,updatedAt:'2026-10-20T10:00:00Z'}));
    }
    if (url.pathname.endsWith('/trades-v2') || url.pathname.endsWith('/trades-v2/history')) {
      res.setHeader('Content-Type','application/json');
      if (url.pathname.endsWith('/history')) { historyRequests++; return res.end(JSON.stringify(history)); }
      openRequests++;
      if (fail) { res.statusCode = 503; return res.end(JSON.stringify({message:'Temporary journal failure'})); }
      return res.end(JSON.stringify(open));
    }
    const file = resolve(root,'.'+url.pathname);
    if (!file.startsWith(root+'/') || !existsSync(file)) {res.statusCode = 404; return res.end();}
    res.setHeader('Content-Type',extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html');res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r));
  const browser = await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox']});
  try {
    const page = await browser.newPage(), errors: string[] = [];page.on('pageerror',e => errors.push(e.message));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.setRequestInterception(true); page.on('request',r => r.url().startsWith(origin) ? r.continue() : r.abort());
    await page.setViewport({width:1440,height:1000});
    await page.goto(origin+'/trades/v2.html'); await page.waitForSelector('#refresh:enabled');
    expect(openRequests).toBe(1); expect(historyRequests).toBe(0);
    const columns = () => page.$$eval('.journal-table thead .col-label',nodes => nodes.map(n => n.textContent));
    expect(await columns()).toEqual(['Entry date','ID','Ticker','Strategy','Strike','Expiry','Contracts','Premium','Returns %','Net cash','Broker']);
    expect(await page.$$eval('[data-row]',nodes => nodes.every(n => n.children.length === 11))).toBe(true);
    expect(await page.$eval('#openingCash',n => (n as HTMLInputElement).disabled)).toBe(true);
    expect(await page.$('#journalTable img')).toBeNull();
    await page.select('#ticker','AAPL'); await page.type('#openingCash','1000');
    expect(await page.$eval('#journalTable tbody',n => n.textContent)).toContain('$1,300.06');
    await page.click('[data-detail]'); await page.waitForSelector('#tradeDetail[open]');
    expect(await page.$eval('#detailBody',n => n.textContent)).toContain(open.rows[0].optionId);
    expect(await page.$eval('#detailBody',n => n.textContent)).toContain('open-1');
    expect(await page.$eval('#detailBody',n => n.textContent)).toContain(open.rows[0].executions[0].id);
    await page.type('#thesis','Private thesis <img src=x>');await page.click('#saveNote');
    await page.waitForFunction(() => document.getElementById('noteStatus')?.textContent?.includes('draft'));
    expect(await page.$eval('#thesis',n => (n as HTMLTextAreaElement).value)).toBe('Private thesis <img src=x>');
    noteFail = false;await page.click('#saveNote');await page.waitForFunction(() => document.getElementById('noteStatus')?.textContent === 'Note saved.');
    await page.keyboard.press('Escape'); expect(await page.$('#tradeDetail[open]')).toBeNull();
    expect(await page.$eval('[data-detail]',n => n === document.activeElement)).toBe(true);
    await page.keyboard.press('Enter'); await page.waitForSelector('#tradeDetail[open]');
    expect(await page.$eval('#thesis',n => (n as HTMLTextAreaElement).value)).toBe('Private thesis <img src=x>');
    expect(await page.$('#detailBody img')).toBeNull();await page.keyboard.press('Escape');
    await page.click('#clear');
    await page.click('[data-channel="tiger"]');
    expect(new URL(page.url()).searchParams.get('channel')).toBe('tiger');
    expect(await page.$eval('#journalTable tbody',n => n.textContent)).toContain('HKD');
    await page.click('#clear');
    await page.screenshot({path:'/tmp/invage-trades-v2-desktop.png',fullPage:true});
    await page.click('#historyTab'); await page.waitForFunction(() => document.querySelectorAll('.journal-table thead th').length === 9 && document.getElementById('refresh')?.hasAttribute('disabled') === false);
    expect(historyRequests).toBe(1);
    expect(await columns()).toEqual(['Contract','Status','Opened','Last trade','Contracts','Premium in','Paid to close','Realised P&L','Broker']);
    expect(await page.$eval('#journalTable tbody',n => n.textContent)).toContain('Closed');
    expect(await page.$('#availability img')).toBeNull();
    await page.click('#openTab'); await page.click('#historyTab'); expect(historyRequests).toBe(1);
    await page.screenshot({path:'/tmp/invage-trades-v2-history.png',fullPage:true});
    await page.click('#openTab');
    for (const width of [390,768,1100]) {
      await page.setViewport({width,height:844});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewport({width:390,height:844});
    await page.$eval('#journalTable',n => {n.scrollLeft = n.scrollWidth;});
    expect(await page.$eval('#journalTable',n => n.scrollLeft)).toBeGreaterThan(0);
    await page.screenshot({path:'/tmp/invage-trades-v2-mobile.png',fullPage:true});
    fail = true; await page.click('#refresh'); await page.waitForSelector('#error:not([hidden])');
    expect(await page.$eval('#status',n => n.textContent)).toContain('Showing the last loaded');
    expect(await page.$$('[data-row]')).toHaveLength(3);
    fail = false; await page.click('#retry'); await page.waitForSelector('#refresh:enabled');
    expect(await page.$eval('#error',n => n.hasAttribute('hidden'))).toBe(true);
    expect(errors).toEqual([]);
  } finally {await browser.close();server.closeAllConnections();await new Promise<void>(r => server.close(() => r()));}
},30000);
