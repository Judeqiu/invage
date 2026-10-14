import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';import{tmpdir}from'node:os';
import{optionRelationshipsForState}from'../src/webapp/option-relationships-data.js';
import{mapMooMooBundleToStatement}from'../src/moomoo/moomoo-map.js';
import{runQuery}from'../src/data-query/engine.js';
import type{InvestorState}from'../src/state/portfolio-state.js';
const user='11111111-2222-4333-8444-555555555555',closing='US.AVGO261023C375000',opening='US.AVGO261218C400000';
let root:string;beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'moomoo-archive-scope-'));process.env.UTARUS_DATA_ROOT=root;});
afterEach(()=>{rmSync(root,{recursive:true,force:true});delete process.env.UTARUS_DATA_ROOT;});
function raw(){const time=String(Date.parse('2026-10-07T14:46:31Z')*1000);return{schema:'invage.moomoo.raw.v1' as const,acc_id:'A',fetched_at:'2026-10-14T00:00:00Z',authorized:{s:'ok'},funds:{s:'ok',d:{us_cash:'1000'}},positions:{s:'ok',d:[]},option_basicinfo:[closing,opening].map(code=>({code,stock_type:'DRVT',contract_size:100})),fills_history:{start:'946684800000000',end:'1791936000000000',rows:[{deal_id:'close',order_id:'parent',code:closing,trd_side:'BUY_BACK',qty:'1',price:'11.35',status:'OK',create_time:time},{deal_id:'open',order_id:'parent',code:opening,trd_side:'SELL_SHORT',qty:'1',price:'19.50',status:'OK',create_time:time}]}};}
function state():InvestorState{const r=raw();return{user:{id:user,created_at:'2026-01-01'},profile:{display_name:'Test',contact_email:''},log:[],portfolio:{},broker_connections:{moomoo:{enabled:true,credentials:{app_key:'key',private_key:readFileSync('tests/fixtures/moomoo/ed25519-private.pem','utf8'),acc_id:'A',sign_alg:'Ed25519'},last_sync:{at:r.fetched_at,ok:true,account_id:'A',as_of:'2026-10-14'}}},option_executions:mapMooMooBundleToStatement(r,'moomoo').option_executions};}
function archive(dir:string,name:string,value:unknown){const path=join(root,'drive',user,dir);mkdirSync(path,{recursive:true});writeFileSync(join(path,name),JSON.stringify(value));}
it('excludes legacy archives for other accounts without suppressing verified current-account history',()=>{
  const s=state();archive('broker-sync/moomoo','current.json',raw());archive('moomoo-raw','other.json',{...raw(),acc_id:'B'});
  const before=structuredClone(s),result=optionRelationshipsForState(s,{channel:'moomoo'});
  expect(result.groups).toHaveLength(1);expect(result.groups[0].relationships[0].cash).toBe('815');
  expect(result.gaps.some(g=>g.source==='moomoo-raw/other.json'&&g.reason.includes('excluded'))).toBe(true);
  expect(result.historyGaps.some(g=>g.blocksTotals)).toBe(false);expect(s).toEqual(before);
  expect(runQuery({state:s,revision:1},{from:'option_executions',group_by:['currency'],aggregates:[{op:'sum',field:'gross_premium',as:'gross'}]}).rows).toEqual([{currency:'USD',gross:'815.00'}]);
});
it('still blocks mixed-account records inside an archive claiming to belong to the selected account',()=>{
  const s=state(),bad=raw();(bad.fills_history.rows[0] as Record<string,unknown>).account_id='B';archive('broker-sync/moomoo','mixed.json',bad);
  const result=optionRelationshipsForState(s,{channel:'moomoo'});expect(result.groups).toEqual([]);expect(result.historyGaps.some(g=>g.blocksTotals)).toBe(true);
});
