import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase, createInvestorFixture } from './helpers/database.js';
import { SubmissionRepository, type SubmissionInput } from '../src/signup/submissions.js';
import { createSubmissionAdminRouter, createSubmissionPublicRouter } from '../src/signup/api.js';

const database = await useTestDatabase();
const pool = new pg.Pool({ connectionString: database.databaseUrl });
const repository = new SubmissionRepository(pool);
const app = express().use(cookieParser()).use(express.json({limit: Infinity}));
app.use('/api/signup', createSubmissionPublicRouter(() => repository));
app.use('/api/signup/admin', createSubmissionAdminRouter(() => repository));
const proof = Buffer.from('%PDF-1.4\nSignup proof fixture\n');
const input = (reference: string): SubmissionInput => ({
  reference, packageId: 'novice', sessionDate: '2026-11-02', sessionTime: '10:00',
  name: '<img src=x onerror=alert(1)>', email: 'signup-test@example.invalid', phone: '+65 1234 5678',
  bankTransactionId: "BANK-' OR 1=1--", consentAccepted: true,
  proof: {filename: 'proof.pdf', contentType: 'application/pdf', data: proof},
});
const payload = (reference: string) => {
  const { proof: file, ...data } = input(reference);
  return {...data, amountSgd: 1, proofFilename: file.filename, proofContentType: file.contentType, proofBase64: file.data.toString('base64')};
};
let adminCookie: string;
let userCookie: string;

beforeAll(async () => {
  await pool.query(readFileSync('src/signup/schema.sql', 'utf8'));
  const adminToken = randomUUID();
  await database.runtime.webAuth.issueSession({token:adminToken,identity:{user:{type:'admin',displayName:'Test operator'},origin:{origin:'operator',subject:'signup-test'}},expiresAt:Date.now()+60000});
  adminCookie = `bindrive_session=${adminToken}`;
  const userId = randomUUID(), userToken = randomUUID();
  await createInvestorFixture({user:{id:userId,slug:'signup-test-user',created_at:'2026-10-30',telegram_user_ids:[],auth_token:randomUUID()},profile:{display_name:'Test user',contact_email:'user@example.invalid'},log:[]});
  await database.runtime.webAuth.issueSession({token:userToken,identity:{user:{type:'user',displayName:'Test user',userId},origin:{origin:'registered-user',userId}},expiresAt:Date.now()+60000});
  userCookie = `bindrive_session=${userToken}`;
});
afterAll(async () => { await pool.end(); });

describe('Signup submission persistence and Management access', () => {
  it('saves the proof atomically and calculates the package total on the server', async () => {
    const response = await request(app).post('/api/signup/submissions').send(payload('VV-TEST01'));
    expect(response.status).toBe(201);
    expect(response.body).toEqual({reference:'VV-TEST01'});
    const stored = await pool.query('SELECT amount_sgd::text,proof_data,consent_accepted,status FROM velovest_signup.submissions WHERE reference=$1',['VV-TEST01']);
    expect(stored.rows[0]).toEqual({amount_sgd:'1080',proof_data:proof,consent_accepted:true,status:'submitted'});
  });

  it('makes retries idempotent without overwriting a different submission', async () => {
    await repository.save(input('VV-TEST02'));
    await repository.save(input('VV-TEST02'));
    await expect(repository.save({...input('VV-TEST02'),email:'changed@example.invalid'})).rejects.toMatchObject({status:409});
    expect((await pool.query('SELECT count(*)::int AS count FROM velovest_signup.submissions WHERE reference=$1',['VV-TEST02'])).rows[0].count).toBe(1);
  });

  it('rejects invalid consent, package, session and proof before writing', async () => {
    for (const changed of [{consentAccepted:false},{packageId:'unknown'},{sessionDate:'2026-11-01'},{sessionTime:'13:17'},{proofBase64:'not base64'},{proofContentType:'text/html'}]) {
      expect((await request(app).post('/api/signup/submissions').send({...payload('VV-TEST03'),...changed})).status).toBe(400);
    }
    expect((await pool.query('SELECT count(*)::int AS count FROM velovest_signup.submissions WHERE reference=$1',['VV-TEST03'])).rows[0].count).toBe(0);
  });

  it('denies anonymous and ordinary-user access to both queries and proof downloads', async () => {
    for (const route of ['/api/signup/admin/submissions','/api/signup/admin/submissions/'+randomUUID()+'/proof']) {
      expect((await request(app).get(route)).status).toBe(401);
      expect((await request(app).get(route).set('Cookie',userCookie)).status).toBe(403);
    }
  });

  it('lets admins search literal submitted data without leaking proof bytes into the table response', async () => {
    const response = await request(app).get('/api/signup/admin/submissions?q='+encodeURIComponent("BANK-' OR 1=1--")).set('Cookie',adminCookie);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.submissions.length).toBeGreaterThan(0);
    const row=response.body.submissions[0];
    expect(row.customer_name).toBe(input('VV-TEST01').name);
    expect(row.proof_data).toBeUndefined();
    expect(row.proof_sha256).toBeUndefined();
    const download=await request(app).get('/api/signup/admin/submissions/'+row.id+'/proof').set('Cookie',adminCookie);
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toContain('attachment;');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.body).toEqual(proof);
    const absent=await request(app).get('/api/signup/admin/submissions?q=not-a-matching-reference').set('Cookie',adminCookie);
    expect(absent.body.submissions).toEqual([]);
  });
});
