/**
 * Invage DomainExtension — plugs into the Utarus framework (same contract as Binary).
 *
 * Framework owns: user state, **invite/admin access gate (instant INV- redeem)**,
 * Telegram/CLI/Slack, skills tool, firecrawl, BinDrive tools, write_report, usage.
 * Domain owns: portfolio tools, market analysis, investment skills, domain enrich.
 */

import type { DomainExtension, EnrichMessageContext, Skill } from 'utarus';
import {
  resolveUserBySlackUser,
  resolveUserByTelegramUser,
  resolveUserBySlug,
} from 'utarus';
import { createInvageTools } from './tools/index.js';
import { registerInvageSkills } from './skills.js';
import { INVAGE_CREDIT_RATES } from './credit-rates.js';
import { createGuidanceCommand } from './guidance.js';
import { playbookAgentGuidance } from './playbook/index.js';
import { handleBindCommand, handleBindWebCommand } from './onboard/bind-command.js';
import { handleOnboardCommand, handleOnboardWebCommand } from './onboard/admin-commands.js';
import {
  getCashes,
  getPlaybook,
  getPortfolio,
  type InvestorState,
} from './state/portfolio-state.js';
import {
  getProjectionAssumptions,
  getTreasury,
  householdGaps,
  type HouseholdInvestorState,
} from './state/household-state.js';
import { createInvageWebUi } from './webapp/invage-webui.js';
import { HELP_FIRST_AND_ASYNC_TASKS } from './agents/help-first.js';

const INVAGE_SKILLS: Skill[] = registerInvageSkills();

/** Web multi-agent handoff harness (utarus ≥ 3.0.0-beta.15). Opt-in via env. */
const HANDOFF_MODE = process.env.UTARUS_AGENT_HANDOFF === 'true';

const SPECIALIST_TABLE = `| Peer | id | Capability — route when intent fits |
|------|-----|--------------------------------------|
| **Bookkeeper** | \`bookkeeper\` | Ledger integrity: journal, import/reconcile, cash/FD sleeves, holding mutations |
| **Accountant** | \`accountant\` | Payment efficiency: paydown schedules, deposit-vs-debt, opportunity-cost math |
| **Investment Expert** | \`investment-expert\` | Securities research & recommendations: portfolio evaluation, idea discovery, single-name thesis, news→path, options, live marks, analysis reports |
| **Real Estate Expert** | \`real-estate-expert\` | Physical property: comps, stamp duties, yield/LTV, home marks, property ledger, second-property all-in, SG RE affordability with duties, URA car parks |`;

const HANDOFF_ORCHESTRATION = HANDOFF_MODE
  ? `**Hard orchestration rule (WebUI handoff mode ON):** For any multi-step or specialist-owned job, **prefer \`handoff_to_agent\`** so the peer owns a **separate assistant message** (visible speaker chip, own tools). Use:
1. \`upsert_plan\` when the user ask needs 2+ specialist steps (or plan + synthesis).
2. \`handoff_to_agent\` with \`target\` = peer **id** or label (\`bookkeeper\`, \`InvestmentExpert\`, …) and a focused \`task\` (include tickers, constraints, user_slug context).
3. When control returns (peer finished or implicit return), update plan steps if needed, hand off to the next peer, or **synthesize** a coherent user answer.
4. At most **one** \`handoff_to_agent\` per your turn.

**Still use \`invoke_local_agent\`** only for: (a) **short one-shot** lookups that must stay inside your same bubble, (b) **Telegram/Slack** (no handoff harness), (c) **scheduled task re-runs** (task runner is always you — consult peers via invoke). Do **not** DIY peer craft with Firecrawl or freehand analysis when a specialist exists.

**Selection rule (mandatory — no keyword logic):** Choose peers, skills, and tools by **user intent + capability fit** from descriptions. Do **not** match keyword lists or synonym tables.

## Specialists (always route real work here)

${SPECIALIST_TABLE}

On Web with handoff: peers speak in **their own bubbles**; you remain product host and final synthesizer. Pass focused task + context in the handoff \`task\` field. Never invent a peer reply. Users may still @-mention peers; you still default-route without requiring @.`
  : `**Hard orchestration rule:** For any job a peer can own, **this turn** call \`invoke_local_agent\` (use \`list_local_agents\` if you need ids/purposes). Do **not** perform that work with Firecrawl, domain tools you lack, or freehand analysis. DIY is forbidden when a specialist exists.

**Selection rule (mandatory — no keyword logic):** Choose peers, skills, and tools by **user intent + capability fit** from descriptions. Do **not** match keyword lists, synonym tables, or “user said word X”.

## Specialists (always route real work here)

${SPECIALIST_TABLE}

You remain the **conversation owner**. Pass a focused task + needed context. **Synthesize** peer output into your reply; attribute briefly when useful. Never invent a peer reply. Nested consult depth is limited; sequential peers in one turn OK. Users may @-mention peers; you still default-route without requiring @.`;

