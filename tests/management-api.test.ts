import { beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createManagementRouter, managerManifest } from '../src/management/api.js';
import type { SubmissionRepository } from '../src/signup/submissions.js';
import type { ManagementRepository } from '../src/management/repository.js';

const actions=vi.hoisted(()=>({issue:vi.fn(),invites:vi.fn()}));
vi.mock('utarus',()=>({
  requireAuth:(req:any,res:any,next:any)=>req.user?next():res.status(401).json({error:'Unauthorized'}),
  requireAdmin:(req:any,res:any,next:any)=>req.user?.type==='admin'?next():res.status(403).json({error:'Admin access required'}),
  sessionUser:(req:any)=>req.user,
  issueInviteCode:actions.issue,listInviteCodes:actions.invites,isBillingEnabled:()=>false,
}));
const ids={admin:'00000000-0000-4000-8000-000000000001',manager:'00000000-0000-4000-8000-000000000002',user:'00000000-0000-4000-8000-000000000003'};
let assigned=true;
const identity=vi.fn(async(id:string)=>({userId:id,admin:id===ids.admin,deleted:false,manager:id===ids.manager&&assigned}));
const repository={identity,isManager:vi.fn(async(id:string)=>id===ids.manager&&assigned),
  subscribers:vi.fn(async()=>[{userId:ids.user,displayName:'Subscriber'}]),
  setRole:vi.fn(async(_id:string,enabled:boolean)=>{assigned=enabled;return{manager:enabled,admin:false,deleted:false};})};
const signup={disabledDates:vi.fn(async()=>['2026-11-07']),setDateEnabled:vi.fn(async()=>{})};
const app=express().use(express.json());
app.use((req:any,_res,next)=>{const key=req.get('x-test-user') as keyof typeof ids;if(ids[key])req.user={type:key==='admin'?'admin':'user',userId:ids[key],displayName:key};next();});
app.get('/manifest',managerManifest(()=>repository as unknown as ManagementRepository),(_req,res)=>res.json({nav:[{id:'dashboard'}],routes:[{path:'/dashboard'}]}));
app.use('/api/management',createManagementRouter(()=>repository as unknown as ManagementRepository,()=>signup as unknown as SubmissionRepository));
const mutate=(method:'post'|'patch',path:string,user='manager')=>request(app)[method]('/api/management'+path).set('x-test-user',user).set('Host','management.test').set('Origin','https://management.test');
beforeEach(()=>{
  assigned=true;vi.clearAllMocks();
  actions.issue.mockResolvedValue({code:'INV-TEST',created_at:'2026-11-02'});
  actions.invites.mockResolvedValue([{code:'INV-ORDINARY',created_at:'2026-11-02'}, {code:'INV-ORGADMIN',org_id:'org',role:'admin',created_at:'2026-11-02'}]);
});

