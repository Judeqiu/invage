import {describe,it,expect,beforeEach} from 'vitest';
import {mkdirSync,mkdtempSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {listRawData,fetchRawData,latestBrokerRawData} from '../src/raw-data/store.js';
import {createRawDataTools} from '../src/tools/raw_data.js';
let root:string;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'raw-data-'));process.env.UTARUS_DATA_ROOT=root;});
function file(slug:string,path:string,body:string|Buffer){const full=join(root,'drive',slug,path);mkdirSync(join(full,'..'),{recursive:true});writeFileSync(full,body);}
describe('raw-data retrieval',()=>{
 it('lists successful syncs, failed archives, and uploads across channels without inventing provenance',()=>{
  file('11111111-1111-4111-8111-111111111111','ibkr-flex/activity.xml','<raw/>');file('11111111-1111-4111-8111-111111111111','tiger-raw/snapshot.json','{}');file('11111111-1111-4111-8111-111111111111','moomoo-raw/snapshot.json','{}');file('11111111-1111-4111-8111-111111111111','webull-raw/snapshot.json','{}');file('11111111-1111-4111-8111-111111111111','broker-raw/another-bank/case/raw.csv','x,y');file('11111111-1111-4111-8111-111111111111','bank-statement.csv','original');
  file('22222222-2222-4222-8222-222222222222','private.csv','other owner');
  const got=listRawData('11111111-1111-4111-8111-111111111111',0,100);expect(got.total).toBe(6);expect(got.files.map(f=>f.channel).sort()).toEqual(['another-bank','ibkr','moomoo','tiger','webull',null].sort());
  expect(got.files.find(f=>f.channel==='tiger')?.source_kind).toBe('broker-sync');
  expect(got.files.find(f=>f.channel==='moomoo')?.source_kind).toBe('broker-sync');
  expect(got.files.find(f=>f.channel==='webull')?.source_kind).toBe('broker-sync');
  expect(listRawData('11111111-1111-4111-8111-111111111111',0,1).next_offset).toBe(1);expect(listRawData('11111111-1111-4111-8111-111111111111',0,100,'another-bank').total).toBe(1);
 });
 it('returns all original UTF8 bytes over bounded pages including split multibyte characters',()=>{
  const original='abcd你好🙂end';file('11111111-1111-4111-8111-111111111111','raw.txt',original);const item=listRawData('11111111-1111-4111-8111-111111111111',0,10).files[0]!;let offset:number|null=0;let result='';
  while(offset!==null){const page=fetchRawData('11111111-1111-4111-8111-111111111111',item.id,item.version,offset,5,'utf8');result+=page.content;offset=page.next_offset;}
  expect(result).toBe(original);
 });
 it('returns exact binary bytes explicitly and detects stale file versions',()=>{
  file('11111111-1111-4111-8111-111111111111','raw.bin',Buffer.from([255,0,1,2,3]));const item=listRawData('11111111-1111-4111-8111-111111111111',0,10).files[0]!;
  expect(Buffer.from(fetchRawData('11111111-1111-4111-8111-111111111111',item.id,item.version,0,10,'base64').content,'base64')).toEqual(Buffer.from([255,0,1,2,3]));
  expect(()=>fetchRawData('11111111-1111-4111-8111-111111111111',item.id,item.version,0,10,'utf8')).toThrow();
  file('11111111-1111-4111-8111-111111111111','raw.bin','changed contents');expect(()=>fetchRawData('11111111-1111-4111-8111-111111111111',item.id,item.version,0,10,'utf8')).toThrow(/changed/);
 });
 it('rejects traversal, absolute paths and symlinks, including a user-root symlink',()=>{
  file('11111111-1111-4111-8111-111111111111','own.txt','own');file('22222222-2222-4222-8222-222222222222','secret.txt','secret');const item=listRawData('11111111-1111-4111-8111-111111111111',0,10).files[0]!;
  for(const id of ['../bob/secret.txt','/etc/passwd','folder/../../bob/secret.txt'])expect(()=>fetchRawData('11111111-1111-4111-8111-111111111111',id,item.version,0,10,'utf8')).toThrow();
  symlinkSync(join(root,'drive','22222222-2222-4222-8222-222222222222','secret.txt'),join(root,'drive','11111111-1111-4111-8111-111111111111','linked.txt'));expect(()=>listRawData('11111111-1111-4111-8111-111111111111',0,10)).toThrow(/Symlink/);
  symlinkSync(join(root,'drive','22222222-2222-4222-8222-222222222222'),join(root,'drive','33333333-3333-4333-8333-333333333333'));expect(()=>listRawData('33333333-3333-4333-8333-333333333333',0,10)).toThrow();
 });
 it('binds tools to framework identity, ignoring attempts to select another user',async()=>{
  file('11111111-1111-4111-8111-111111111111','mine.csv','mine');file('22222222-2222-4222-8222-222222222222','theirs.csv','theirs');const tools=createRawDataTools('11111111-1111-4111-8111-111111111111');
  const result=await tools[0]!.execute('call',{offset:0,limit:10,user_id:'22222222-2222-4222-8222-222222222222'});
  expect(JSON.stringify(result.details)).toContain('mine.csv');expect(JSON.stringify(result.details)).not.toContain('theirs.csv');
 });
 it('reports an empty drive without fabricating sources and rejects invalid pagination',()=>{
  expect(listRawData('11111111-1111-4111-8111-111111111111',0,10)).toEqual({files:[],total:0,next_offset:null});expect(()=>listRawData('11111111-1111-4111-8111-111111111111',-1,10)).toThrow();
 });
 it('selects the newest broker payload and skips triage case metadata',()=>{
  file('11111111-1111-4111-8111-111111111111','broker-raw/ibkr/case-1/raw.xml','<failed/>');
  file('11111111-1111-4111-8111-111111111111','broker-raw/ibkr/case-1/case.yaml','status: failed');
  expect(latestBrokerRawData('11111111-1111-4111-8111-111111111111','ibkr')?.id).toBe('broker-raw/ibkr/case-1/raw.xml');
  expect(latestBrokerRawData('11111111-1111-4111-8111-111111111111','tiger')).toBeNull();
 });
});

describe('framework registration',()=>{
 it('provides the tools to every consultant agent and excludes them in incognito',async()=>{
  const {buildFrameworkAgentList}=await import('../src/agents/framework-agents.js');
  for(const entry of buildFrameworkAgentList('consultant')){
   const factory=entry.extension.tools;
   if(typeof factory!=='function')throw new Error('Expected bound tool factory');
   const names=(await factory('11111111-1111-4111-8111-111111111111',false)).map(t=>t.name);
   expect(names).toContain('list_raw_data');expect(names).toContain('fetch_raw_data');
   expect((await factory('11111111-1111-4111-8111-111111111111',false,true)).map(t=>t.name)).not.toContain('fetch_raw_data');
  }
 });
});
