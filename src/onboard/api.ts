/**
 * Onboard API — Express router mounted at /api/onboard on the BinDrive app.
 *
 * Single endpoint: POST /api/onboard/register
 * Validates input, mints a BIND token, returns workspace invite + bind command.
 */

import { Router } from 'express';
import { createPendingToken } from './token-store.js';
import { ValidationError, type RegistrationRequest, type RegistrationResponse } from './types.js';

const WORKSPACE_INVITE_URL = process.env.INVAGE_SLACK_WORKSPACE_INVITE_URL;
if (!WORKSPACE_INVITE_URL) {
  throw new Error(
    'INVAGE_SLACK_WORKSPACE_INVITE_URL must be set (Slack shared invite URL).',
  );
}
const WORKSPACE_INVITE_URL_NARROWED: string = WORKSPACE_INVITE_URL;

// Practical email check — fail fast on empty / nonsense; not full RFC.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(body: unknown): RegistrationRequest {
  if (typeof body !== 'object' || body === null) {
    throw new ValidationError('body', 'Request body must be a JSON object.');
  }
  const b = body as Record<string, unknown>;
  const displayName = b.display_name;
  if (typeof displayName !== 'string') {
    throw new ValidationError('display_name', 'Display name is required.');
  }
  const trimmedName = displayName.trim();
  if (trimmedName.length < 1 || trimmedName.length > 60) {
    throw new ValidationError('display_name', 'Display name must be 1–60 characters.');
  }
  const email = b.email;
  if (typeof email !== 'string') {
    throw new ValidationError('email', 'Email is required.');
  }
  const trimmedEmail = email.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmedEmail) || trimmedEmail.length > 120) {
    throw new ValidationError('email', 'Enter a valid email address.');
  }
  return { display_name: trimmedName, email: trimmedEmail };
}

export const onboardRouter = Router();

onboardRouter.post('/register', (req, res) => {
  let reqBody: RegistrationRequest;
  try {
    reqBody = validate(req.body);
  } catch (e) {
    if (e instanceof ValidationError) {
      res.status(400).json({ error: e.message, field: e.field });
      return;
    }
    throw e;
  }
  const token = createPendingToken(reqBody.display_name, reqBody.email);
  const response: RegistrationResponse = {
    token: token.token,
    workspace_invite_url: WORKSPACE_INVITE_URL_NARROWED,
    bind_command: `/bind ${token.token}`,
    expires_at: token.expires_at,
  };
  res.json(response);
});

export function workspaceInviteUrl(): string {
  return WORKSPACE_INVITE_URL_NARROWED;
}
