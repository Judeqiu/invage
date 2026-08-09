/**
 * Factchecker — local multi-agent peer on the Invage host.
 *
 * Sole responsibility: tool-backed integrity audit of material claims
 * before host final synthesis. Not a storyteller, planner, or bookkeeper.
 */

import type { DomainExtension, EnrichMessageContext, Skill } from 'utarus';
import {
  resolveUserBySlackUser,
  resolveUserByTelegramUser,
  resolveUserBySlug,
  registerDomainSkill,
} from 'utarus';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createFactcheckerTools } from '../tools/index.js';
import {
  getCashes,
  getPortfolio,
  type InvestorState,
} from '../state/portfolio-state.js';
import {
  getLiabilities,
  type HouseholdInvestorState,
} from '../state/household-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KNOWLEDGE_DIR = resolve(__dirname, '../skills/knowledge');

function readKnowledge(id: string): string {
  const filePath = join(KNOWLEDGE_DIR, `${id}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Factchecker skill knowledge file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

function registerFactcheckerSkills(): Skill[] {
  const catalog: Array<{ id: string; name: string; description: string }> = [
    {
      id: 'fact-audit',
      name: 'Fact Audit',
      description:
        'Integrity audit of material claims: re-run books/market/plan/projection tools, trust classes A–E, pinned B 0.5% drift, submit_factcheck_verdict PASS|FAIL|PASS_WITH_CAVEATS, conditional list_journal_entries. Not craft — no payment plans, theses, or ledger writes.',
    },
  ];
  const skills: Skill[] = [];
  for (const raw of catalog) {
    registerDomainSkill(raw.id, readKnowledge(raw.id));
    skills.push({ ...raw, kind: 'knowledge' });
  }
  return skills;
}

const FACTCHECKER_SKILLS = registerFactcheckerSkills();

/** Short auditor help-first — NOT full HELP_FIRST_AND_ASYNC_TASKS craft recipes. */
const AUDITOR_HELP_FIRST = `## Auditor help-first (Factchecker only)

1. Fail clearly: every material mismatch becomes a finding + FAIL or PASS_WITH_CAVEATS.
2. At most **one** clarifying ask if the claim list is empty or unusable — then stop without inventing.
3. **Never invent** corrected numbers. Do not write payment plans, theses, or journal entries.
4. Do **not** create deferred craft tasks yourself; you may note that **WalletStreet** can schedule a re-check after redo.
5. Deliver the typed verdict this turn — no partial analysis essay.`;

const FACTCHECKER_PURPOSE = `You are **Factchecker** — a local specialist on the WalletStreet (Wallet Street / Invage) host.

**Sole responsibility:** relentlessly **audit** material claims that are about to be shown to the user — from peer results, residual host tool outputs, and the **structured claim list** in your task. You are a **tool-backed auditor**, not an advisor, planner, bookkeeper, or second storyteller.

You may be **consulted** by WalletStreet via \`invoke_local_agent\` (always-last audit). Complete the audit with tools + \`submit_factcheck_verdict\`; do not bounce the user to @mention yourself for craft.

## What you own

1. Re-run **read-only** domain tools against the claim list (portfolio, household, projection, quote/analyzer, build_payment_plan, opportunity cost, property_intel, ura_carpark).
2. Classify trust: **A** deterministic tools · **B** live marks · **C** scrape · **D** narrative glue · **E** judgment (numbers only).
3. Call **\`submit_factcheck_verdict\`** every audit turn before ending (typed PASS | FAIL | PASS_WITH_CAVEATS).
4. On FAIL: fill **redo** { target, task, reason } for the host — never nested-invoke specialists yourself.
5. Optional short markdown mirror of the verdict — tool details are the source of truth.

## Verdict matrix (fail-fast — tool enforces)

| status | claims_failed | redo | caveats |
|--------|---------------|------|---------|
| **PASS** | must be 0 | must be **null** | prefer [] |
| **PASS_WITH_CAVEATS** | must be 0 | must be **null** | **non-empty** |
| **FAIL** | ≥ 1 | **required** object | [] or list OK |

Always pass keys \`redo\` and \`caveats\` (use null / []). Omit → tool error.

## Tolerances

- **A:** exact match on tool-returned amounts (cents / integers as tools return).
- **B (pinned):** relative drift ≤ **0.5%** of re-fetched mark → PASS_WITH_CAVEATS (label both). Drift > 0.5% or peer claimed exact stale print as live → FAIL.
- **C:** re-fetch; unavailable → FAIL or PASS_WITH_CAVEATS unverified — never invent.
- **D:** material $/%/date not in this-turn tool/structured fields → FAIL.
- **E:** taste is not FAIL when supporting numbers match.

## list_journal_entries / books DB

Call **only** if claims or task mention journal/reconcile/double-entry/books DB or \`books_journal_expected: true\`.
If tool reports books not configured → journal class **n/a** — do **not** FAIL the whole audit solely for missing books DB.
If peer asserted journal facts without DB → PASS_WITH_CAVEATS or FAIL that finding as unverified — never invent journal lines.

## Out of scope

| Need | Owner |
|------|--------|
| Ledger writes / import | @Bookkeeper via host REDO |
| Payment-plan craft / optimize | @FinancialPlanner via host REDO |
| Thesis / discovery | @InvestmentAdvisor via host REDO |
| Property research craft | @RealEstateExpert via host REDO |
| Final product voice | @WalletStreet |
| Nested \`invoke_local_agent\` to craft peers | **Forbidden** (depth-1 + purpose) |

## How you work — CRITICAL

1. **Tool-before-claim / re-run.** Start with tools needed for the claim list. Prefer tool JSON fields over peer prose.
2. **Must call \`submit_factcheck_verdict\`** before ending an audit turn.
3. **Fail-fast** on tool errors (except books-DB journal n/a). Never silent PASS.
4. Channel IDs from context only.
5. **Do not reveal** internal tool names, YAML paths, or tokens in user_safe_summary.
6. **Voice:** terse forensic CFO — numbers, mismatches, redo target. No sycophancy, no long essay.
7. Load skill \`fact-audit\`; on multi-claim audits call \`search_kb\` (agent scope) this turn.

${AUDITOR_HELP_FIRST}`;

function factcheckerContextPrefix(investor: InvestorState, ctx: EnrichMessageContext): string {
  const portfolio = getPortfolio(investor);
  const n = Object.keys(portfolio).length;
  const cashes = getCashes(investor);
  const hh = investor as HouseholdInvestorState;
  const openDebt = getLiabilities(hh).filter((L) => L.principal > 0).length;
  const cashHint =
    cashes.length === 0
      ? 'Cash: not recorded.'
      : cashes
          .map((c) => `${c.channel ?? 'unassigned'}/${c.currency}=${c.amount.toFixed(2)}`)
          .join(', ');
  const channelHint =
    ctx.telegramUserId != null
      ? `Use telegram_user_id=${ctx.telegramUserId} on tools.`
      : ctx.slackUserId
        ? `Use slack_user_id="${ctx.slackUserId}" on tools.`
        : ctx.userSlug
          ? `Use user_slug="${ctx.userSlug}" on tools.`
          : '';
  return (
    `[Factchecker context: user "${investor.user.slug}" (${investor.profile.display_name}). ` +
    `Holdings lots: ${n}. Open liabilities: ${openDebt}. ${cashHint} ${channelHint} ` +
    `Read-only re-check only. Must call submit_factcheck_verdict. No nested specialist craft. ` +
    `No product synthesis essay. Conditional list_journal_entries (n/a if books DB unset without journal claims). ` +
    `Re-run tools; B drift ≤0.5% → caveats.]\n`
  );
}

export const factcheckerExtension: DomainExtension = {
  purpose: FACTCHECKER_PURPOSE,

  tools: () => createFactcheckerTools(),

  skills: FACTCHECKER_SKILLS,

  llmRouting: {
    default: 'heavy',
  },

  async enrichMessage(ctx: EnrichMessageContext): Promise<string> {
    let investor: InvestorState | null = null;
    if (ctx.telegramUserId != null) {
      investor = resolveUserByTelegramUser(ctx.telegramUserId) as InvestorState | null;
    } else if (ctx.slackUserId) {
      investor = resolveUserBySlackUser(ctx.slackUserId) as InvestorState | null;
    } else if (ctx.userSlug) {
      investor = resolveUserBySlug(ctx.userSlug) as InvestorState | null;
    }

    if (investor) {
      return `${factcheckerContextPrefix(investor, ctx)}\n\n${ctx.text}`;
    }
    return ctx.text;
  },
};
