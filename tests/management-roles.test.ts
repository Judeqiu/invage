import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import pg from 'pg';
import { afterAll,beforeAll,beforeEach,expect,it } from 'vitest';
import { createAdminOnboardCode,validateInviteCode,redeemInviteInstantly } from 'utarus';
import { adminRouter } from '../node_modules/utarus/dist/webapp/chat/admin-router.js';
import { useTestDatabase,createInvestorFixture } from './helpers/database.js';
import { ManagementRepository } from '../src/management/repository.js';
import { createManagementRouter,managerManifest } from '../src/management/api.js';

const database=await useTestDatabase(),pool=new pg.Pool({connectionString:database.databaseUrl}),repository=new ManagementRepository(pool);
const ids={admin:randomUUID(),manager:randomUUID(),subscriber:randomUUID(),unassigned:randomUUID()};
const cookies={} as Record<keyof typeof ids,string>;
const app=express().use(cookieParser()).use(express.json());
app.use('/api/management',createManagementRouter(()=>repository));app.use('/api/admin',adminRouter);
// The real auth middleware is inside the management API; a manifest fixture
// uses that same session identity by mounting it after requireAuth separately.
const {requireAuth}=await import('utarus');
app.get('/manifest',requireAuth,managerManifest(()=>repository),(_req,res)=>res.json({nav:[],routes:[]}));
const patch=(id:string,body:unknown,key:keyof typeof ids='admin')=>request(app).patch('/api/management/roles/'+id)
  .set('Cookie',cookies[key]).set('Host','management.test').set('Origin','https://management.test').send(body);
beforeAll(async()=>{
  await pool.query(readFileSync('src/management/schema.sql','utf8'));
  await pool.query(readFileSync('src/management/schema.sql','utf8'));
  for(const key of Object.keys(ids) as Array<keyof typeof ids>) {
    await createInvestorFixture({user:{id:ids[key],created_at:'2026-11-02',admin:key==='admin',auth_token:randomUUID()},
      profile:{display_name:key,contact_email:key+'@example.invalid',private_note:'PRIVATE-PROFILE-MARKER'},log:[],
      broker_secret:'PRIVATE-BROKER-MARKER',...(key==='unassigned'?{management_role:'velovest_manager'}:{})});
    const token=randomUUID();
    await database.runtime.webAuth.issueSession({token,identity:{user:{type:key==='admin'?'admin':'user',userId:ids[key],displayName:key},
      origin:{origin:'registered-user',userId:ids[key]}},expiresAt:Date.now()+600000});cookies[key]='bindrive_session='+token;
  }
});
beforeEach(async()=>{await repository.setRole(ids.manager,true,'test operator');});
afterAll(async()=>{await pool.end();});

it('stores a separate manager role without elevating user.admin and audits only actual changes',async()=>{
  await patch(ids.subscriber,{enabled:true}).expect(200);await patch(ids.subscriber,{enabled:true}).expect(200);
  expect((await database.runtime.users.readById(ids.subscriber)).state.user.admin).toBe(false);
  const events=await pool.query('SELECT enabled FROM velovest_management.role_events WHERE user_id=$1',[ids.subscriber]);
  expect(events.rows).toEqual([{enabled:true}]);
  await patch(ids.subscriber,{enabled:false}).expect(200);
});
it('excludes admins from list, search and direct detail, projecting no credentials or private state',async()=>{
  const response=await request(app).get('/api/management/users').set('Cookie',cookies.manager).expect(200);
  expect(response.body.users.map((row:any)=>row.userId)).not.toContain(ids.admin);
  expect(response.body.users.map((row:any)=>row.userId)).toContain(ids.subscriber);
  const wire=JSON.stringify(response.body);
  for(const marker of ['PRIVATE-PROFILE-MARKER','PRIVATE-BROKER-MARKER','auth_token','password_hash'])expect(wire).not.toContain(marker);
  const search=await request(app).get('/api/management/users?q=admin@example.invalid').set('Cookie',cookies.manager).expect(200);
  expect(search.body.users).toEqual([]);
  await request(app).get('/api/management/users/'+ids.admin).set('Cookie',cookies.manager).expect(404);
});
it('does not trust profile/extension role claims and never grants manager access to framework administrator APIs',async()=>{
  await request(app).get('/api/management/users').set('Cookie',cookies.unassigned).expect(403);
  for(const path of ['/users','/invites','/admincodes','/reports/growth','/backups'])await request(app).get('/api/admin'+path).set('Cookie',cookies.manager).expect(403);
  await patch(ids.subscriber,{enabled:true},'manager').expect(403);
  await patch(ids.admin,{enabled:true}).expect(400);
});
it('creates a redeemable normal signup invite without exposing administrative codes',async()=>{
  const adminCode=await createAdminOnboardCode({createdBy:0,createdViaWeb:'test owner'});
  const created=await request(app).post('/api/management/invites').set('Cookie',cookies.manager)
    .set('Host','management.test').set('Origin','https://management.test').send({comment:'Manager signup'}).expect(200);
  const invite=await validateInviteCode(created.body.code);expect(invite.role).toBeUndefined();expect(invite.org_id).toBeUndefined();
  expect(created.body.onboardUrl).toContain('/login?invite=');
  const listed=await request(app).get('/api/management/invites').set('Cookie',cookies.manager).expect(200);
  expect(listed.body.codes.map((row:any)=>row.code)).toContain(created.body.code);
  expect(JSON.stringify(listed.body)).not.toContain(adminCode.code);
});
it('revokes a manager in an existing session and removes their navigation on refresh',async()=>{
  expect((await request(app).get('/manifest').set('Cookie',cookies.manager)).body.nav).toHaveLength(1);
  await patch(ids.manager,{enabled:false}).expect(200);
  await request(app).get('/api/management/users').set('Cookie',cookies.manager).expect(403);
  expect((await request(app).get('/manifest').set('Cookie',cookies.manager)).body.nav).toEqual([]);
});

it('uses the manager-entered email when the invitation creates an ordinary account',async()=>{
  const created=await request(app).post('/api/management/invites').set('Cookie',cookies.manager)
    .set('Host','management.test').set('Origin','https://management.test').send({recipientEmail:' Customer@Example.com '}).expect(200);
  expect(created.body.code).toMatch(/^IC-[A-F0-9]{8}$/);
  expect(created.body.recipientEmail).toBe('customer@example.com');
  const account=await redeemInviteInstantly({code:created.body.code,displayName:'Customer',web:true,language:'en'});
  expect(account.state.profile.contact_email).toBe('customer@example.com');
  expect(account.state.user.admin).not.toBe(true);
  expect(await repository.isManager(account.userId)).toBe(false);
  await expect(validateInviteCode(created.body.code)).rejects.toThrow(/used/);
});
