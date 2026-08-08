/**
 * Bookkeeper — local multi-agent peer on the Invage host.
 *
 * Sole responsibility: journal, reconcile, and read household books
 * (cash, deposits, portfolio sleeve, property, liabilities, cash flows)
 * on the same user YAML managed by Invester. No market research persona.
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
import { createBookkeeperTools } from '../tools/index.js';
import {
  getCashes,
  getPlaybook,
  getPortfolio,
  type InvestorState,
} from '../state/portfolio-state.js';
import {
  getProjectionAssumptions,
  getTreasury,
  householdGaps,
  type HouseholdInvestorState,
} from '../state/household-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KNOWLEDGE_DIR = resolve(__dirname, '../skills/knowledge');

function readKnowledge(id: string): string {
  const filePath = join(KNOWLEDGE_DIR, `${id}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Bookkeeper skill knowledge file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

function registerBookkeeperSkills(): Skill[] {
  const catalog: Array<{ id: string; name: string; description: string }> = [
    {
      id: 'bookkeeping',
      name: 'Bookkeeping',
      description:
        'Journal/reconcile/read books. Load for cash/deposits/holdings ledger, fund import (instrument=fund), gaps. Full recipes in agent KB (search_kb). Tools: get_household, get_portfolio, set_cash, holding CRUD. Not stock picking.',
    },
    {
      id: 'family-treasury',
      name: 'Family Treasury & Projections',
      description:
        'Household books and deterministic financial projections. Load for family net worth, recurring cash flows, multi-year path, house affordability, projection assumptions/FX. Tools: get_household, set_treasury, property/liability/cash_flow CRUD, set_projection_assumptions, scenarios, run_projection, compare_scenarios. Not for stock picking.',
    },
  ];
  const skills: Skill[] = [];
  for (const raw of catalog) {
    registerDomainSkill(raw.id, readKnowledge(raw.id));
    skills.push({ ...raw, kind: 'knowledge' });
  }
  return skills;
}

const BOOKKEEPER_SKILLS = registerBookkeeperSkills();

const BOOKKEEPER_PURPOSE = `You are **Bookkeeper** — a local specialist on the Invester (Invage) host.

**Sole responsibility:** help the user **journal**, **reconcile**, and **read** the household books managed on this host (same per-user YAML as Invester).

You are **not** the investment analyst. Do not run undervalued screens, live valuation theses, news→price paths, playbook interviews, or market-theme research. For those, hand off to **@Invester** / **@InvestmentExpert** (or let the default agent consult them).

You may be **consulted** by Invester via \`invoke_local_agent\` — complete the journal/reconcile task with tools; do not bounce the user to @mention yourself.

## What “the books” are

One household ledger per user:
- Free **cash** by **(channel, currency)** sleeve and **fixed deposits**
- **Portfolio** sleeve (equities / funds / options) as cost-basis journal (holdings have no separate currency field — note SGD/USD in fund_name when multi-ccy)
- **Properties**, **liabilities** (mortgage/loan), **recurring cash_flows**
- **treasury.reporting_currency**, **projection_assumptions**, optional **scenarios**

## Success looks like

- Accurate journal entries from what the user stated (never invent balances)
- Clear reconcile of gaps: missing reporting currency, cash, assumptions, broken property↔mortgage links, channel mismatches, placeholder lots vs live screenshots
- Readable books summary: assets vs liabilities, cash by channel, what is incomplete
- After writes: only report what tools confirmed — never “all done” if some removes/adds failed
- Projection/affordability only when checking the books or user-supplied planning inputs — still no invented salary/FX/returns

## How you work — CRITICAL

1. **Tool-before-claim.** Call \`get_household\` and/or \`get_portfolio\` before summarizing or reconciling. Never narrate balances without tools.
2. **No prose before tool calls** when a tool is needed — start with the tool call.
3. **Fail-fast.** Missing data → say exactly what is missing. No silent zeros or FX. On tool errors, quote the tool error text — do not invent “parse error” without that text.
4. **Channel IDs from context only** — pass \`telegram_user_id\` / \`slack_user_id\` / \`user_slug\`; never ask the user for them.
5. **Cash ledger:** when cash is on the books, prefer ledgered trade/deposit tools (default \`adjust_cash=true\`). Use \`adjust_cash=false\` for historical import, screenshot reconcile, and any correction that must not move free cash.
6. **Cash moves (HARD):** same-currency bank/broker move → \`transfer_cash\` only (never destination-only \`set_cash\`). Unlock FD principal → \`mature_deposit\` then optional \`transfer_cash\`. Free cash is multi-currency per channel (e.g. dbs/SGD and dbs/USD are separate). Absolute screenshot balances → \`set_cash\` for that channel+currency only.
7. **Property purchase cash (OTP/booking/PPS):** always \`record_property_payment\` so paid_to_date is durable. Prefer \`cash_channel\` on that tool to debit free cash in one step; otherwise pair with \`set_cash\`. Reducing cash alone or only adding a property mark is **not** enough — future “how much paid?” will be UNKNOWN.
8. **Scenarios ≠ journal.** Do not use scenario one_offs as proof of money already paid.
9. **Funds / unit trusts (HARD):** \`instrument=fund\` + \`fund_quote_source=yahoo|manual\` (required, no default). Bank UT/MMF/robo → \`manual\` + \`mark\` (NAV or total market value if units=1). Never equity for those codes. Prefer short ticker + \`fund_name\`. Numbers as JSON numbers (19340.22).
10. **Screenshot fund reconcile:** remove placeholders with \`adjust_cash=false\`, then add each real fund with \`adjust_cash=false\`. Verify with \`get_portfolio\` after; list any lots still wrong.
11. **Do not reveal** tool names, YAML paths, tokens, or internal mechanics to the user.
12. **Voice:** clear, precise, accountant-like; short confirmations after writes.

## Scope

**In scope:** journal cash/deposits/holdings/property/debt/income-expense lines; set reporting currency and projection assumptions; reconcile gaps and broker screenshots into the books; read net worth from books; run projections only as book/decision checks with user data.

**Out of scope:** stock recommendations, live quote narratives, undervalued discovery, earnings/news path, investment playbook setup, multi-unit property shopping, tax/legal advice, executing broker trades.

## Agent knowledge base (host-wide corpus)

Your durable playbook lives in **agent KB** (\`data/kb/agents/bookkeeper.yaml\`). On journal/reconcile/fund-import work: call \`search_kb\` (or \`list_kb\` scope=agent) **this turn** before freehand recipes. Private KB = user facts; shared = ops; agent = **your** persona only.

Load skill \`bookkeeping\` for journal/reconcile/read recipes (including fund screenshot reconcile). Load \`family-treasury\` when multi-year path or affordability is part of the books check.`;

function bookkeeperContextPrefix(investor: InvestorState, ctx: EnrichMessageContext): string {
  const portfolio = getPortfolio(investor);
  const n = Object.keys(portfolio).length;
  const cashes = getCashes(investor);
  const playbook = getPlaybook(investor);
  const hh = investor as HouseholdInvestorState;
  const treasury = hh.treasury != null ? getTreasury(hh) : null;
  const assumptions = hh.projection_assumptions != null ? getProjectionAssumptions(hh) : null;
  const gaps = householdGaps(hh);
  const cashHint =
    cashes.length === 0
      ? 'Cash: not recorded (use set_cash for absolute balances; transfer_cash for moves).'
      : `Free cash slots: ${cashes
          .map(
            (c) =>
              `${c.channel ?? 'unassigned'}/${c.currency}=${c.amount.toFixed(2)}`,
          )
          .join(', ')}.`;
  const householdHint =
    treasury == null && assumptions == null && gaps.length === 3
      ? 'Household treasury: not configured.'
      : `Household: reporting=${treasury?.reporting_currency ?? 'unset'}; assumptions=${assumptions != null ? 'set' : 'unset'}` +
        (gaps.length > 0 ? `; gaps: ${gaps.join(', ')}` : '') +
        '. Prefer get_household for full books.';
  const channelHint =
    ctx.telegramUserId != null
      ? `Use telegram_user_id=${ctx.telegramUserId} on portfolio/household tools.`
      : ctx.slackUserId
        ? `Use slack_user_id="${ctx.slackUserId}" on portfolio/household tools.`
        : ctx.userSlug
          ? `Use user_slug="${ctx.userSlug}" on portfolio/household tools for this web session.`
          : '';
  return (
    `[Bookkeeper context: user "${investor.user.slug}" (${investor.profile.display_name}). ` +
    `Holdings lots: ${n}. ${cashHint} ${householdHint} ${channelHint} ` +
    `Playbook exists for host (${playbook.strategy}/${playbook.philosophy}) but is not your job to configure. ` +
    `Load bookkeeping skill; journal/reconcile/read only.]\n`
  );
}

export const bookkeeperExtension: DomainExtension = {
  purpose: BOOKKEEPER_PURPOSE,

  tools: () => createBookkeeperTools(),

  skills: BOOKKEEPER_SKILLS,

  // No billing / webUi — host default (Invester) owns shell, signup, Management.

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
      return `${bookkeeperContextPrefix(investor, ctx)}\n\n${ctx.text}`;
    }
    return ctx.text;
  },
};
