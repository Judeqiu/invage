/**
 * Slug derivation — display_name → unique kebab-case user slug.
 *
 * Identity is anchored by slack_user_id, not slug; slug is the filename.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { resolveDataRoot } from 'utarus';

const USERS_DIR = join(resolveDataRoot(), 'users');
const MAX_BASE_LEN = 24;

export function slugifyBase(displayName: string): string {
  return displayName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LEN);
}

export function deriveUniqueSlug(displayName: string): string {
  let base = slugifyBase(displayName);
  if (!base) {
    base = `investor-${randomBytes(3).toString('hex')}`;
  }
  let candidate = base;
  while (existsSync(join(USERS_DIR, `${candidate}.yaml`))) {
    candidate = `${base}-${randomBytes(2).toString('hex')}`;
  }
  return candidate;
}
