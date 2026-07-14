/**
 * BIND token store — read/write data/onboard_tokens.yaml.
 *
 * Pure functions, file-based, no cache (project rule: no caching).
 * YAML read on every call.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { parse, stringify } from 'yaml';
import { randomBytes } from 'crypto';
import { resolveDataRoot } from 'utarus';
import type { OnboardToken, OnboardStatus } from './types.js';

const DATA_ROOT = resolveDataRoot();
const TOKENS_FILE = join(DATA_ROOT, 'onboard_tokens.yaml');

const TTL_MIN_RAW = process.env.INVAGE_ONBOARD_TOKEN_TTL_MIN;
if (!TTL_MIN_RAW) {
  throw new Error('INVAGE_ONBOARD_TOKEN_TTL_MIN must be set (e.g. "15").');
}
const TTL_MIN = parseInt(TTL_MIN_RAW, 10);
if (!Number.isFinite(TTL_MIN) || TTL_MIN <= 0) {
  throw new Error(`INVAGE_ONBOARD_TOKEN_TTL_MIN must be a positive integer, got "${TTL_MIN_RAW}".`);
}

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function load(): OnboardToken[] {
  if (!existsSync(TOKENS_FILE)) return [];
  const raw = readFileSync(TOKENS_FILE, 'utf-8');
  const parsed = parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed as OnboardToken[];
}

function save(entries: OnboardToken[]): void {
  mkdirSync(dirname(TOKENS_FILE), { recursive: true });
  writeFileSync(TOKENS_FILE, stringify(entries, { sortMapEntries: false }), 'utf-8');
}

function randomToken(): string {
  const bytes = randomBytes(8);
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += TOKEN_ALPHABET[bytes[i] % 36];
  return `BIND-${suffix}`;
}

export function createPendingToken(displayName: string, email: string): OnboardToken {
  const entries = load();
  let token = randomToken();
  for (let attempts = 0; attempts < 3 && entries.some((e) => e.token === token); attempts++) {
    token = randomToken();
  }
  if (entries.some((e) => e.token === token)) {
    throw new Error('Failed to mint unique BIND token after 3 attempts.');
  }
  const now = new Date();
  const expires = new Date(now.getTime() + TTL_MIN * 60 * 1000);
  const entry: OnboardToken = {
    token,
    display_name: displayName,
    email_submitted: email,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    status: 'pending',
  };
  entries.push(entry);
  save(entries);
  return entry;
}

export function findToken(token: string): OnboardToken | undefined {
  return load().find((e) => e.token === token);
}

export function markUsed(token: string, slackUserId: string, slug: string): OnboardToken {
  const entries = load();
  const idx = entries.findIndex((e) => e.token === token);
  if (idx === -1) throw new Error(`Token "${token}" not found.`);
  if (entries[idx].status !== 'pending') {
    throw new Error(`Token "${token}" is not pending (status: ${entries[idx].status}).`);
  }
  entries[idx] = {
    ...entries[idx],
    status: 'used',
    used_by_slack: slackUserId,
    used_at: new Date().toISOString().slice(0, 10),
    slug,
  };
  save(entries);
  return entries[idx];
}

export function markRejected(token: string, adminSlackId: string, reason: string): OnboardToken {
  const entries = load();
  const idx = entries.findIndex((e) => e.token === token);
  if (idx === -1) throw new Error(`Token "${token}" not found.`);
  entries[idx] = {
    ...entries[idx],
    status: 'rejected',
    rejected_at: new Date().toISOString().slice(0, 10),
    rejected_by: adminSlackId,
    rejected_reason: reason,
  };
  save(entries);
  return entries[idx];
}

export function listTokens(filter: 'all' | OnboardStatus = 'all'): OnboardToken[] {
  const entries = load();
  return filter === 'all' ? entries : entries.filter((e) => e.status === filter);
}

export function isExpired(entry: OnboardToken, now: Date = new Date()): boolean {
  return new Date(entry.expires_at).getTime() <= now.getTime();
}

export function tokensFilePath(): string {
  return TOKENS_FILE;
}

export function tokenTtlMinutes(): number {
  return TTL_MIN;
}
