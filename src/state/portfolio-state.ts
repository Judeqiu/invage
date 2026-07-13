/**
 * Investor portfolio layer on top of Utarus user YAML.
 *
 * Framework user files live at data/users/<slug>.yaml (owned by Utarus invite/onboard).
 * Domain fields: top-level `portfolio` map of ticker → Holding.
 *
 * Utarus package only exports types + resolveDataRoot for state; load/save of the
 * shared user file is done here so Invage can extend the same document Binary-style.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { parse, stringify } from 'yaml';
import { resolveDataRoot, type UserState } from 'utarus';
import type { Holding } from '../market/types.js';
import {
  applyPlaybookPatch,
  resolvePlaybook,
  type InvestmentPlaybook,
  type PlaybookPatch,
} from '../playbook/index.js';

export interface InvestorState extends UserState {
  portfolio?: Record<string, Holding>;
  /** Optional per-user investment playbook; missing → DEFAULT_PLAYBOOK via getPlaybook. */
  playbook?: Partial<InvestmentPlaybook> | InvestmentPlaybook;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function usersDir(): string {
  return join(resolveDataRoot(), 'users');
}

export function userStatePath(slug: string): string {
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new Error(`User slug must be lowercase kebab-case [a-z0-9-]+, got: "${slug}"`);
  }
  return join(usersDir(), `${slug}.yaml`);
}

function assertCoherent(state: unknown, path: string): InvestorState {
  if (!state || typeof state !== 'object') {
    throw new Error(`State file is not a mapping: ${path}`);
  }
  const s = state as Partial<InvestorState>;
  if (!s.user?.slug) throw new Error(`State file missing user.slug: ${path}`);
  if (!s.user?.created_at) throw new Error(`State file missing user.created_at: ${path}`);
  if (!s.profile?.display_name) throw new Error(`State file missing profile.display_name: ${path}`);
  if (!s.profile?.contact_email) throw new Error(`State file missing profile.contact_email: ${path}`);
  if (!Array.isArray(s.log)) throw new Error(`State file missing log[]: ${path}`);
  return s as InvestorState;
}

export function loadInvestorState(slug: string): InvestorState {
  const path = userStatePath(slug);
  if (!existsSync(path)) {
    throw new Error(`User state file not found: ${path}`);
  }
  const raw = readFileSync(path, 'utf-8');
  return assertCoherent(parse(raw), path);
}

export function saveInvestorState(state: InvestorState): string {
  if (!state?.user?.slug) {
    throw new Error('Cannot save state without user.slug');
  }
  assertCoherent(state, '<in-memory>');
  const path = userStatePath(state.user.slug);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(state, { sortMapEntries: false }), 'utf-8');
  return path;
}

export function listUserSlugs(): string[] {
  const dir = usersDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.yaml'))
    .map((d) => d.name.replace(/\.yaml$/, ''));
}

export function resolveInvestorByTelegramUser(telegramUserId: number): InvestorState | null {
  for (const slug of listUserSlugs()) {
    try {
      const state = loadInvestorState(slug);
      if (state.user.telegram_user_ids?.includes(telegramUserId)) {
        return state;
      }
    } catch {
      // skip broken state files
    }
  }
  return null;
}

export function resolveInvestorBySlackUser(slackUserId: string): InvestorState | null {
  if (!slackUserId) return null;
  for (const slug of listUserSlugs()) {
    try {
      const state = loadInvestorState(slug);
      // Utarus UserIdentity includes slack_user_ids; keep optional for older YAML.
      const ids = state.user.slack_user_ids;
      if (ids?.includes(slackUserId)) {
        return state;
      }
    } catch {
      // skip broken state files
    }
  }
  return null;
}

export function getPortfolio(state: InvestorState): Record<string, Holding> {
  return state.portfolio ?? {};
}

export function setPortfolio(state: InvestorState, portfolio: Record<string, Holding>): void {
  state.portfolio = portfolio;
}

/** Resolved playbook (defaults filled). Fail-fast if stored playbook is invalid. */
export function getPlaybook(state: InvestorState): InvestmentPlaybook {
  return resolvePlaybook(state.playbook ?? null);
}

/** Persist a full resolved playbook (or patch merge). */
export function setPlaybook(state: InvestorState, playbook: InvestmentPlaybook): void {
  state.playbook = playbook;
}

/** Merge patch into current resolved playbook and store. Returns resolved result. */
export function updatePlaybook(state: InvestorState, patch: PlaybookPatch): InvestmentPlaybook {
  const next = applyPlaybookPatch(getPlaybook(state), patch);
  state.playbook = next;
  return next;
}
