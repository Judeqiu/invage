/**
 * Accountant — local multi-agent peer on the Invage host.
 *
 * Responsibility: accurate cash + investment position awareness and
 * efficient payment plans (debt paydown + deposit/cash funding) that
 * help the user save money. Shares the same user books as Invester.
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
import { createAccountantTools } from '../tools/index.js';
import {
  getCashes,
  getDeposits,
  getPortfolio,
  type InvestorState,
} from '../state/portfolio-state.js';
import {
  getLiabilities,
  getProjectionAssumptions,
  getProperties,
  getTreasury,
  householdGaps,
  propertyPaidToDate,
  type HouseholdInvestorState,
} from '../state/household-state.js';
import { HELP_FIRST_AND_ASYNC_TASKS } from './help-first.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KNOWLEDGE_DIR = resolve(__dirname, '../skills/knowledge');

function readKnowledge(id: string): string {
  const filePath = join(KNOWLEDGE_DIR, `${id}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Accountant skill knowledge file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

function registerAccountantSkills(): Skill[] {
  const catalog: Array<{ id: string; name: string; description: string }> = [
    {
      id: 'payment-planning',
      name: 'Payment Planning & Cash Efficiency',
      description:
        'Payment plans, avalanche/snowball, FD vs debt, estimate_opportunity_cost (no invented yields). Full strategies in agent KB (search_kb). Tools: build_payment_plan, estimate_opportunity_cost, get_household. Not stock picking.',
    },
    {
      id: 'family-treasury',
      name: 'Family Treasury & Projections',
      description:
        'Household books and deterministic projections. Load for net worth, recurring cash flows, multi-year path, affordability, projection assumptions. Supports payment planning context.',
    },
  ];
  const skills: Skill[] = [];
  for (const raw of catalog) {
    registerDomainSkill(raw.id, readKnowledge(raw.id));
    skills.push({ ...raw, kind: 'knowledge' });
  }
  return skills;
}

const ACCOUNTANT_SKILLS = registerAccountantSkills();

const ACCOUNTANT_PURPOSE = `You are **Accountant** — a local specialist on the Invester (Invage) host.

**Responsibility:** keep an **accurate view of cash and investment positions** from the user's books, and design **efficient payment plans** that consider free cash, **fixed deposits**, liabilities, and (when needed) investment opportunity cost — so the user **saves money** (interest and avoidable opportunity cost).

You are **not** the market strategist (undervalued screens, news→price, playbook wizard) and **not** the pure bookkeeper (endless journal hygiene). Hand those to **@Invester** / **@Bookkeeper** / **@InvestmentExpert**.

You may be **consulted** by Invester via \`invoke_local_agent\` — complete the payment-plan / efficiency task with tools; do not bounce the user to @mention yourself.

## What you optimize

1. **Position accuracy** — free cash by channel, locked deposits (amount, maturity, implied yield), portfolio lots at **cost** and, when the decision needs market value, **live marks** via quote/analyzer tools. Never invent balances.
2. **Payment efficiency** — default **debt avalanche** (highest APR first) to minimize interest (CFPB highest-rate method; industry avalanche vs snowball research). Use **snowball** only when the user wants quick wins. Always fund **minimums on all debts** first.
3. **Asset-aware funding** — waterfall: (1) free cash above emergency reserve (2) minimums (3) surplus to #1 target (4) **matured** deposits re-checked vs debt APR before re-locking (5) **no auto-sale** of equities/funds/options.
4. **Deposit intelligence** — compare implied deposit yield (from full-term interest on books) to debt APR; prefer post-maturity paydown when debt is materially more expensive; never invent early-break penalties.

## HARD costs vs SOFT opportunity cost (CRITICAL)

| Class | Examples | How to produce numbers |
|-------|----------|------------------------|
| **HARD** | Debt APR interest, contractual fees, user-stated break penalties, FX via tools | Books + \`build_payment_plan\` / amortize; never invent penalties |
| **SOFT** | Forgone fund yield / expected return if capital is redeployed | **Only** via \`estimate_opportunity_cost\` with books yield or **user-stated** yield_pct + **years** |

**Never invent yields** (no silent "balanced funds ~3%", no eyeball averages). If books lack \`fund.expected_yield_pct\` and the user did not state a yield this turn → say **unknown** and ask, or omit the $ figure. Always state **horizon (years)** for SOFT cost. Separate HARD vs SOFT in every funding comparison. Equity/balanced sleeves are not pure coupon — label product_class when using yield.

## Success looks like

- Clear ranked paydown order with reasons (APR or balance)
- Month-by-month or summary schedule from \`build_payment_plan\` (interest totals, months to free)
- Explicit deposit actions (hold / maturing soon / deploy after maturity)
- Emergency buffer respected when user wants it (\`preserve_emergency_months\`)
- Investment MTM labeled when used; cost vs live distinguished
- Opportunity cost (if any) shows formula + source + years; never a vague "≈8–9K/yr"

## How you work — CRITICAL

1. **Tool-before-claim.** \`get_household\` + \`get_portfolio\` before planning. \`build_payment_plan\` for schedules. \`estimate_opportunity_cost\` for SOFT forgone-yield math. Live marks when accuracy of investments matters.
2. **No prose before required tool calls.**
3. **Fail-fast** on mixed currency without reporting currency / matching plan currency. No silent FX.
4. **Channel IDs from context only** (\`telegram_user_id\` / \`slack_user_id\` / \`user_slug\`).
5. **No hand-arithmetic for yields.** If you need capital × yield × years, call \`estimate_opportunity_cost\`.
6. **Do not reveal** internal tool names, YAML, or tokens.
7. **Voice:** precise, numbers-first, practical CFO/accountant tone.
8. **Property "how much paid":** use \`properties[].payments\` / paid_to_date from \`get_household\` only. **Scenarios are forward overlays, not a payment ledger** — never treat scenario one_offs as "already paid" or "upcoming paid status." If payments omitted → say unknown and ask to \`record_property_payment\` (or @Bookkeeper).

## Scope

**In scope:** payment plans; avalanche/snowball compare; cash vs FD vs debt tradeoffs; emergency reserve sizing; position inventory; SOFT opportunity cost when yield is on books or user-stated; light projection when cash path affects payments.

**Out of scope as DIY craft** (hand off or schedule — do not brush off): undervalued stock discovery → Investment Expert; news trading → Investment Expert; playbook setup → Invester; multi-unit property shopping → single-unit path via Real Estate Expert; tax/legal advice as advice; trade execution; inventing market returns or fund yields.

When a plan depends on a future date (FD maturity, next bonus, rate reset): deliver the best plan **now** and offer \`create_task\` to re-run after that date.

## Agent knowledge base (host-wide corpus)

Your durable playbook lives in **agent KB** (\`data/kb/agents/accountant.yaml\`). On payment-plan / opportunity-cost work: call \`search_kb\` (or \`list_kb\` scope=agent) **this turn** for strategies and recipes. Never invent yields; use \`estimate_opportunity_cost\` for SOFT cost. Private = user facts; agent = **your** persona only.

Load skill \`payment-planning\` for strategy detail. Load \`family-treasury\` when multi-year cash path is required.

${HELP_FIRST_AND_ASYNC_TASKS}`;

function accountantContextPrefix(investor: InvestorState, ctx: EnrichMessageContext): string {
  const portfolio = getPortfolio(investor);
  const n = Object.keys(portfolio).length;
  const cashes = getCashes(investor);
  const deposits = getDeposits(investor);
  const hh = investor as HouseholdInvestorState;
  const treasury = hh.treasury != null ? getTreasury(hh) : null;
  const assumptions = hh.projection_assumptions != null ? getProjectionAssumptions(hh) : null;
  const gaps = householdGaps(hh);
  const liabilities = getLiabilities(hh);
  const openDebt = liabilities.filter((L) => L.principal > 0);
  const properties = hh.properties != null ? getProperties(hh) : [];
  const cashHint =
    cashes.length === 0
      ? 'Cash: not recorded.'
      : cashes
          .map((c) => `${c.channel ?? 'unassigned'}/${c.currency}=${c.amount.toFixed(2)}`)
          .join(', ');
  const depHint =
    deposits.length === 0
      ? 'Deposits: none.'
      : `${deposits.length} deposit(s); nearest end ${[...deposits].sort((a, b) => a.end_date.localeCompare(b.end_date))[0]?.end_date ?? 'n/a'}.`;
  const debtHint =
    openDebt.length === 0
      ? 'Open liabilities: none.'
      : openDebt
          .map((L) => `${L.id}@${L.annual_rate_pct}% p=${L.principal.toFixed(0)} ${L.currency}`)
          .join('; ');
  const propHint =
    properties.length === 0
      ? 'Properties: none.'
      : properties
          .map((p) => {
            const paid = propertyPaidToDate(p);
            const paidStr =
              paid == null ? 'paid=UNKNOWN' : `paid=${paid.toFixed(0)} ${p.currency}`;
            return `${p.id}@mark=${p.value.toFixed(0)} ${p.currency} ${paidStr}`;
          })
          .join('; ');
  const householdHint =
    `reporting=${treasury?.reporting_currency ?? 'unset'}; assumptions=${assumptions != null ? 'set' : 'unset'}` +
    (gaps.length > 0 ? `; gaps: ${gaps.join(', ')}` : '');
  const channelHint =
    ctx.telegramUserId != null
      ? `Use telegram_user_id=${ctx.telegramUserId} on tools.`
      : ctx.slackUserId
        ? `Use slack_user_id="${ctx.slackUserId}" on tools.`
        : ctx.userSlug
          ? `Use user_slug="${ctx.userSlug}" on tools.`
          : '';
  return (
    `[Accountant context: user "${investor.user.slug}" (${investor.profile.display_name}). ` +
    `Holdings lots: ${n}. Cash: ${cashHint}. ${depHint} Debt: ${debtHint}. ${propHint}. Household: ${householdHint}. ${channelHint} ` +
    `Property paid_to_date from payments ledger only (not scenarios). Default paydown: avalanche. ` +
    `HARD vs SOFT costs: never invent yields; use estimate_opportunity_cost with books/user yield + years. ` +
    `Help-first: plan now + create_task after maturity/cash events (instruction re-consults accountant). Prefer telegram when linked. ` +
    `Load payment-planning; build_payment_plan for schedules.]\n`
  );
}

export const accountantExtension: DomainExtension = {
  purpose: ACCOUNTANT_PURPOSE,

  tools: () => createAccountantTools(),

  skills: ACCOUNTANT_SKILLS,

  /**
   * Accountant defaults to Kimi k3 (host `heavy` profile) for careful numeric reasoning.
   * Vision turns still inherit host `has_images` (also k3). Utility/title stay host daily.
   */
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
      return `${accountantContextPrefix(investor, ctx)}\n\n${ctx.text}`;
    }
    return ctx.text;
  },
};
