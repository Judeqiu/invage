/**
 * Ensure a Utarus user YAML exists for a given Slack user id (QR onboard path).
 *
 * Creates data/users/<slug>.yaml with empty portfolio-ready shape.
 * Slug is derived from display name (unique). Identity is slack_user_ids.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { stringify } from 'yaml';
import { resolveDataRoot } from 'utarus';
import { deriveUniqueSlug } from './slug.js';

function userPath(slug: string): string {
  return join(resolveDataRoot(), 'users', `${slug}.yaml`);
}

export interface EnsureSlackUserParams {
  slackUserId: string;
  displayName: string;
  contactEmail: string;
  /** Slug override; defaults to unique slug from display name. */
  slug?: string;
  /** First log entry action label; defaults to 'slack_qr_onboard'. */
  action?: string;
}

export function ensureSlackUser(params: EnsureSlackUserParams): {
  slug: string;
  path: string;
  created: boolean;
} {
  if (!params.slackUserId) {
    throw new Error('slackUserId is required');
  }
  const slug = params.slug ?? deriveUniqueSlug(params.displayName);
  const path = userPath(slug);
  if (existsSync(path)) {
    return { slug, path, created: false };
  }

  const today = new Date().toISOString().slice(0, 10);
  const doc = {
    user: {
      id: randomUUID(),
      slug,
      created_at: today,
      telegram_user_ids: [] as number[],
      slack_user_ids: [params.slackUserId],
      auth_token: randomUUID(),
    },
    profile: {
      display_name: params.displayName,
      contact_email: params.contactEmail,
    },
    portfolio: {},
    log: [{ ts: today, action: params.action ?? 'slack_qr_onboard' }],
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(doc), 'utf-8');
  return { slug, path, created: true };
}
