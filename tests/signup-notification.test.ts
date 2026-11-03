import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type pg from 'pg';
import express from 'express';
import request from 'supertest';
import { readAgentConfig, saveAgentConfig } from 'utarus';
import { dashboardConfig } from '../src/webapp/dashboard-config.js';
import { notifyNewSignup } from '../src/signup/notification.js';
import { SubmissionRepository, validateSubmission, type SubmissionInput } from '../src/signup/submissions.js';
import { createSubmissionPublicRouter } from '../src/signup/api.js';

const smtp = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn(), close: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.create } }));
const file = join(process.env.UTARUS_DATA_ROOT!, 'config', 'agent-config', dashboardConfig.id + '.json');
const input: SubmissionInput = {
  reference: 'VV-NOTIFY', packageId: 'novice', sessionDate: '2026-11-02', sessionTime: '10:00',
  name: 'Test customer', email: 'customer@example.invalid', phone: '+65 1234 5678',
  bankTransactionId: 'test-payment', consentAccepted: true,
  proof: { filename: 'proof.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-test') },
};
const recipient = (email: string) => saveAgentConfig(dashboardConfig, {
  ...readAgentConfig(dashboardConfig), signup_notification_email: email,
});
beforeEach(() => {
  rmSync(file, { force: true });
  smtp.create.mockReset().mockReturnValue({ sendMail: smtp.send, close: smtp.close });
  smtp.send.mockReset().mockResolvedValue({ accepted: ['operator@example.invalid'], rejected: [] });
  smtp.close.mockReset();
  vi.stubEnv('INVAGE_SIGNUP_SMTP_HOST', 'smtp.ionos.com');
  vi.stubEnv('INVAGE_SIGNUP_SMTP_PORT', '465');
  vi.stubEnv('INVAGE_SIGNUP_SMTP_USER', 'support@example.invalid');
  vi.stubEnv('INVAGE_SIGNUP_SMTP_FROM', 'support@example.invalid');
  vi.stubEnv('INVAGE_SIGNUP_SMTP_PASSWORD', 'synthetic-test-secret');
});
afterEach(() => { rmSync(file, { force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('uses a saved recipient immediately, preserves other settings and defaults to disabled', async () => {
  await notifyNewSignup(validateSubmission(input));
  expect(smtp.create).not.toHaveBeenCalled();
  recipient('operator@example.invalid');
  await notifyNewSignup(validateSubmission(input));
  recipient('another@example.invalid');
  await notifyNewSignup(validateSubmission(input));
  expect(smtp.send.mock.calls.map(([mail]) => mail.to)).toEqual(['operator@example.invalid', 'another@example.invalid']);
  expect(readAgentConfig(dashboardConfig).automatic_broker_sync_enabled).toBe(true);
  recipient('');
  await notifyNewSignup(validateSubmission(input));
  expect(smtp.send).toHaveBeenCalledTimes(2);
});

it('sends the server-calculated summary and original proof over authenticated TLS without exposing credentials', async () => {
  recipient('operator@example.invalid');
  await notifyNewSignup(validateSubmission(input));
  expect(smtp.create).toHaveBeenCalledWith(expect.objectContaining({
    host: 'smtp.ionos.com', port: 465, secure: true, requireTLS: true,
    auth: { user: 'support@example.invalid', pass: 'synthetic-test-secret' },
  }));
  const mail = smtp.send.mock.calls[0][0];
  expect(mail.text).toContain('Submitted amount: SGD 1080');
  for (const value of ['VV-NOTIFY', 'Test customer', input.email, input.phone, '2026-11-02 10:00']) expect(mail.text).toContain(value);
  expect(mail.text).toContain('Payment has not been verified');
  expect(mail.attachments).toEqual([{filename:input.proof.filename,contentType:input.proof.contentType,content:input.proof.data,contentDisposition:'attachment'}]);
  expect(JSON.stringify(mail)).not.toContain('synthetic-test-secret');
  expect(smtp.close).toHaveBeenCalledOnce();
});

it('accepts a renewal without a booking and keeps it out of both notification and access email session details', async () => {
  const renewal = validateSubmission({...input,packageId:'renewal',sessionDate:undefined,sessionTime:undefined});
  expect(renewal).toMatchObject({sessionDate:null,sessionTime:null,amountSgd:228});
  recipient('operator@example.invalid');
  await notifyNewSignup(renewal);
  expect(smtp.send.mock.calls[0][0].text).toContain('System subscription renewal');
  expect(smtp.send.mock.calls[0][0].text).not.toContain('Requested session:');
  expect(smtp.send.mock.calls[0][0].attachments[0].content).toEqual(input.proof.data);
  for (const packageId of ['novice','experienced']) expect(() => validateSubmission({...input,packageId,sessionDate:undefined,sessionTime:undefined})).toThrow('session date');
  expect(validateSubmission({...input,packageId:'renewal'})).toMatchObject({sessionDate:null,sessionTime:null});
});

it('rejects multiple recipients, missing sender credentials and SMTP rejection without pretending delivery succeeded', async () => {
  recipient('one@example.invalid,two@example.invalid');
  await expect(notifyNewSignup(validateSubmission(input))).rejects.toThrow('Invalid signup notification recipient');
  expect(smtp.create).not.toHaveBeenCalled();
  recipient('operator@example.invalid');
  vi.stubEnv('INVAGE_SIGNUP_SMTP_PASSWORD', '');
  await expect(notifyNewSignup(validateSubmission(input))).rejects.toThrow('setup is incomplete');
  vi.stubEnv('INVAGE_SIGNUP_SMTP_PASSWORD', 'synthetic-test-secret');
  smtp.send.mockResolvedValueOnce({ accepted: [], rejected: ['operator@example.invalid'] });
  await expect(notifyNewSignup(validateSubmission(input))).rejects.toThrow('not accepted');
  expect(smtp.close).toHaveBeenCalledOnce();
});

it('notifies only for an inserted ID, after save succeeds, and keeps the public response unchanged on mail failure', async () => {
  let savedId: string | undefined;
  let conflict=false;
  const query = vi.fn(async (_sql: string, args: unknown[]) => {
    if (!_sql.includes('INSERT INTO velovest_signup.submissions')) return {rows:[]};
    if (conflict) return {rows:[]};
    savedId ??= String(args[0]);
    return { rows: [{ id: savedId, reference: input.reference }] };
  });
  const notify = vi.fn(async () => { expect(savedId).toBeDefined(); throw new Error('secret SMTP diagnostic'); });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const repository = new SubmissionRepository({ connect:async()=>({query,release:()=>{}}) } as unknown as pg.Pool, notify);
  const app = express().use(express.json()).use(createSubmissionPublicRouter(() => repository));
  const { proof, ...body } = input;
  const payload = { ...body, proofFilename: proof.filename, proofContentType: proof.contentType, proofBase64: proof.data.toString('base64') };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request(app).post('/submissions').send(payload);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ reference: input.reference });
  }
  expect(notify).toHaveBeenCalledOnce();
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret SMTP diagnostic');
  conflict=true;
  await expect(repository.save(input)).rejects.toMatchObject({ status: 409 });
  expect(notify).toHaveBeenCalledOnce();
});
