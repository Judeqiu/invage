/**
 * Admin bootstrap — guarantee TELEGRAM_ADMIN_IDS and SLACK_ADMIN_IDS entries
 * have Utarus user records at startup (Binary-style, extended for Slack).
 * Idempotent; never overwrites existing files.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { stringify } from 'yaml';
import { resolveDataRoot } from 'utarus';

function readTelegramAdminIds(): number[] {
  const raw = process.env.TELEGRAM_ADMIN_IDS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

function readSlackAdminIds(): string[] {
  const raw = process.env.SLACK_ADMIN_IDS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function userPath(slug: string): string {
  return join(resolveDataRoot(), 'users', `${slug}.yaml`);
}

function ensureUser(params: {
  slug: string;
  displayName: string;
  telegramIds?: number[];
  slackIds?: string[];
}): void {
  const path = userPath(params.slug);
  if (existsSync(path)) return;

  const today = new Date().toISOString().slice(0, 10);
  const doc = {
    user: {
      id: randomUUID(),
      slug: params.slug,
      created_at: today,
      telegram_user_ids: params.telegramIds ?? [],
      slack_user_ids: params.slackIds ?? [],
      auth_token: randomUUID(),
    },
    profile: {
      display_name: params.displayName,
      contact_email: 'admin@localhost',
    },
    log: [{ ts: today, action: 'admin_bootstrap' }],
    portfolio: {},
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(doc), 'utf-8');
  console.log(`[admin-bootstrap] Created user "${params.slug}"`);
}

export function ensureAdminUsersExist(): void {
  for (const id of readTelegramAdminIds()) {
    ensureUser({
      slug: `admin-${id}`,
      displayName: `Admin ${id}`,
      telegramIds: [id],
    });
  }

  for (const slackId of readSlackAdminIds()) {
    // Slack IDs are alphanumeric (e.g. U012ABCDEF); keep slug kebab-safe.
    const safe = slackId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    ensureUser({
      slug: `admin-slack-${safe}`,
      displayName: `Admin Slack ${slackId}`,
      slackIds: [slackId],
    });
  }
}
