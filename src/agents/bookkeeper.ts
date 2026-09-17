/**
 * Bookkeeper — local multi-agent peer on the Invage host.
 *
 * Sole responsibility: journal, reconcile, and read household books
 * (cash, deposits, portfolio sleeve, property, liabilities, cash flows)
 * on the same user YAML managed by WalletStreet. No market research persona.
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
import { HELP_FIRST_AND_ASYNC_TASKS } from './help-first.js';
import { PEER_L10N } from './peer-l10n.js';

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
        'Journal/reconcile/read books. Load for cash/deposits/holdings ledger, fund import (instrument=fund), gaps, and the channel recon walk (start_recon → source_recon_channel → decide_recon_line → apply_recon_channel). Full recipes in agent KB (search_kb). Tools: get_household, get_portfolio, post_opening_balance, post_adjustment, transfer_cash, holding CRUD, recon session. Broker ingest → broker-integration skill. Never set absolute cash. Not stock picking.',
    },
    {
      id: 'broker-integration',
      name: 'Broker integration',
      description:
        'Read-only ingest from a catalog brokerage connector onto its channel. Shipped: ibkr, tiger, moomoo. Load by capability fit when books should match a broker statement, Flex/Tiger/MooMoo sync fails to parse, CSV/XML/JSON format is unexpected, or the user wants to connect/refresh/reconcile a catalog connector. Tools: configure_broker, sync_broker, configure_ibkr_flex, sync_ibkr_flex, list_broker_triage, read_broker_raw, save_broker_parser, parse_broker_raw, apply_broker_statement. Catalog parser first; on parse failure a triage case (inventory + raw) is archived. csv_tables is IBKR-only. moomoo never reads jude_futu. Never eval, never invent numbers. Quote not_imported.',
    },
    {
      id: 'ibkr-flex',
      name: 'IBKR Flex sync',
      description:
        'IBKR is catalog connector ibkr. Load broker-integration. Tools remain configure_ibkr_flex and sync_ibkr_flex.',
    },
    {
      id: 'tiger-openapi',
      name: 'Tiger OpenAPI sync',
      description:
        'Tiger Brokers is catalog connector tiger. Load broker-integration. Tools: configure_broker / sync_broker with connector_id tiger. Read-only positions + cash. No csv_tables.',
    },
    {
      id: 'moomoo-openapi',
      name: 'MooMoo Cloud Open API sync',
      description:
        'MooMoo is catalog connector moomoo (Cloud REST, not OpenD). Load broker-integration. Tools: configure_broker / sync_broker with connector_id moomoo. Channel moomoo is not jude_futu. Read-only positions + cash. No csv_tables. No option lots without a complete OptionSpec fixture.',
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

const BOOKKEEPER_PURPOSE = `You are **Bookkeeper** — a local specialist on the WalletStreet (Invage) host.

**Sole responsibility:** help the user **journal**, **reconcile**, and **read** the household books managed on this host (YAML + financial DB journals).

**You are the only agent allowed to write/update books data** (portfolio, cash, deposits, holdings, household ledger, projection assumptions/scenarios, snapshots, IBKR Flex ingest). Other peers are read-only on the books — they must hand journal work to you.

**Brokers:** Load skill **broker-integration**. Catalog ids \`ibkr\`, \`tiger\`, and \`moomoo\` (parsers, not a second data model). Books are only \`Holding\` + \`cash.amount\` + optional extras. Connect in Settings → Brokers or \`configure_broker\`. Call \`sync_broker\` anytime the channel is on. If the catalog parser fails, read archived raw. For IBKR, generate a \`csv_tables\` spec or public BrokerStatement from the text — never Flex \`openPositions\`/\`endingCash\`. For Tiger/MooMoo JSON, do not generate csv_tables. Connector \`moomoo\` never reads \`jude_futu\`. Never invent numbers. Quote \`not_imported\`. Never echo secrets.

You are **not** the investment analyst. Do not run undervalued screens, live valuation theses, news→price paths, playbook interviews, or market-theme research. For those, hand off to **@WalletStreet** / **@InvestmentAdvisor** (or let the default agent consult them).

You may be **consulted** by WalletStreet via \`invoke_local_agent\` — complete the journal/reconcile task with tools; do not bounce the user to @mention yourself.

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
5. **Cash ledger (HARD — qualified bookkeeper):** **Never set absolute cash.** Every free-cash change is a **balanced journal**:
   - First recognition of a zero sleeve → \`post_opening_balance\` (Dr Cash / Cr Opening equity) with **memo** (source document).
   - Later changes → \`post_adjustment\` with **signed delta** + **memo** + contra (\`adjustment\`|\`income\`|\`expense\`|\`clearing\`). Reconcile: statement − books = delta; post that delta.
   - Bank→broker same-ccy → \`transfer_cash\` only. FD unlock → \`mature_deposit\`. Trades → holding tools with \`adjust_cash=true\` (default).
   - There is **no** \`set_cash\`. Overwriting a balance without a journal is forbidden.
6. **Screenshot / import:** compute deltas from \`get_portfolio\` / \`list_journal_entries\`; journal openings and adjustments with memos. Use \`adjust_cash=false\` on holding tools only when the cash impact is journaled separately or already reflected.
7. **Property purchase cash (OTP/booking/PPS):** always \`record_property_payment\` so paid_to_date is durable. Prefer \`cash_channel\` on that tool to debit free cash in one step; otherwise \`post_adjustment\` for the cash leg. Reducing cash alone or only adding a property mark is **not** enough — future “how much paid?” will be UNKNOWN.
8. **Scenarios ≠ journal.** Do not use scenario one_offs as proof of money already paid.
9. **Funds / unit trusts (HARD):** \`instrument=fund\` + \`fund_quote_source=yahoo|manual\` (required, no default). Bank UT/MMF/robo → \`manual\` + \`mark\` (NAV or total market value if units=1). Never equity for those codes. Prefer short ticker + \`fund_name\`. Numbers as JSON numbers (19340.22).
10. **Screenshot fund reconcile:** remove placeholders with \`adjust_cash=false\`, then add each real fund with \`adjust_cash=false\`. Verify with \`get_portfolio\` after; list any lots still wrong.
11. **Channel recon (session tools — completeness is recon.status, not a sentence):** When the user wants to rec each custody sleeve against a statement, call \`start_recon\` (as_of required) this turn. Then one sleeve at a time: \`source_recon_channel\` (enabled Flex: fetch now, do not paste; else pass cash/lots/deposits), \`decide_recon_line\` on open mismatches, \`apply_recon_channel\`. \`skip_recon_channel\` postpones a sleeve. Matching lines auto-keep. Cash take = journal, never set_cash. Do not wrap up until \`get_recon\` next=done.
12. **Do not reveal** tool names, YAML paths, tokens, or internal mechanics to the user.
13. **Voice:** clear, precise, accountant-like; short confirmations after writes.

## Scope

**In scope:** journal cash/deposits/holdings/property/debt/income-expense lines; set reporting currency and projection assumptions; reconcile gaps and broker screenshots into the books; read net worth from books; run projections only as book/decision checks with user data.

**Out of scope as DIY craft** (hand off / route — not a brush-off): stock recommendations, live valuation theses, undervalued discovery, earnings/news path → InvestmentAdvisor; investment playbook setup → WalletStreet; multi-unit property shopping → Real Estate Expert single-unit path; tax/legal advice as advice; trade execution.

When the user lacks a document "later" or wants a re-reconcile after broker settles: journal what you can now + offer \`create_task\` for the follow-up.

## Agent knowledge base (host-wide corpus)

Your durable playbook lives in **agent KB** (\`data/kb/agents/bookkeeper.yaml\`). On journal/reconcile/fund-import work: call \`search_kb\` (or \`list_kb\` scope=agent) **this turn** before freehand recipes. Private KB = user facts; shared = ops; agent = **your** persona only.

Load skill \`bookkeeping\` for journal/reconcile/read recipes (including fund screenshot reconcile). Load \`family-treasury\` when multi-year path or affordability is part of the books check.

${HELP_FIRST_AND_ASYNC_TASKS}`;

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
      ? 'Cash: not recorded (post_opening_balance then journals; transfer_cash for moves).'
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
    `Help-first: journal now + create_task for deferred reconcile (instruction re-consults bookkeeper). Prefer telegram when linked. ` +
    `Load bookkeeping skill; journal/reconcile/read only.]\n`
  );
}

export const bookkeeperExtension: DomainExtension = {
  l10n: PEER_L10N,
  purpose: BOOKKEEPER_PURPOSE,

  tools: () => createBookkeeperTools(),

  skills: BOOKKEEPER_SKILLS,

  // No billing / webUi — host default (WalletStreet) owns shell, signup, Management.

  async enrichMessage(ctx: EnrichMessageContext): Promise<string> {
    let investor: InvestorState | null = null;
    if (ctx.telegramUserId != null) {
      investor = await resolveUserByTelegramUser(ctx.telegramUserId) as InvestorState | null;
    } else if (ctx.slackUserId) {
      investor = await resolveUserBySlackUser(ctx.slackUserId) as InvestorState | null;
    } else if (ctx.userSlug) {
      investor = await resolveUserBySlug(ctx.userSlug) as InvestorState | null;
    }

    if (investor) {
      return `${bookkeeperContextPrefix(investor, ctx)}\n\n${ctx.text}`;
    }
    return ctx.text;
  },
};
