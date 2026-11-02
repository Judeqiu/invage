import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticateUser, hashPassword, verifyPassword } from 'utarus';
import { createSecretCodec } from 'utarus/database';
import { useTestDatabase, createInvestorFixture } from './helpers/database.js';
import { SubmissionRepository } from '../src/signup/submissions.js';
import { SignupReview, type ApprovalInput, type SignupMailer } from '../src/signup/review.js';
import { createSubmissionAdminRouter } from '../src/signup/api.js';

const database = await useTestDatabase();
const pool = new pg.Pool({ connectionString: database.databaseUrl });
const repository = new SubmissionRepository(pool);
const codec = createSecretCodec({keyId:'review-test',keyBase64:randomBytes(32).toString('base64')});
let configured = false;
let mailResult: Awaited<ReturnType<SignupMailer['send']>> = {outcome:'accepted',messageId:'test-provider-receipt'};
let holdSend: (() => Promise<void>) | undefined;
const sent: Array<{to:string;text:string;subject:string;userId:string}> = [];
const mailer: SignupMailer = {configured:()=>configured, async send(input) {sent.push(input); if (holdSend) await holdSend(); return mailResult;}};
const review = new SignupReview(repository,{codec:()=>codec,mailer,loginUrl:()=> 'https://chat.velovest.lextok.com/login'});
const app=express().use(cookieParser()).use(express.json({limit:Infinity}));
app.use('/admin',createSubmissionAdminRouter(()=>repository,()=>review));
let adminCookie: string, userCookie: string;
let counter=0;
const decision: ApprovalInput={paymentVerified:true,sessionConfirmed:true,sessionDate:'2026-11-02',sessionTime:'10:00',warningsAcknowledged:true};
async function submission(email?: string, file?: Buffer) {
  const reference='VV-'+String(++counter).padStart(6,'0');
  const customerEmail=email??`review-${counter}@example.invalid`;
  await repository.save({reference,packageId:'novice',sessionDate:'2026-11-02',sessionTime:'10:00',name:'Review customer',
    email:customerEmail,phone:'+65 12345678',bankTransactionId:reference,consentAccepted:true,
    proof:{filename:'proof.pdf',contentType:'application/pdf',data:file??Buffer.from('%PDF-1.4\n'+reference)}});
  return (await repository.list(reference))[0];
}
const approve=(id:string,body=decision)=>request(app).post(`/admin/submissions/${id}/approve`).set('Cookie',adminCookie).set('Host','signup.test').set('Origin','https://signup.test').send(body);
const send=(id:string,acknowledgeUnknown=false)=>request(app).post(`/admin/submissions/${id}/send-email`).set('Cookie',adminCookie).set('Host','signup.test').set('Origin','https://signup.test').send({acknowledgeUnknown});

beforeAll(async()=> {
  await pool.query(readFileSync('src/signup/schema.sql','utf8'));
  // Applying the upgrade twice preserves existing schemas and evidence.
  await pool.query(readFileSync('src/signup/schema.sql','utf8'));
  const token=randomUUID();
  await database.runtime.webAuth.issueSession({token,identity:{user:{type:'admin',displayName:'Review operator'},origin:{origin:'operator',subject:'review-test'}},expiresAt:Date.now()+600000});
  adminCookie=`bindrive_session=${token}`;
  const userId=randomUUID(),userToken=randomUUID();
  await createInvestorFixture({user:{id:userId,created_at:'2026-11-02',auth_token:randomUUID()},profile:{display_name:'Customer',contact_email:'customer@example.invalid'},log:[]});
  await database.runtime.webAuth.issueSession({token:userToken,identity:{user:{type:'user',displayName:'Customer',userId},origin:{origin:'registered-user',userId}},expiresAt:Date.now()+600000});
  userCookie=`bindrive_session=${userToken}`;
});
afterAll(async()=>{await pool.end();});

