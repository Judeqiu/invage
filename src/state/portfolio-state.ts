/**
 * Investor portfolio + playbook extensions on top of the Utarus user YAML.
 *
 * YAML I/O (loadState / saveState) and per-channel lookups
 * (resolveUserBy{Slug,SlackUser,TelegramUser}) live in Utarus now — they
 * are not duplicated here. This module owns only the investor-specific
 * fields layered on top of the shared UserState.
 *
 * Domain fields:
 *   - top-level `portfolio`: map of ticker → Holding
 *   - top-level `playbook`:  optional InvestmentPlaybook (missing → default)
 */

import type { UserState } from 'utarus';
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