const INVAGE_PURPOSE = `You are **Invester** — the **default host orchestrator** for this product (Telegram, Slack, Web). You are **not** a research analyst, bookkeeper, payment planner, or real-estate analyst yourself. You **only** orchestrate: understand intent, **always** route real work to the specialist peer whose **capability** fits, then synthesize their reply for the user. You are not a licensed advisor.

**Default posture:** help first. Convert the user ask into an action plan (do now / ask once if blocked / schedule follow-up). Do not lightly reject.

${HANDOFF_ORCHESTRATION}

## Residual host work only (no peer yet)

Use **your** domain tools **only** when the job is not owned by a peer above:

1. **Playbook methodology config** (user-initiated) — load \`playbook-setup\`; \`get_playbook\` / \`update_playbook\`. Never cold-start the wizard on research asks.
2. **Non-property household cash path** — load \`family-treasury\` for pure cash-flow / multi-year projection **without** a property comps/duties/mark thesis. Any property-centric job → **Real Estate Expert**.

If an ask mixes residual host work with peer work, do residual tools **and** route peer-owned parts (handoff or invoke), then stitch.

## What you never do yourself

- Portfolio CRUD, cash/FD ledger moves, screenshot import → **Bookkeeper**
- Debt paydown / opportunity-cost schedules → **Accountant**
- Quotes, valuation, securities discovery/thesis, news path, options → **Investment Expert**
- Property comps, duties, yield, home marks, property buy all-in, RE affordability with policy cost, car parks → **Real Estate Expert**
- Do not claim “I can handle that myself” when a peer owns the capability

## Voice & talk rules

**Voice:** warm, clear, professional — sharp colleague. Plain investor English. No sycophancy, no robotic menus.

1. **No unsolicited profile/setup questions.** Identity from context.
2. **No prose before required tool/consult/handoff calls.**
3. **Fact grounding:** User-visible facts must come from **peer results** this chain, residual host tool output, or be labeled hypothesis. Never invent prices, PE, filings, duties, comps, or balances.
4. **Never reveal** tool names, YAML paths, tokens, or internal ids.
5. **Never** “Good/Excellent/Great question.” Just work.
6. After results: natural synthesis; bullets OK; scannable for Slack/Telegram.

## Workflow every turn

**Route → ${HANDOFF_MODE ? 'Handoff (Web multi-step) / Consult (short or non-Web)' : 'Consult (always for peer work)'} → Residual host tools if needed → Synthesize**

1. Infer intent → capability table → route each peer-owned outcome **before** narrating final results.
2. Mixed multi-peer asks: sequential handoffs (Web) or sequential consults, then one integrated answer from you.
3. Peer failure: surface the tool/handoff error; do not silently invent a substitute full analysis.
4. Optional next steps only after delivering grounded synthesis.

## Scope

**In scope via orchestration:** peers + residual host tools (books, payments, securities research, physical RE, non-property cash path, playbook config) + **scheduled follow-ups** via \`create_task\` when work needs time.

**Out of scope (hard only):** tax/licensed advice as advice; trade execution; multi-unit listing shopping packs (offer single-unit path); topics with no household/market/property link. Everything else → action plan, not a brush-off.

**Success:** every peer-owned ask produced a real peer result via handoff or \`invoke_local_agent\` (or a clear tool error); deferred work is either done now or scheduled with confirmed next run + delivery; user hears one coherent answer from you as orchestrator.

**Task runner note:** when a scheduled task fires, **you** (Invester) re-run with the task instruction — always re-consult the right peer via \`invoke_local_agent\` for specialist craft; deliver a concise user-facing result.

Users may run \`/guidance\` for how-to — handled outside the LLM.

${HELP_FIRST_AND_ASYNC_TASKS}`;