describe('Signup review, atomic account approval and access email delivery',()=>{
  it('protects detail, approve and send APIs from anonymous/user access and cross-origin mutations',async()=>{
    const row=await submission();
    for(const suffix of ['', '/approve','/send-email']) {
      const method=suffix?'post':'get';
      expect((await request(app)[method](`/admin/submissions/${row.id}${suffix}`).send({})).status).toBe(401);
      expect((await request(app)[method](`/admin/submissions/${row.id}${suffix}`).set('Cookie',userCookie).send({})).status).toBe(403);
    }
    expect((await request(app).post(`/admin/submissions/${row.id}/approve`).set('Cookie',adminCookie).send(decision)).status).toBe(403);
    expect((await request(app).post(`/admin/submissions/${row.id}/approve`).set('Cookie',adminCookie).set('Origin','https://evil.invalid').send(decision)).status).toBe(403);
    expect((await approve(row.id,{...decision,paymentVerified:false})).status).toBe(400);
    expect((await request(app).get('/admin/submissions/not-an-id').set('Cookie',adminCookie)).status).toBe(400);
  });
  it('previews known file signatures privately and never renders a forged SVG/HTML inline',async()=>{
    const pdf=await submission();
    const response=await request(app).get(`/admin/submissions/${pdf.id}/proof?preview=true`).set('Cookie',adminCookie);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('inline;');
    expect(response.headers['content-security-policy']).toContain('sandbox');
    expect(response.headers['cache-control']).toBe('no-store');
    const unsafe=await submission(undefined,Buffer.from('<svg onload="alert(1)"></svg>'));
    const original=await request(app).get(`/admin/submissions/${unsafe.id}/proof?preview=true`).set('Cookie',adminCookie);
    expect(original.headers['content-type']).toContain('application/octet-stream');
    expect(original.headers['content-disposition']).toContain('attachment;');
  });
  it('atomically creates one login-ready account, approval, audit and encrypted queued password across repeated concurrent clicks',async()=>{
    configured=false;
    const row=await submission();
    const before=await review.detail(row.id);
    expect(before.emailPreview.text).toContain('[Generated securely');
    const responses=await Promise.all([approve(row.id),approve(row.id)]);
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    const stored=await review.row(row.id);
    expect(stored.status).toBe('approved'); expect(stored.email_status).toBe('pending'); expect(stored.account_kind).toBe('new');
    const password=codec.decrypt(stored.access_secret,`velovest-signup:${row.id}`);
    expect(JSON.stringify(stored.access_secret)).not.toContain(password);
    expect(JSON.stringify(responses)).not.toContain(password);
    expect(responses[0].body.submission.access_secret).toBeUndefined();
    const account=await database.runtime.users.readById(stored.account_user_id!);
    expect(await verifyPassword(password,account.state.user.password_hash!)).toBe(true);
    expect(await authenticateUser(row.customer_email,password)).toMatchObject({userId:stored.account_user_id});
    const usage=await database.runtime.usage.read(stored.account_user_id!); expect(usage.state.user_id).toBe(stored.account_user_id);
    const events=await pool.query("SELECT count(*)::int AS n FROM velovest_signup.review_events WHERE submission_id=$1 AND event LIKE 'Approved;%'",[row.id]);
    expect(events.rows[0].n).toBe(1);
  });
  it('rolls back account, usage and approval together if the audit write fails',async()=>{
    const row=await submission();
    await pool.query(`CREATE FUNCTION velovest_signup.fail_review_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$;
      CREATE TRIGGER fail_review_test BEFORE INSERT ON velovest_signup.review_events FOR EACH ROW EXECUTE FUNCTION velovest_signup.fail_review_test()`);
    try {await expect(review.approve(row.id,decision,'test')).rejects.toThrow();}
    finally {await pool.query('DROP TRIGGER fail_review_test ON velovest_signup.review_events; DROP FUNCTION velovest_signup.fail_review_test()');}
    expect((await review.row(row.id)).status).toBe('submitted');
    expect(await database.runtime.users.findByEmail(row.customer_email)).toBeNull();
  });
  it('requires explicit matching existing-account linking and preserves its password and identity',async()=>{
    const row=await submission('existing@example.invalid');
    const userId=randomUUID();
    const passwordHash=await hashPassword('existing-password-123');
    await createInvestorFixture({user:{id:userId,created_at:'2026-11-02',auth_token:randomUUID(),password_hash:passwordHash},profile:{display_name:'Existing customer',contact_email:row.customer_email},log:[]});
    expect((await approve(row.id)).status).toBe(409);
    expect((await approve(row.id,{...decision,linkExistingUserId:randomUUID()})).status).toBe(409);
    const response=await approve(row.id,{...decision,linkExistingUserId:userId}); expect(response.status).toBe(200);
    expect(response.body.submission.account_user_id).toBe(userId); expect(response.body.submission.account_kind).toBe('existing');
    expect((await database.runtime.users.readById(userId)).state.user.password_hash).toBe(passwordHash);
    expect(response.body.emailPreview.text).toContain('Use your existing Velovest password');
  });
  it('shows duplicate evidence and real session warnings, recomputes proposed-session email preview, and requires acknowledgement',async()=>{
    const evidence=Buffer.from('%PDF-1.4\nshared'); const one=await submission(undefined,evidence); await review.approve(one.id,decision,'test');
    const two=await submission(undefined,evidence); const detail=await review.detail(two.id);
    expect(detail.relatedSubmissions).toContainEqual({reference:one.reference,reason:'Same payment evidence'});
    expect(detail.sessionConflicts.some(row=>row.reference===one.reference)).toBe(true);
    expect((await approve(two.id,{...decision,warningsAcknowledged:false})).status).toBe(409);
    const proposed=await review.detail(two.id,{date:'2026-11-03',time:'14:00'});
    expect(proposed.emailPreview.text).toContain('Tuesday, 3 November 2026, 2:00 PM');
    expect((await review.row(two.id)).confirmed_session_date).toBeNull();
  });
  it('records provider acceptance, clears the pending secret and never sends twice for repeated actions',async()=>{
    configured=true; mailResult={outcome:'accepted',messageId:'receipt-accepted'};
    const row=await submission(); const before=sent.length;
    const response=await approve(row.id); expect(response.status).toBe(200);
    const stored=await review.row(row.id); expect(stored.email_status).toBe('sent'); expect(stored.access_secret).toBeNull();
    expect(stored.email_message_id).toBe('receipt-accepted');
    expect(sent.at(-1)?.text).toContain('Temporary password:');
    expect(sent.at(-1)?.text).toContain('recommend changing this password');
    expect(sent.at(-1)?.text).not.toContain('[Generated securely');
    expect((await send(row.id)).status).toBe(200); expect((await approve(row.id)).status).toBe(200);
    expect(sent.length-before).toBe(1);
  });
  it('keeps the same account and encrypted password after a failed attempt, then retries after configuration is fixed',async()=>{
    mailResult={outcome:'rejected'}; const row=await submission();
    expect((await approve(row.id)).status).toBe(200); const failed=await review.row(row.id);
    expect(failed.email_status).toBe('failed'); expect(failed.access_secret).not.toBeNull();
    const first=sent.at(-1)!; mailResult={outcome:'accepted',messageId:'retry-receipt'};
    expect((await send(row.id)).status).toBe(200);
    expect(sent.at(-1)?.text).toBe(first.text); expect((await review.row(row.id)).account_user_id).toBe(failed.account_user_id);
  });
  it('does not blindly retry an ambiguous or interrupted send; explicit retry preserves access details',async()=>{
    mailResult={outcome:'unknown'}; const row=await submission(); await approve(row.id);
    const first=sent.at(-1)!.text; const before=sent.length;
    expect((await review.row(row.id)).email_status).toBe('unknown');
    expect((await send(row.id)).status).toBe(409); expect(sent.length).toBe(before);
    await pool.query("UPDATE velovest_signup.submissions SET email_status='sending' WHERE id=$1",[row.id]);
    expect((await send(row.id)).status).toBe(409);
    mailResult={outcome:'accepted',messageId:'reviewed-retry'};
    expect((await send(row.id,true)).status).toBe(200); expect(sent.at(-1)!.text).toBe(first);
  });
  it('serializes concurrent mail actions and suppresses a stale temporary password after the customer changes it',async()=>{
    configured=false; const row=await submission(); await approve(row.id);
    const queued=await review.row(row.id); const user=await database.runtime.users.readById(queued.account_user_id!);
    user.state.user.password_hash=await hashPassword('customer-changed-password');
    await database.runtime.users.update(user.state,user.revision);
    configured=true;
    let release!:()=>void, started!:()=>void;
    const ready=new Promise<void>(resolve=>{started=resolve;});
    const hold=new Promise<void>(resolve=>{release=resolve;});
    holdSend=async()=>{started(); await hold;};
    const first=review.send(row.id,'first',false);
    await ready;
    try {expect((await send(row.id)).status).toBe(409);}
    finally {release();await first;holdSend=undefined;}
    expect(sent.at(-1)!.text).toContain('Use your existing Velovest password');
    expect(sent.at(-1)!.text).not.toContain('Temporary password:');
  });
});
