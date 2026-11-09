/** Immutable historical public-price input for the user-approved frozen demo. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {yf} from '../src/market/yf-client.ts';
import {assertDemoWorkbook} from '../src/demo/workbook.ts';
const [sourceFile,output]=process.argv.slice(2);
const book=JSON.parse(readFileSync(sourceFile));assertDemoWorkbook(book);
const day=ms=>new Date(ms).toISOString().slice(0,10),time=s=>Date.parse(s+'T00:00:00Z');
const first=book.rows.map(r=>r.entryDate).sort()[0],span=time(book.asOf)-time(first);
if(!(span>0))throw Error('Historical calibration needs an observed date span');
const from=day(time(first)-span),through=day(time(book.asOf)+86400000);
const symbols=[...new Set(book.rows.map(r=>r.underlying))];
const series=await Promise.all(symbols.map(async symbol=>({symbol,response:await yf.chart(symbol,{period1:from,period2:through,interval:'1d'})})));
const evidence={version:1,provider:'Yahoo Finance historical chart',capturedAt:new Date().toISOString(),
 sourceSha256:book.source.sha256,asOf:book.asOf,requestedFrom:from,requestedThrough:through,series};
const bytes=JSON.stringify(evidence,null,2)+'\n';writeFileSync(output,bytes,{mode:0o600,flag:'wx'});
console.log(JSON.stringify({output,sha256:createHash('sha256').update(bytes).digest('hex'),asOf:book.asOf,
 coverage:series.map(s=>({symbol:s.symbol,bars:s.response.quotes.length,first:s.response.quotes[0]?.date,last:s.response.quotes.at(-1)?.date}))}));
