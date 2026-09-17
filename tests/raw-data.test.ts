import {describe,it,expect,beforeEach} from 'vitest';
import {mkdirSync,mkdtempSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {listRawData,fetchRawData} from '../src/raw-data/store.js';
import {createRawDataTools} from '../src/tools/raw_data.js';
let root:string;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'raw-data-'));process.env.UTARUS_DATA_ROOT=root;});
function file(slug:string,path:string,body:string|Buffer){const full=join(root,'drive',slug,path);mkdirSync(join(full,'..'),{recursive:true});writeFileSync(full,body);}
describe('raw-data retrieval',()=>{
 it('lists successful syncs, failed archives, and uploads across channels without inventing provenance',()=>{
  file('alice','ibkr-flex/activity.xml','<raw/>');file('alice','tiger-raw/snapshot.json','{}');file('alice','moomoo-raw/snapshot.json','{}');file('alice','broker-raw/another-bank/case/raw.csv','x,y');file('alice','bank-statement.csv','original');
  file('bob','private.csv','other owner');
  const got=listRawData('alice',0,100);expect(got.total).toBe(5);expect(got.files.map(f=>f.channel).sort()).toEqual(['another-bank','ibkr','moomoo','tiger',null].sort());
  expect(got.files.find(f=>f.channel==='tiger')?.source_kind).toBe('broker-sync');
  expect(got.files.find(f=>f.channel==='moomoo')?.source_kind).toBe('broker-sync');
  expect(listRawData('alice',0,1).next_offset).toBe(1);expect(listRawData('alice',0,100,'another-bank').total).toBe(1);
 });
 it('returns all original UTF8 bytes over bounded pages including split multibyte characters',()=>{
  const original='abcd你好🙂end';file('alice','raw.txt',original);const item=listRawData('alice',0,10).files[0]!;let offset:number|null=0;let result='';
  while(offset!==null){const page=fetchRawData('alice',item.id,item.version,offset,5,'utf8');result+=page.content;offset=page.next_offset;}
  expect(result).toBe(original);
 });
 it('returns exact binary bytes explicitly and detects stale file versions',()=>{
  file('alice','raw.bin',Buffer.from([255,0,1,2,3]));const item=listRawData('alice',0,10).files[0]!;
  expect(Buffer.from(fetchRawData('alice',item.id,item.version,0,10,'base64').content,'base64')).toEqual(Buffer.from([255,0,1,2,3]));
  expect(()=>fetchRawData('alice',item.id,item.version,0,10,'utf8')).toThrow();
  file('alice','raw.bin','changed contents');expect(()=>fetchRawData('alice',item.id,item.version,0,10,'utf8')).toThrow(/changed/);
 });
 it('rejects traversal, absolute paths and symlinks, including a user-root symlink',()=>{
  file('alice','own.txt','own');file('bob','secret.txt','secret');const item=listRawData('alice',0,10).files[0]!;
  for(const id of ['../bob/secret.txt','/etc/passwd','folder/../../bob/secret.txt'])expect(()=>fetchRawData('alice',id,item.version,0,10,'utf8')).toThrow();
  symlinkSync(join(root,'drive','bob','secret.txt'),join(root,'drive','alice','linked.txt'));expect(()=>listRawData('alice',0,10)).toThrow(/Symlink/);
  symlinkSync(join(root,'drive','bob'),join(root,'drive','mallory'));expect(()=>listRawData('mallory',0,10)).toThrow();
 });
 it('binds tools to framework identity, ignoring attempts to select another user',async()=>{
  file('alice','mine.csv','mine');file('bob','theirs.csv','theirs');const tools=createRawDataTools('alice');
  const result=await tools[0]!.execute('call',{offset:0,limit:10,user_slug:'bob'});
  expect(JSON.stringify(result.details)).toContain('mine.csv');expect(JSON.stringify(result.details)).not.toContain('theirs.csv');
 });
 it('reports an empty drive without fabricating sources and rejects invalid pagination',()=>{
  expect(listRawData('alice',0,10)).toEqual({files:[],total:0,next_offset:null});expect(()=>listRawData('alice',-1,10)).toThrow();
 });
});

describe('framework registration',()=>{
 it('provides the tools to every consultant agent and excludes them in incognito',async()=>{
  const {buildFrameworkAgentList}=await import('../src/agents/framework-agents.js');
  for(const entry of buildFrameworkAgentList('consultant')){
   const factory=entry.extension.tools;
   if(typeof factory!=='function')throw new Error('Expected bound tool factory');
   const names=(await factory('alice',false)).map(t=>t.name);
   expect(names).toContain('list_raw_data');expect(names).toContain('fetch_raw_data');
   expect((await factory('alice',false,true)).map(t=>t.name)).not.toContain('fetch_raw_data');
  }
 });
});