it('denies anonymous and ordinary accounts, including forged role and target query parameters',async()=>{
  await request(app).get('/api/management/users').expect(401);
  await request(app).get('/api/management/users?role=velovest_manager&userId='+ids.manager).set('x-test-user','user').expect(403);
  expect(repository.subscribers).not.toHaveBeenCalled();
});
it('exposes read-only subscriber routes but denies every account or admin mutation',async()=>{
  await request(app).get('/api/management/users?q=Subscriber').set('x-test-user','manager').expect(200);
  expect(repository.subscribers).toHaveBeenCalledWith('Subscriber');
  for(const path of ['/users/'+ids.user,'/users/'+ids.user+'/reset-trial','/billing/comp','/admincodes','/config','/backups']) {
    await mutate('post',path).send({admin:true}).expect(403);
    await mutate('patch',path).send({admin:true}).expect(403);
  }
});
it('only full admins can read or change a role, with same-origin JSON and strict payloads',async()=>{
  for(const user of ['manager','user']) {
    await request(app).get('/api/management/roles/'+ids.user).set('x-test-user',user).expect(403);
    await mutate('patch','/roles/'+ids.user,user).send({enabled:true}).expect(403);
  }
  await request(app).get('/api/management/roles/'+ids.user).set('x-test-user','admin').expect(200);
  await request(app).patch('/api/management/roles/'+ids.user).set('x-test-user','admin').send({enabled:true}).expect(403);
  await mutate('patch','/roles/'+ids.user,'admin').send({enabled:true,admin:true}).expect(400);
  await mutate('patch','/roles/'+ids.user,'admin').send({enabled:true}).expect(200);
  expect(repository.setRole).toHaveBeenCalledOnce();
});
it('issues only normal signup invites and rejects administrator, org and custom-code fields',async()=>{
  const response=await mutate('post','/invites').send({comment:'Customer signup'}).expect(200);
  expect(response.body.code).toBe('INV-TEST');
  expect(actions.issue).toHaveBeenCalledWith({isPlatformAdmin:true,issuerId:'velovest_manager:'+ids.manager,createdViaWeb:'velovest_manager:'+ids.manager,comment:'Customer signup'});
  for(const body of [{role:'admin'},{org_id:'some-org'},{customCode:'ADM-ESCALATE'},{admin:true}])await mutate('post','/invites').send(body).expect(400);
  expect(actions.issue).toHaveBeenCalledOnce();
  const codes=await request(app).get('/api/management/invites').set('x-test-user','manager').expect(200);
  expect(codes.body.codes.map((code:any)=>code.code)).toEqual(['INV-ORDINARY']);
});
it('revokes existing-session access and navigation immediately without changing the framework admin flag',async()=>{
  const manifest=await request(app).get('/manifest').set('x-test-user','manager').expect(200);
  expect(manifest.body.nav.map((item:any)=>item.id)).toContain('velovest-management');
  expect(manifest.headers['cache-control']).toBe('private, no-store');
  await mutate('patch','/roles/'+ids.manager,'admin').send({enabled:false}).expect(200);
  await request(app).get('/api/management/users').set('x-test-user','manager').expect(403);
  const revoked=await request(app).get('/manifest').set('x-test-user','manager').expect(200);
  expect(revoked.body.nav).toEqual([{id:'dashboard'}]);
});
it('fails closed on role lookup failure and rejects malformed user IDs',async()=>{
  await request(app).get('/api/management/users/not-a-uuid').set('x-test-user','manager').expect(400);
  repository.isManager.mockRejectedValueOnce(new Error('database unavailable'));
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  await request(app).get('/api/management/users').set('x-test-user','manager').expect(503);
  log.mockRestore();
});

it('accepts optional recipient email and rejects malformed values without issuing codes',async()=>{
  await mutate('post','/invites').send({comment:'Customer',recipientEmail:' Customer@Example.com '}).expect(200);
  expect(actions.issue).toHaveBeenCalledWith(expect.objectContaining({recipientEmail:'customer@example.com'}));
  for(const recipientEmail of ['invalid',123,null,'a@b.com\u0000']) await mutate('post','/invites').send({recipientEmail}).expect(400);
  expect(actions.issue).toHaveBeenCalledOnce();
  actions.invites.mockResolvedValue([{code:'INV-EMAIL',created_at:'2026-11-03',recipient_email:'customer@example.com'}]);
  const response=await request(app).get('/api/management/invites').set('x-test-user','manager').expect(200);
  expect(response.body.codes[0].recipientEmail).toBe('customer@example.com');
});

it('restricts date configuration to current managers and requires same-origin strict JSON mutations',async()=>{
  for(const user of ['user','admin']) await request(app).get('/api/management/signup-dates').set('x-test-user',user).expect(403);
  const dates=await request(app).get('/api/management/signup-dates').set('x-test-user','manager').expect(200);
  expect(dates.body.disabledDates).toEqual(['2026-11-07']);
  expect(dates.headers['cache-control']).toBe('private, no-store');
  await request(app).patch('/api/management/signup-dates/2026-11-07').set('x-test-user','manager').send({enabled:false}).expect(403);
  await mutate('patch','/signup-dates/2026-11-07').send({enabled:false,admin:true}).expect(400);
  await mutate('patch','/signup-dates/2026-11-07').send({enabled:false}).expect(200);
  expect(signup.setDateEnabled).toHaveBeenCalledWith('2026-11-07',false,expect.stringContaining(ids.manager));
  assigned=false;
  await mutate('patch','/signup-dates/2026-11-07').send({enabled:true}).expect(403);
});
