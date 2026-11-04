import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {resolveDataRoot} from 'utarus';
import {projectionLocation,projectionFileSignature} from './projection-files.js';
import {portfolioProjectionSignature,type PortfolioProjection} from './projection-store.js';
const pending=new Map<string,Promise<void>>();
const codecHash=createHash('sha256').update(readFileSync(new URL('../../webui/portfolio-wire.js',import.meta.url))).digest('hex');
const cached=new Map<string,{signature:string;json:string}>();
let queue:Promise<void>=Promise.resolve();
function wireFile(source:string) {return join(resolveDataRoot(),'derived','portfolio-wire',basename(source));}
function readPrepared(source:string,signature:string):string|null {
  const file=wireFile(source),prior=cached.get(file);
  if(prior?.signature===signature)return prior.json;
  try {
    const raw=readFileSync(file,'utf8'),newline=raw.indexOf('\n');
    const [sourceSignature,version,checksum]=raw.slice(0,newline).split('\t');
    if(sourceSignature!==signature || version!==codecHash)return null;
    const json=raw.slice(newline+1);
    if(createHash('sha256').update(json).digest('hex')!==checksum)return null;
    cached.set(file,{signature,json});return json;
  } catch{return null;}
}
/** Queue every generation, without blocking HTTP parsing or competing workers. */
export function prepareDashboardWireFile(source:string):Promise<void> {
  const signature=projectionFileSignature(source),key=source+':'+signature;
  if(readPrepared(source,signature))return Promise.resolve();
  const prior=pending.get(key);if(prior)return prior;
  const work=queue.catch(()=>{}).then(()=>new Promise<void>((resolve,reject)=>{
    const worker=new Worker(new URL('./dashboard-wire-worker.mjs',import.meta.url),{workerData:{source,file:wireFile(source),signature}});
    let received=false;
    worker.once('message',result=>{received=true;result.ok?resolve():reject(new Error(result.message));});
    worker.once('error',reject);
    worker.once('exit',code=>{if(code!==0||!received)reject(new Error('Dashboard wire worker exited before completion'));});
  }));
  pending.set(key,work);queue=work;
  void work.finally(()=>{if(pending.get(key)===work)pending.delete(key);}).catch(()=>{});
  return work;
}
export async function preparedDashboardWire(saved:PortfolioProjection):Promise<string> {
  const source=projectionLocation(saved.userId).file,signature=portfolioProjectionSignature(saved);
  if(!signature || projectionFileSignature(source)!==signature)throw new Error('Saved generation changed; retry dashboard read');
  let json=readPrepared(source,signature);
  if(!json){await prepareDashboardWireFile(source);json=readPrepared(source,signature);}
  if(!json || projectionFileSignature(source)!==signature)throw new Error('Saved generation changed; retry dashboard read');
  return json;
}
