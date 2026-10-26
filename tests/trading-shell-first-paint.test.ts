import { expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { existsSync, readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import puppeteer from 'puppeteer-core';
import { tradingShellFirstPaint } from '../src/webapp/trading-shell.js';

it('adds critical layout only to SPA documents and preserves JSON and report responses', async () => {
  const app = express(); app.use(tradingShellFirstPaint);
  app.get('/dashboard', (_req,res) => res.type('html').send('<html><head></head><body><div id="root"></div></body></html>'));
  app.get('/report', (_req,res) => res.type('html').send('<html><head></head><body>Report</body></html>'));
  app.get('/data', (_req,res) => res.json({status:'ok'}));
  const spa = await request(app).get('/dashboard').expect(200);
  expect(spa.text).toContain('<style id="velovest-trading-shell">');
  expect(spa.text.indexOf('width:220px')).toBeLessThan(spa.text.indexOf('</head>'));
  expect((await request(app).get('/report')).text).not.toContain('velovest-trading-shell');
  expect((await request(app).get('/data')).body).toEqual({status:'ok'});
});

const chrome = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(chrome))('reserves final desktop and mobile logo sizes before the embedded page loads', async () => {
  const app = express(); app.use(tradingShellFirstPaint);
  let held: ServerResponse | undefined;
  const css = readFileSync('node_modules/utarus/web/src/components/trading-header.css','utf8');
  app.get('/shell', (_req,res) => res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><div class="trading-shell"><header class="trading-header"><div class="trading-header-row"><a class="trading-brand"><img src="/logo.webp" alt="Velovest"></a></div></header><iframe class="domain-page-frame" src="/guest"></iframe></div></body></html>`));
  app.get('/logo.webp', (_req,res) => res.type('webp').send(readFileSync('webui/velovest-logo-dark.webp')));
  app.get('/guest', (_req,res) => {held=res;});
  const server = app.listen(0,'127.0.0.1');
  await new Promise<void>(done => server.once('listening',done));
  const browser = await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    const geometry = () => page.$eval('.trading-brand img',node => {
      const box = node.getBoundingClientRect(), header = node.closest('header')!.getBoundingClientRect();
      return {width:box.width,height:box.height,headerHeight:header.height};
    });
    for (const [width,expectedWidth,expectedHeight] of [[1440,220,61],[390,165,46]]) {
      held=undefined; await page.setViewport({width,height:900});
      const navigation = page.goto(origin+'/shell');
      await page.waitForSelector('.trading-brand img');
      await expect.poll(() => !!held).toBe(true);
      const before = await geometry();
      expect(before).toMatchObject({width:expectedWidth,height:expectedHeight});
      held!.setHeader('Content-Type','text/html');
      held!.end(`<html><body><script>${readFileSync('webui/dashboard/scroll-shell.js','utf8')}</script></body></html>`);
      await navigation;
      await page.waitForFunction(() => document.querySelector('.trading-shell')?.classList.contains('velovest-dashboard'));
      expect(await geometry()).toEqual(before);
      await page.screenshot({path:`/tmp/velovest-logo-first-paint-${width}.png`});
    }
  } finally {await browser.close();server.closeAllConnections();await new Promise<void>(done => server.close(() => done()));}
},15000);
