import {beforeEach,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const mocks=vi.hoisted(()=>({load:vi.fn(),save:vi.fn(),projection:vi.fn()}));
vi.mock('utarus',async importOriginal=>({...await importOriginal<typeof import('utarus')>(),loadSessionState:mocks.load,saveState:mocks.save}));
vi.mock('../src/state/projection-store.js',async importOriginal=>({...await importOriginal<typeof import('../src/state/projection-store.js')>(),requirePortfolioProjection:mocks.projection}));
import {createExperienceSettingsRouter,personalRiskManifest} from '../src/webapp/experience-settings.js';
import {createDashboardApiRouter} from '../src/webapp/dashboard-api.js';
let users:Record<string,any>;
beforeEach(()=>{
  users={a:{state:{user:{id:'a'},profile:{},log:[],cash:{amount:100,currency:'USD'}},revision:1},b:{state:{user:{id:'b'},profile:{},log:[]},revision:1}};
  mocks.projection.mockReset().mockReturnValue({dashboard:{generatedAt:'2026-10-26T00:00:00Z',model:null}});
  mocks.load.mockReset().mockImplementation(async req=>structuredClone(users[req.user.userId]));
  mocks.save.mockReset().mockImplementation(async (state,revision)=>{if(users[state.user.id].revision!==revision)throw Error('revision conflict');users[state.user.id]={state:structuredClone(state),revision:revision+1};});
});
function app(){const a=express();a.use(express.json());a.use((req,_res,next)=>{if(req.headers['x-user'])(req as any).user={userId:req.headers['x-user']};next();});a.use('/settings',createExperienceSettingsRouter());a.get('/manifest',personalRiskManifest,(_req,res)=>res.json({sessionKey:'framework-owned',nav:[{id:'dashboard'},{id:'account-risk'}],routes:[{path:'/dashboard'},{path:'/risk'}]}));return a;}
it('is off by default, saves for the signed-in user only, and preserves financial data',async()=>{
  const a=app();await request(a).get('/settings').expect(401);
  expect((await request(a).get('/settings').set('x-user','a').expect(200)).body).toEqual({account_risk:false,show_daily_changes:false,revision:1});
  await request(a).put('/settings?slug=b').set('x-user','a').send({account_risk:true,revision:1}).expect(200);
  expect(users.a.state.experience_settings.account_risk).toBe(true);expect(users.b.state.experience_settings).toBeUndefined();expect(users.a.state.cash).toEqual({amount:100,currency:'USD'});
  expect((await request(a).get('/settings').set('x-user','b')).body.account_risk).toBe(false);
});
it('rejects malformed preferences and stale writes; disabling persists',async()=>{
  const a=app();for(const body of [{account_risk:'true',revision:1},{account_risk:true,revision:1,userId:'b'},{account_risk:true}])await request(a).put('/settings').set('x-user','a').send(body).expect(400);
  await request(a).put('/settings').set('x-user','a').send({account_risk:true,revision:0}).expect(409);
  await request(a).put('/settings').set('x-user','a').send({account_risk:true,revision:1}).expect(200);
  await request(a).put('/settings').set('x-user','a').send({account_risk:false,revision:2}).expect(200);
  expect(users.a.state.experience_settings.account_risk).toBe(false);
});
it('filters both navigation and routes per user and fails closed without a preference',async()=>{
  const a=app();users.a.state.experience_settings={account_risk:true};
  const first=await request(a).get('/manifest').set('x-user','a').expect(200);expect(first.body.nav).toHaveLength(2);expect(first.body.sessionKey).toBe('framework-owned');expect(first.headers['cache-control']).toBe('private, no-store');
  const second=await request(a).get('/manifest').set('x-user','b').expect(200);expect(second.body.nav).toEqual([{id:'dashboard'}]);expect(second.body.routes).toEqual([{path:'/dashboard'}]);
  mocks.load.mockRejectedValueOnce(Error('offline'));expect((await request(a).get('/manifest').set('x-user','a')).body.nav).toHaveLength(1);
});
it('blocks risk API before loading financial projections when disabled',async()=>{
  const a=express();a.use((req,_res,next)=>{if(req.headers['x-user'])(req as any).user={userId:req.headers['x-user']};next();});a.use(createDashboardApiRouter());
  await request(a).get('/account-risk').expect(401);
  const off=await request(a).get('/account-risk').set('x-user','a').expect(403);expect(off.body.error).toBe('page_disabled');expect(off.headers['cache-control']).toBe('private, no-store');expect(mocks.projection).not.toHaveBeenCalled();
  users.a.state.experience_settings={account_risk:true};
  const own=await request(a).get('/account-risk?slug=b').set('x-user','a').expect(200);expect(own.body.accounts).toEqual([]);
  expect(mocks.projection.mock.calls[0][0].user.id).toBe('a');
  await request(a).get('/account-risk?slug=a').set('x-user','b').expect(403);
});

it('persists daily changes independently per user, validates writes, and supports disabling',async()=>{
  const a=app();users.a.state.experience_settings={account_risk:true};
  await request(a).put('/settings').set('x-user','a').send({show_daily_changes:'yes',revision:1}).expect(400);
  await request(a).put('/settings').set('x-user','a').send({show_daily_changes:true,revision:0}).expect(409);
  const enabled=await request(a).put('/settings?slug=b').set('x-user','a').send({show_daily_changes:true,revision:1}).expect(200);
  expect(enabled.body).toEqual({account_risk:true,show_daily_changes:true,revision:2});
  expect(users.a.state.cash).toEqual({amount:100,currency:'USD'});
  expect((await request(a).get('/settings').set('x-user','b')).body.show_daily_changes).toBe(false);
  await request(a).put('/settings').set('x-user','a').send({account_risk:false,revision:2}).expect(200);
  expect(users.a.state.experience_settings.show_daily_changes).toBe(true);
  await request(a).put('/settings').set('x-user','a').send({show_daily_changes:false,revision:3}).expect(200);
  expect(users.a.state.experience_settings.show_daily_changes).toBe(false);
});
