import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
async function main(){
Object.assign(process.env, {
 UTARUS_LOADED_BY_HOST:'1', UTARUS_DATA_ROOT:'/opt/velovest-v4-rehearsal/data',
 DEEPSEEK_API_KEY:'rehearsal-placeholder-no-network', UTARUS_AGENT_NAME:'Invage',
 INVAGE_PRODUCT_PROFILE:'consultant', INVAGE_ONBOARD_TOKEN_TTL_MIN:'15', INVAGE_PUBLIC_LANDING_URL:'https://rehearsal.invalid', INVAGE_SLACK_WORKSPACE_INVITE_URL:'https://rehearsal.invalid/invite', SESSION_SECRET:randomBytes(32).toString('hex'),
 UTARUS_MCP_ENABLED:'false', UTARUS_BILLING_ENABLED:'false', UTARUS_DYNAMIC_WORKFLOWS:'false',
 UTARUS_LIFECYCLE_MAIL_ENABLED:'false', UTARUS_LLM_PROVIDER:'deepseek',
 UTARUS_LLM_PROFILES:JSON.stringify({daily:{provider:'deepseek'},heavy:{provider:'deepseek'},vision:{provider:'deepseek'}}),
 UTARUS_LLM_ROUTING:JSON.stringify({default:'daily',utility:'daily',heavy:'heavy'}),
});
for(const name of ['TELEGRAM_BOT_TOKEN','SLACK_BOT_TOKEN','SLACK_APP_TOKEN','SLACK_SIGNING_SECRET','INVAGE_BOOKS_DATABASE_URL']) {
 if(process.env[name]) throw new Error('External integration present in rehearsal');
}

const child=spawn(process.execPath,['--import','tsx','src/index.ts'],{cwd:'/opt/velovest-v4-rehearsal',env:{...process.env,WEB_ONLY:'true',WEBAPP_PORT:'3130'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
const closed=new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
try{
 let healthy=false;
 for(let i=0;i<60;i++){
  if(child.exitCode!==null)break;
  try{const r=await fetch('http://127.0.0.1:3130/health',{signal:AbortSignal.timeout(1000)});if(r.status===200){healthy=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 if(!healthy)throw new Error('WEB_ONLY entry did not become healthy; inspect protected smoke log');
 child.kill('SIGTERM');
 const result=await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Graceful shutdown timed out')),15000))]);
 if(result.code!==0||result.signal!==null)throw new Error('WEB_ONLY did not exit cleanly');
 console.log(JSON.stringify({webOnly:'passed',stdin:'closed',cliIdentity:'unset',shutdown:'SIGTERM exit0'}));
}finally{if(child.exitCode===null)child.kill('SIGTERM');writeFileSync('/var/lib/velovest/web-only-smoke.log',logs,{mode:0o600});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
