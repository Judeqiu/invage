import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { existsSync, rmSync } from 'fs';
import { onboardRouter } from '../../src/onboard/api.js';
import { tokensFilePath, findToken } from '../../src/onboard/token-store.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/onboard', onboardRouter);
  app.use(
    (
      err: unknown,
      _req: unknown,
      res: { status: (n: number) => { json: (b: unknown) => void } },
      _next: unknown,
    ) => {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    },
  );
  return app;
}

describe('POST /api/onboard/register', () => {
  beforeEach(() => {
    const path = tokensFilePath();
    if (existsSync(path)) rmSync(path, { force: true });
  });

  it('200 on valid input and returns the expected response shape', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/onboard/register')
      .send({ display_name: 'Alex Chen', email: 'alex@example.com' })
      .expect(200);

    expect(res.body.token).toMatch(/^BIND-[A-Z0-9]{8}$/);
    expect(res.body.bind_command).toBe(`/bind ${res.body.token}`);
    expect(res.body.workspace_invite_url).toContain('join.slack.com');
    expect(res.body.expires_at).toBeTruthy();
    expect(findToken(res.body.token)?.email_submitted).toBe('alex@example.com');
  });

  it('400 when display_name missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/onboard/register')
      .send({ email: 'a@b.com' })
      .expect(400);
    expect(res.body.field).toBe('display_name');
  });

  it('400 when email invalid', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/onboard/register')
      .send({ display_name: 'Alex', email: 'not-an-email' })
      .expect(400);
    expect(res.body.field).toBe('email');
  });
});