/**
/**
 * Domain enrich only. Access / INV- instant redeem is framework-owned
 * (utarus resolveInboundMessage). Do not re-implement invite Q&A here.
 */
function investorContextPrefix(investor: InvestorState, ctx: EnrichMessageContext): string {
  const portfolio = getPortfolio(investor);
  const n = Object.keys(portfolio).length;
  const cashes = getCashes(investor);
  // Do not call totalCash here — multi-currency books need live FX (async); list channels only.
  const playbook = getPlaybook(investor);
  const hh = investor as HouseholdInvestorState;
  const treasury = hh.treasury != null ? getTreasury(hh) : null;
  const assumptions = hh.projection_assumptions != null ? getProjectionAssumptions(hh) : null;
  const gaps = householdGaps(hh);
  const cashHint =
    cashes.length === 0
      ? 'Cash: not recorded (ledger cash changes → Bookkeeper; do not DIY set_cash).'
      : `Free cash slots: ${cashes
          .map(
            (c) =>
              `${c.channel ?? 'unassigned'}/${c.currency}=${c.amount.toFixed(2)}`,
          )
          .join(', ')}` +
        (cashes.length > 1
          ? treasury != null
            ? ` (mixed ccy → sum in ${treasury.reporting_currency} via live FX on get_portfolio / dashboard).`
            : ' (mixed ccy — set_treasury reporting_currency to sum with live FX).'
          : '.');
  const householdHint =
    treasury == null && assumptions == null && gaps.length === 3
      ? 'Household treasury: not configured (set_treasury / cash flows / assumptions when user asks net worth path or house affordability).'
      : `Household: reporting=${treasury?.reporting_currency ?? 'unset'}; assumptions=${assumptions != null ? 'set' : 'unset'}` +
        (gaps.length > 0 ? `; gaps: ${gaps.join(', ')}` : '') +
        '. Use get_household / family-treasury for projections.';
  const channelHint =
    ctx.telegramUserId != null
      ? `Pass telegram_user_id=${ctx.telegramUserId} when framing peer tasks or residual host tools.`
      : ctx.slackUserId
        ? `Pass slack_user_id="${ctx.slackUserId}" when framing peer tasks or residual host tools.`
        : ctx.userSlug
          ? `Pass user_slug="${ctx.userSlug}" when framing peer tasks or residual host tools.`
          : '';
  return (
    `[Orchestrator context: user "${investor.user.slug}" ` +
    `(${investor.profile.display_name}). ` +
    `Holdings lots (routing hint): ${n}. ${cashHint} ${householdHint} ${channelHint} ` +
    (HANDOFF_MODE
      ? `Web handoff mode ON: prefer handoff_to_agent (+ upsert_plan for multi-step) for Bookkeeper / Accountant / Investment Expert / Real Estate Expert by capability fit; invoke_local_agent only for short same-bubble consults. `
      : `Always invoke_local_agent for Bookkeeper / Accountant / Investment Expert / Real Estate Expert by capability fit. `) +
    `Help-first: action plan + create_task for deferred work (task runner re-runs you; re-consult peers via invoke_local_agent). Prefer delivery telegram when linked. ` +
    `Residual host only: playbook wizard, non-property cash path. Never DIY securities research, ledger CRUD, or physical RE.]\n` +
    playbookAgentGuidance(playbook)
  );
}

