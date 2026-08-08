/**
 * Real Estate Expert — local multi-agent peer on the Invage host.
 *
 * Sole responsibility: property-related analysis and household RE sleeve
 * (SG comps, duties, yield, marks, affordability with property). Shares
 * the same user YAML as Invester.
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
import { createRealEstateExpertTools } from '../tools/index.js';
import { getCashes, type InvestorState } from '../state/portfolio-state.js';
import {
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
    throw new Error(`Real Estate Expert skill knowledge file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

function registerRealEstateExpertSkills(): Skill[] {
  const catalog: Array<{ id: string; name: string; description: string }> = [
    {
      id: 'sg-real-estate-portfolio',
      name: 'SG Real-Estate Portfolio',
      description:
        'Singapore physical RE as a household sleeve: HDB/private comps via property_intel, BSD/ABSD/SSD (verify IRAS this turn), yield/LTV, all-in buy cost, mark fairness, allocation vs REITs, hold/sell and second-property policy cost. Load by capability fit. Not multi-unit listing shopping. Not securities research.',
    },
    {
      id: 'family-treasury',
      name: 'Family Treasury & Projections',
      description:
        'Household books and deterministic projections supporting property decisions: net worth with property/mortgage, cash flows, affordability path, scenarios. Load by capability fit with sg-real-estate-portfolio when buy/duties/affordability are in scope.',
    },
    {
      id: 'firecrawl',
      name: 'Firecrawl',
      description:
        'Load for official SG property policy tables (IRAS stamp duties, HDB rules) and primary sources. Pair with sg-real-estate-portfolio for numeric duties. Prefer property_intel for transaction comps.',
    },
  ];
  const skills: Skill[] = [];
  for (const raw of catalog) {
    registerDomainSkill(raw.id, readKnowledge(raw.id));
    skills.push({ ...raw, kind: 'knowledge' });
  }
  return skills;
}

const REAL_ESTATE_EXPERT_SKILLS = registerRealEstateExpertSkills();

const REAL_ESTATE_EXPERT_PURPOSE = `You are **Real Estate Expert** — a local specialist on the Invester (Invage) host.

**Sole responsibility:** answer **property-related** questions and manage the household **physical real-estate sleeve** with tool-backed comps, duties, yield, marks, and affordability.

You may be **consulted** by Invester via \`invoke_local_agent\` — complete the property task with tools; do not bounce the user to @mention yourself.

## What you own

1. **Comps & marks** — HDB/private sold comps via \`property_intel\`; fairness of a home mark vs comps
2. **Policy & all-in cost** — BSD/ABSD/SSD and cooling measures with **this-turn** official verification (Firecrawl IRAS or user-pasted official table + as-of); never invent duty $
3. **Yield & leverage** — gross/net yield, cash-on-cash, equity/LTV when rent/mortgage data is on books or user-stated
4. **Household property ledger** — properties, mortgages linked to units, \`record_property_payment\` / paid_to_date
5. **Affordability with property** — scenarios + \`run_projection\` / \`compare_scenarios\` when a buy or second property affects cash path
6. **URA car parks** — availability/rates via \`ura_carpark\` only
7. **Allocation framing** — physical RE equity vs portfolio/REITs (portfolio sleeve is cost/context; securities picks → Investment Expert)

## What you do not do

| Need | Hand off |
|------|----------|
| Securities / undervalued stocks / news→path | **@InvestmentExpert** |
| Pure portfolio journal / cash/FD without property | **@Bookkeeper** |
| Debt avalanche without property focus | **@Accountant** |
| Playbook methodology wizard | **@Invester** |
| Multi-unit listing shopping packs | Do not pack-shop — name a **single** price/unit for all-in + affordability instead |
| Licensed tax/legal advice; trade execution | Hard refuse as advice/execution; still help with tool-backed numbers and next steps |
| Needs time (new comps, policy date, OTP milestone) | Best answer **now** + \`create_task\` for re-check |

## How you work — CRITICAL

1. **Tool-before-claim.** Comps → \`property_intel\` this turn. Numeric duties → Firecrawl IRAS (or user-pasted official table) this turn. Books → \`get_household\` before summarizing property/mortgage.
2. **No prose before required tool calls.**
3. **Fail-fast.** Never invent transaction prices, psf, “typical town” rents, duty amounts, car-park lots, or free-and-clear status.
4. **Channel IDs from context only.**
5. **HDB vs private:** HDB resale → market=hdb; private condo/landed sold → market=private (URA).
6. **Yield:** require rent from user or matching cash_flow — never invent rent.
7. **Property payments:** paid_to_date from \`properties[].payments\` only — scenarios are not a payment ledger.
8. **search_kb** (scope agent) this turn for hard rules/recipes when doing property analysis.
9. **Voice:** clear, numbers-first, practical. Educational only — not a licensed advisor.
10. **Do not reveal** tool names, YAML, or tokens.

## Agent knowledge base

Durable recipes live in **agent KB** (\`data/kb/agents/real-estate-expert.yaml\`). On property work: \`search_kb\` / \`list_kb\` scope=agent **this turn**.

Load \`sg-real-estate-portfolio\` for RE sleeve craft. Load \`family-treasury\` when affordability/cash path is required. Load \`firecrawl\` for official duty tables.

${HELP_FIRST_AND_ASYNC_TASKS}`;

function realEstateExpertContextPrefix(
  investor: InvestorState,
  ctx: EnrichMessageContext,
): string {
  const hh = investor as HouseholdInvestorState;
  const properties = hh.properties != null ? getProperties(hh) : [];
  const treasury = hh.treasury != null ? getTreasury(hh) : null;
  const assumptions = hh.projection_assumptions != null ? getProjectionAssumptions(hh) : null;
  const gaps = householdGaps(hh);
  const cashes = getCashes(investor);
  const propHint =
    properties.length === 0
      ? 'Properties: none on books.'
      : properties
          .map((p) => {
            const paid = propertyPaidToDate(p);
            const paidStr =
              paid == null ? 'paid=UNKNOWN' : `paid=${paid.toFixed(0)} ${p.currency}`;
            return `${p.id}@mark=${p.value.toFixed(0)} ${p.currency} ${paidStr}`;
          })
          .join('; ');
  const cashHint =
    cashes.length === 0
      ? 'Free cash: not recorded.'
      : cashes
          .map((c) => `${c.channel ?? 'unassigned'}/${c.currency}=${c.amount.toFixed(2)}`)
          .join(', ');
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
    `[Real Estate Expert context: user "${investor.user.slug}" (${investor.profile.display_name}). ` +
    `${propHint} Cash: ${cashHint}. Household: ${householdHint}. ${channelHint} ` +
    `Tool-before-claim for comps/duties. Load sg-real-estate-portfolio; search_kb for recipes. ` +
    `Help-first: partial now + create_task for re-comps/policy follow-up (instruction re-consults real-estate-expert). Prefer telegram when linked. ` +
    `Securities → @InvestmentExpert; pure ledger without property → @Bookkeeper.]\n`
  );
}

export const realEstateExpertExtension: DomainExtension = {
  purpose: REAL_ESTATE_EXPERT_PURPOSE,

  tools: () => createRealEstateExpertTools(),

  skills: REAL_ESTATE_EXPERT_SKILLS,

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
      return `${realEstateExpertContextPrefix(investor, ctx)}\n\n${ctx.text}`;
    }
    return ctx.text;
  },
};
