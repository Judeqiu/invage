import {parentPort,workerData} from 'node:worker_threads';
import {readFileSync,statSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createContext,Script} from 'node:vm';
const {source,file,signature}=workerData;
const statSignature=()=>{const s=statSync(source,{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');};
let temporary;
try {
  const saved=JSON.parse(readFileSync(source,'utf8'));
  const context=createContext({});
  const codecSource=readFileSync(new URL('../../webui/portfolio-wire.js',import.meta.url),'utf8');
  new Script(codecSource).runInContext(context);
  const body={...saved.dashboard,brokerAggregates:saved.brokers};
  const wire=JSON.stringify(context.PortfolioWire.encode(body));
  if(statSignature()!==signature)throw new Error('Saved generation changed during wire preparation');
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  temporary=file+'.'+randomUUID()+'.tmp';
  const header=[signature,createHash('sha256').update(codecSource).digest('hex'),createHash('sha256').update(wire).digest('hex')].join('\t');
  writeFileSync(temporary,header+'\n'+wire,{mode:0o600,flag:'wx'});
  if(statSignature()!==signature)throw new Error('Saved generation changed before wire publication');
  renameSync(temporary,file);temporary=undefined;
  parentPort.postMessage({ok:true,bytes:Buffer.byteLength(wire)});
} catch(error) {parentPort.postMessage({ok:false,message:error.message});}
finally {if(temporary)try{unlinkSync(temporary);}catch{}}
