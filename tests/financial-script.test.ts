import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFinancialScriptTool, executeFinancialPython, SCRIPT_CALCULATION_RULE } from '../src/tools/financial_script.js';
import { resolveInvestorFromChannel } from '../src/tools/channel.js';
vi.mock('../src/tools/channel.js',async original=>({...await original<typeof import('../src/tools/channel.js')>(),resolveInvestorFromChannel:vi.fn()}));
let root:string;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'financial-script-'));process.env.UTARUS_DATA_ROOT=root;vi.mocked(resolveInvestorFromChannel).mockResolvedValue({revision:4,state:{user:{id:'11111111-2222-4333-8444-555555555555',created_at:'2026-01-01',auth_token:'secret'},profile:{display_name:'Test',contact_email:''},log:[]}});});
afterEach(()=>{delete process.env.UTARUS_DATA_ROOT;rmSync(root,{recursive:true,force:true});});
it('executes exact agent-authored arithmetic and persists a reproducible script/input/output receipt',async()=>{
 const result=await createFinancialScriptTool().execute('calc',{title:'Exact decimal sum',provenance:'Test broker fields, same account USD snapshot',inputs:{a:'0.1',b:'0.2'},script:'from fractions import Fraction\nprint(json.dumps({"sum":str(Fraction(inputs["a"])+Fraction(inputs["b"])),"currency":"USD"}))'});
 const r=result.details as any;expect(r.status).toBe('succeeded');expect(JSON.parse(r.stdout)).toEqual({sum:'3/10',currency:'USD'});
 const path=join(root,'drive','11111111-2222-4333-8444-555555555555');
 expect(readFileSync(join(path,r.script_file),'utf8')).toContain('Fraction');
 expect(JSON.parse(readFileSync(join(path,r.inputs_file),'utf8'))).toEqual({a:'0.1',b:'0.2'});
 expect(JSON.parse(readFileSync(join(path,r.receipt_file),'utf8'))).toMatchObject({status:'succeeded',input_revision:4,provenance:'Test broker fields, same account USD snapshot'});
 expect(SCRIPT_CALCULATION_RULE).toContain('must not perform calculations');
});
it('cannot read host user files or inherit credentials, while standard-library calculations work',async()=>{
 const secret=join(root,'secret.txt');writeFileSync(secret,'HOST_SECRET');process.env.FINANCIAL_SCRIPT_TEST_SECRET='ENV_SECRET';
 try{
  const r=await executeFinancialPython('import os\ntry:\n print(open(inputs["path"]).read())\nexcept FileNotFoundError:\n print("host-file-unavailable")\nprint(os.environ.get("FINANCIAL_SCRIPT_TEST_SECRET","no-environment-secret"))',{path:secret});
  expect(r.code).toBe(0);expect(r.stdout).toContain('host-file-unavailable');expect(r.stdout).toContain('no-environment-secret');expect(r.stdout).not.toMatch(/HOST_SECRET|ENV_SECRET/);
 }finally{delete process.env.FINANCIAL_SCRIPT_TEST_SECRET;}
});
it('returns script failures as failures rather than usable calculation results',async()=>{
 const r=(await createFinancialScriptTool().execute('calc',{title:'Bad script',provenance:'Test',inputs:{},script:'print(1/0)'})).details as any;
 expect(r.status).toBe('failed');expect(r.stderr).toContain('ZeroDivisionError');expect(r.exit_code).not.toBe(0);
});
it('supports explicit cancellation without an automatic execution cutoff',async()=>{
 const controller=new AbortController();const work=executeFinancialPython('while True:\n pass',{},controller.signal);setTimeout(()=>controller.abort(),100);
 const result=await work;expect(result.signal).not.toBeNull();
});
