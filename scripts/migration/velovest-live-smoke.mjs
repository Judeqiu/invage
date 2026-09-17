import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {prepare} from './velovest-v4.mjs';
async function main(){
 const root='/opt/velovest-v4-rehearsal/final-source';
 const snapshot=prepare(root,'2026-09-16T00:12:39.000Z');let checked=0;
 for(const file of snapshot.manifest.files){if(file.path.startsWith('ops/'))continue;const bytes=readFileSync(`/opt/victorconsultant/data/${file.path}`);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Original retained data changed');checked++;}
 for(const port of [3030,3031]){const r=await fetch(`http://127.0.0.1:${port}/login`);if(r.status!==200)throw new Error('Login failed');}
 let users=0,files=0,chats=0;
 for(const file of readdirSync(`${root}/users`).filter(f=>f.endsWith('.yaml'))){
  const state=YAML.parse(readFileSync(`${root}/users/${file}`,'utf8'));
  const headers={Authorization:`Bearer ${state.user.auth_token}`};
  for(const path of ['/api/domain/invage/broker-connections','/api/files','/api/chat/conversations']){
   const r=await fetch(`http://127.0.0.1:3030${path}`,{headers,signal:AbortSignal.timeout(10000)});
   if(r.status!==200)throw new Error(`Authenticated route failed: ${path} ${r.status}`);
   const body=await r.json();if(path==='/api/files')files+=body.files.length;if(path==='/api/chat/conversations')chats+=body.conversations.length;
  }users++;
 }
 const health=await fetch('https://chat.velovest.lextok.com/health',{signal:AbortSignal.timeout(15000)});const body=await health.json();if(health.status!==200||body.version!=='4.0.0-beta.13')throw new Error('Public version/health mismatch');
 console.log(JSON.stringify({liveSmoke:'passed',users,files,chats,originalFilesVerified:checked,publicVersion:body.version}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
