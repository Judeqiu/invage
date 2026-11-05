import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from 'utarus';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';

export const SCRIPT_CALCULATION_RULE = `\nMANDATORY NUMERIC RULE: You must not perform calculations mentally or in generated prose. Every sum, subtraction, product, division, FX conversion, percentage, reconciliation gap and scenario result must come from a broker field, saved application calculation, query_data aggregate, or an actually executed calculation script. For on-the-fly calculations, write a Python script and call run_financial_calculation with source inputs and their provenance. Use fractions.Fraction on exact decimal strings for financial arithmetic; choose any output rounding explicitly in the script and explain it. Never silently treat unknowns as zero, infer currency/multipliers, or round an unexplained discrepancy away. Only quote numbers returned by tools or printed by a successful execution, and cite its receipt ID/source. A script failure is not a result. Keep script inputs bound to the selected account, currency, units and valuation time; do not substitute fresh quotes for a selected saved generation.`;

/** A separate user/network/mount/PID namespace, with no application files or credentials. */
export function executeFinancialPython(script: string, inputs: unknown, signal?: AbortSignal): Promise<{code:number|null;signal:string|null;stdout:string;stderr:string;execution:string}> {
  const inputJson=JSON.stringify(inputs);
  if(inputJson===undefined)throw new Error('Calculation inputs must be JSON');
  const execution=`import json\ninputs = json.loads(bytes.fromhex('${Buffer.from(inputJson).toString('hex')}').decode('utf-8'))\n${script}\n`;
  const args=['--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--chdir','/tmp','--clearenv','--','/usr/bin/python3','-I','-S','-'];
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new Error('Calculation cancelled'));
    const child=spawn('/usr/bin/bwrap',args,{env:{},stdio:['pipe','pipe','pipe']});
    const stdout:Buffer[]=[],stderr:Buffer[]=[];
    const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>stdout.push(Buffer.from(chunk)));child.stderr.on('data',chunk=>stderr.push(Buffer.from(chunk)));
    child.stdin.on('error',()=>{});
    child.once('error',error=>{signal?.removeEventListener('abort',abort);reject(error);});
    child.once('close',(code,exitSignal)=>{signal?.removeEventListener('abort',abort);resolve({code,signal:exitSignal,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8'),execution});});
    child.stdin.end(execution);
  });
}
export function createFinancialScriptTool(): AgentTool {
  return {
    name:'run_financial_calculation',label:'Run Financial Calculation Script',
    description:'Execute an agent-authored Python script for on-the-fly calculations; do not calculate in prose. inputs is available as a JSON object. Standard-library Python only, isolated from the network, host files, credentials and application state. Use Fraction from exact decimal strings. Print results as JSON with exact strings and explicit units/currency/rounding. Saves script, inputs, execution, stdout/stderr and a checksum receipt in this authenticated user’s Drive. Does not modify financial records. No automatic output truncation or execution cutoff; user cancellation stops the process.',
    parameters:Type.Object({...channelIdParams,title:Type.String(),script:Type.String(),inputs:Type.Unknown(),provenance:Type.String()}),
    async execute(_id,raw,signal){
      const output=(details:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(details)}],details});
      try{
        const p=raw as ChannelIds & {title:string;script:string;inputs:unknown;provenance:string};
        if(!p.title?.trim()||typeof p.script!=='string'||!p.script.trim()||!p.provenance?.trim())throw new Error('Calculation title, authored Python script and input provenance required');
        const snapshot=await resolveInvestorFromChannel(p),id=randomUUID(),relative=`calculations/${id}`;
        const directory=join(resolveDataRoot(),'drive',snapshot.state.user.id,relative);mkdirSync(directory,{recursive:true,mode:0o700});
        const save=(name:string,text:string)=>writeFileSync(join(directory,name),text,{mode:0o600,flag:'wx'});
        const inputText=JSON.stringify(p.inputs),hash=(text:string)=>createHash('sha256').update(text).digest('hex');
        if(inputText===undefined)throw new Error('JSON inputs required');
        save('script.py',p.script);save('inputs.json',inputText);
        const execution=await executeFinancialPython(p.script,p.inputs,signal);
        save('execution.py',execution.execution);save('stdout.txt',execution.stdout);save('stderr.txt',execution.stderr);
        const receipt={receipt_id:id,title:p.title,created_at:new Date().toISOString(),input_revision:snapshot.revision,provenance:p.provenance,
          status:execution.code===0&&!execution.signal?'succeeded':'failed',exit_code:execution.code,signal:execution.signal,
          script_sha256:hash(p.script),inputs_sha256:hash(inputText),stdout_sha256:hash(execution.stdout),
          script_file:`${relative}/script.py`,inputs_file:`${relative}/inputs.json`,output_file:`${relative}/stdout.txt`};
        save('receipt.json',JSON.stringify(receipt,null,2));
        return output({...receipt,receipt_file:`${relative}/receipt.json`,stdout:execution.stdout,stderr:execution.stderr});
      }catch(error){return output({status:'failed',error:error instanceof Error?error.message:String(error)});}
    },
  };
}
