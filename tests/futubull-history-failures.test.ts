import { expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({execFile:vi.fn()}));
vi.mock('node:child_process',()=>({execFile:mocks.execFile}));
const {fetchFutubullSnapshot}=await import('../src/futubull/futubull-client.js');
const {futubullAdapter}=await import('../src/futubull/futubull-adapter.js');
const credentials={opend_port:'11111',security_firm:'FUTUSG',acc_id:'1'};
const plan={mode:'incremental' as const,from:'2026-10-01T00:00:00Z',through:'2026-10-23T00:00:00Z'};
it('can recover a valid cloud snapshot independently of malformed historical fills',()=>{
 const raw={kind:'json' as const,body:Buffer.from(JSON.stringify({schema:'invage.futubull.cloud.raw.v1',acc_id:'1',fetched_at:'2026-10-23T00:00:00Z',authorized:{s:'ok'},funds:{s:'ok',d:{us_cash:'100'}},positions:{s:'ok',d:[]},fills_history:{start:'1',end:'2',rows:[{deal_id:'broken'}]},orders_history:{start:'1',end:'2',rows:[]}}))};
 expect(()=>futubullAdapter.parseToStatement(raw,'futubull')).toThrow();
 expect(futubullAdapter.parseToStatement(raw,'futubull',false)).toMatchObject({account_id:'1',cash:[{currency:'USD',amount:100}],lots:[]});
});
it('keeps an emitted OpenD snapshot when optional history times out',async()=>{
 const core={schema:'invage.futubull.raw.v1',acc_id:'1',funds:[{cash:'100'}],positions:[],history_error:'OpenD history did not finish; retry historical enrichment.'};
 mocks.execFile.mockImplementation((_bin,_args,_opts,callback)=>{queueMicrotask(()=>callback(new Error('timeout'),'INVAGE_FUTU_JSON:'+JSON.stringify(core)+'\n'));return {stdin:{end:vi.fn()}}});
 expect(await fetchFutubullSnapshot(credentials,plan)).toEqual(core);
});
it('does not treat a primary OpenD failure as a valid empty snapshot',async()=>{
 mocks.execFile.mockImplementation((_bin,_args,_opts,callback)=>{queueMicrotask(()=>callback(new Error('failed'),'INVAGE_FUTU_JSON:{"error":"positions unavailable"}\n'));return {stdin:{end:vi.fn()}}});
 await expect(fetchFutubullSnapshot(credentials,plan)).rejects.toThrow('positions unavailable');
});

it('recovers the emitted primary snapshot even when a later SDK failure emits an error record',async()=>{
 const core={schema:'invage.futubull.raw.v1',acc_id:'1',funds:[{cash:'100'}],positions:[],history_error:'History interrupted'};
 mocks.execFile.mockImplementation((_bin,_args,_opts,callback)=>{queueMicrotask(()=>callback(new Error('failed'),'INVAGE_FUTU_JSON:'+JSON.stringify(core)+'\nINVAGE_FUTU_JSON:{"error":"later SDK error"}\n'));return {stdin:{end:vi.fn()}}});
 expect(await fetchFutubullSnapshot(credentials,plan)).toEqual(core);
});

it('uses a complete earlier snapshot when a timeout truncates the final history record',async()=>{
 const core={schema:'invage.futubull.raw.v1',acc_id:'1',funds:[{cash:'100'}],positions:[],history_error:'History interrupted'};
 mocks.execFile.mockImplementation((_bin,_args,_opts,callback)=>{queueMicrotask(()=>callback(new Error('timeout'),'INVAGE_FUTU_JSON:'+JSON.stringify(core)+'\nINVAGE_FUTU_JSON:{"history":'));return {stdin:{end:vi.fn()}}});
 expect(await fetchFutubullSnapshot(credentials,plan)).toEqual(core);
});

it('revisits older unknown OpenD fees during incremental sync with the original account scope',async()=>{
 const {mapFutubullHistory}=await import('../src/futubull/futubull-history.js');
 const previous=mapFutubullHistory({acc_id:'1',history:{plan:{...plan,from:'2024-01-01T00:00:00Z'},deals:[{deal_id:'fill',order_id:'order',code:'US.AAPL',qty:'1',price:'10',trd_side:'BUY',create_time:'2024-05-01 10:00:00'}],orders:[]}},'futubull')!;
 let input:any;
 const core={schema:'invage.futubull.raw.v1',acc_id:'1',funds:[{cash:'100'}],positions:[]};
 mocks.execFile.mockImplementation((_bin,_args,_opts,callback)=>{queueMicrotask(()=>callback(null,'INVAGE_FUTU_JSON:'+JSON.stringify(core)));return {stdin:{end:(value:string)=>{input=JSON.parse(value);}}};});
 await fetchFutubullSnapshot(credentials,plan,previous);
 expect(input.history).toEqual({...plan,from:'2024-01-01T00:00:00Z'});
 await expect(fetchFutubullSnapshot({...credentials,acc_id:'2'},plan,previous)).rejects.toThrow(/scope mismatch/);
});