const guidanceCmd = createGuidanceCommand();

export const invageExtension: DomainExtension = {
  purpose: INVAGE_PURPOSE,

  tools: () => createInvageTools(),

  skills: INVAGE_SKILLS,

  // Credit rates required at boot (utarus ≥ 1.17) even when paywall is off.
  // Do NOT set plans / UTARUS_BILLING_ENABLED until Stripe prices exist.
  billing: {
    creditRates: INVAGE_CREDIT_RATES,
  },

  /** Dashboard tab + domain APIs in the Utarus WebUI shell. */
  webUi: createInvageWebUi(),

  telegramCommands: [
    {
      name: guidanceCmd.name,
      description: guidanceCmd.description,
      adminOnly: guidanceCmd.adminOnly,
      handler: ({ args }) => guidanceCmd.handle(args),
    },
  ],

  // Access / INV- instant redeem / demo mode are framework-owned
  // (utarus resolveInboundMessage on free text only). Domain QR path:
  // investor.lextok.com → POST /api/onboard/register → Slack /bind BIND-…
  // runs as a slash command and never hits the access gate. Keep adminOnly: false.
  // WebUI mirrors the same domain commands via webCommands (composer /name args).
  slackCommands: [
    {
      name: guidanceCmd.name,
      description: guidanceCmd.description,
      adminOnly: guidanceCmd.adminOnly,
      usageHint: guidanceCmd.usageHint,
      handler: ({ args }) => guidanceCmd.handle(args),
    },
    {
      name: 'bind',
      description: 'Finish registration with a BIND- code from investor.lextok.com',
      adminOnly: false,
      usageHint: 'BIND-XXXXXXXX',
      handler: (ctx) => handleBindCommand(ctx),
    },
    {
      name: 'onboard',
      description: 'List or reject QR-onboarded registrations (admin)',
      adminOnly: true,
      usageHint: 'list [pending|used|rejected|all] | reject <token> [reason]',
      handler: (ctx) => handleOnboardCommand(ctx),
    },
  ],

  // Same domain set as slackCommands — Utarus WebUI intercepts `/name args`
  // on POST /api/chat/messages and returns { kind: 'reply' } without the LLM.
  // Framework-reserved names (do not register): clear, help.
  webCommands: [
    {
      name: guidanceCmd.name,
      description: guidanceCmd.description,
      adminOnly: guidanceCmd.adminOnly,
      usageHint: guidanceCmd.usageHint,
      handler: ({ args }) => guidanceCmd.handle(args),
    },
    {
      name: 'bind',
      description: 'Finish registration with a BIND- code from investor.lextok.com',
      adminOnly: false,
      usageHint: 'BIND-XXXXXXXX',
      handler: (ctx) => handleBindWebCommand(ctx),
    },
    {
      name: 'onboard',
      description: 'List or reject QR-onboarded registrations (admin)',
      adminOnly: true,
      usageHint: 'list [pending|used|rejected|all] | reject <token> [reason]',
      handler: (ctx) => handleOnboardWebCommand(ctx),
    },
  ],

  async enrichMessage(ctx: EnrichMessageContext): Promise<string> {
    let investor: InvestorState | null = null;
    if (ctx.telegramUserId != null) {
      investor = resolveUserByTelegramUser(ctx.telegramUserId) as InvestorState | null;
    } else if (ctx.slackUserId) {
      investor = resolveUserBySlackUser(ctx.slackUserId) as InvestorState | null;
    } else if (ctx.userSlug) {
      // Web channel: no chat-platform id, but the gate resolves the slug
      // from the session and passes it through. Without this branch the
      // agent gets a bare prompt with no user context and re-onboards.
      investor = resolveUserBySlug(ctx.userSlug) as InvestorState | null;
    }

    if (investor) {
      return `${investorContextPrefix(investor, ctx)}\n\n${ctx.text}`;
    }

    // Unlinked access is handled by Utarus before this runs for non-admins.
    // Admins and edge cases: pass text through.
    return ctx.text;
  },
};
