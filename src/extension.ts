/**
 * Invage DomainExtension — plugs into the Utarus framework (same contract as Binary).
 *
 * Framework owns: user state, **invite/admin access gate (instant INV- redeem)**,
 * Telegram/CLI/Slack, skills tool, firecrawl, BinDrive tools, write_report, usage.
 * Domain owns: portfolio tools, market analysis, investment skills, domain enrich.
 */

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { DomainExtension, EnrichMessageContext, Skill } from 'utarus';
import {
  resolveUserBySlackUser,
  resolveUserByTelegramUser,
  resolveUserById,
} from 'utarus';
import { createInvageTools } from './tools/index.js';
import { DIRECT_ROUTING_POLICY } from './agents/routing-policy.js';
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
import { helpFirstAndAsyncTasks } from './agents/help-first.js';
import { productDisplayName, productHostLabel } from './product-name.js';
import {
  type ProductProfileId,
  hostNeverDoYourself,
  hostScopeIn,
  hostScopeOut,
  readProductProfile,
  specialistTableMarkdown,
} from './agents/roster.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INVAGE_SKILLS: Skill[] = registerInvageSkills(readProductProfile());

/** Web multi-agent handoff harness (utarus ≥ 3.0.0-beta.15). Opt-in via env. */
const HANDOFF_MODE = process.env.UTARUS_AGENT_HANDOFF === 'true';
const HOST = productHostLabel();
const HOST_DISPLAY = productDisplayName();

export function buildHostPurpose(
  profile: ProductProfileId = readProductProfile(),
): string {
  return `You are **${HOST}**, the ${profile === 'consultant' ? 'listed calls and puts host' : 'investor and household assistant'} for ${HOST_DISPLAY}. Help directly with sourced lookups and coordinate experts when their judgment is needed.

${DIRECT_ROUTING_POLICY}

## Available specialists

${specialistTableMarkdown(profile)}

When delegation is necessary, ${HANDOFF_MODE ? 'use handoff_to_agent on Web for one specialist at a time; use invoke_local_agent for short consultations and non-Web channels' : 'use invoke_local_agent'}. Pass only the focused task, authenticated identity, requested constraints, source revision and relevant tool fields. Explain the specific judgment or operation needed. A text promise does not transfer work. After a peer returns, finish the requested answer unless an unresolved need meets the routing policy; do not automatically start another consultation.

## Boundaries

${hostNeverDoYourself(profile)}

${profile === 'consultant' ? 'Keep the conversation focused on listed calls and puts and their broker records. For unrelated requests, give a brief scope redirect. Never execute a trade.' : `In scope: ${hostScopeIn(profile)}. Out of scope: ${hostScopeOut(profile)}.`}

Portfolio state contains holdings, retained broker executions and lifecycle events. Accounting journals contain recorded cash and position movements; their posting dates are not execution dates or NAV history. Market tools supply timestamped quotes. Do not treat stored marks as fresh quotes, sync times as fill dates, or missing history as no activity. Performance analysis requires period-boundary valuations and dated external flows; incomplete evidence cannot establish time-weighted returns.

Identity comes from message context; never invent a user/account. Do not expose credentials or internal routing details in the user answer. Speak clearly and concisely. Publish the requested result with its relevant freshness and coverage limitations. Do not add unsolicited strategy advice, payoff analysis, or monitoring offers to a lookup.

Scheduled runs follow the same routing policy as interactive requests. A price/date/balance check stays direct; requested strategy analysis or reconciliation uses the necessary expert. Create a task only when the user asks for future work and report its schedule only after confirmation from the tool.

Users may run /guidance for how-to.

${helpFirstAndAsyncTasks(profile)}`;
}

const INVAGE_PURPOSE = buildHostPurpose();

/**
 * Domain enrich only. Access / INV- instant redeem is framework-owned
 * (utarus resolveInboundMessage). Do not re-implement invite Q&A here.
 */
function investorContextPrefix(investor: InvestorState, ctx: EnrichMessageContext): string {
  if (readProductProfile() === 'consultant') {
    const portfolio = getPortfolio(investor);
    const optionLots = Object.values(portfolio).filter((holding) => holding.option != null).length;
    const channelHint = ctx.telegramUserId != null
      ? `telegram_user_id=${ctx.telegramUserId}`
      : ctx.slackUserId
        ? `slack_user_id="${ctx.slackUserId}"`
        : ctx.userId
          ? `user_id="${ctx.userId}"`
          : '';
    return `[Options host context: user "${investor.user.id}" (${investor.profile.display_name}); option lots recorded: ${optionLots}. ${channelHint}. Routine option records and quotes: read tools directly, no specialist or Factchecker. Strategy/analysis: OptionsExpert. Writes, sync or unresolved reconciliation: Bookkeeper. Audit only disputed evidence or material analytical claims. Stay on options.]\n`;
  }
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
        : ctx.userId
          ? `Pass user_id="${ctx.userId}" when framing peer tasks or residual host tools.`
          : '';
  return (
    `[Orchestrator context: user "${investor.user.id}" ` +
    `(${investor.profile.display_name}). ` +
    `Holdings lots (routing hint): ${n}. ${cashHint} ${householdHint} ${channelHint} ` +
    `Read-only lookups and tool-computed totals: answer directly with no specialist or Factchecker. Expert judgment, writes, sync and unresolved reconciliation: route only the necessary peer. Audit disputed evidence or material analytical claims only. Scheduled lookups follow the same policy.]\n` +
    playbookAgentGuidance(playbook)
  );
}

const guidanceCmd = createGuidanceCommand();

export const invageExtension: DomainExtension = {
  l10n: {
    defaultLanguage: 'en',
    languages: ['en'],
    catalogDir: resolve(__dirname, '../l10n'),
  },

  purpose: INVAGE_PURPOSE,

  tools: () => createInvageTools(),

  skills: INVAGE_SKILLS,

  /**
   * WalletStreet is the fast orchestrator: always DeepSeek (`daily`).
   * Process-wide UTARUS_LLM_ROUTE_HEAVY_* would otherwise escalate long /
   * "deep dive" turns to Kimi k3 — wrong for host routing latency.
   * Specialists (InvestmentAdvisor, FinancialPlanner, …) keep their own heavy defaults.
   * Vision (images) still uses host has_images when the user attaches photos.
   */
  llmRouting: {
    default: 'daily',
  },
  /** Empty heuristics = no heavy_chars / heavy_keyword escalate for this agent. */
  llmHeavyHeuristics: {
    keywords: [],
  },

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
      investor = await resolveUserByTelegramUser(ctx.telegramUserId) as InvestorState | null;
    } else if (ctx.slackUserId) {
      investor = await resolveUserBySlackUser(ctx.slackUserId) as InvestorState | null;
    } else if (ctx.userId) {
      // Web channel: no chat-platform id, but the gate resolves the slug
      // from the session and passes it through. Without this branch the
      // agent gets a bare prompt with no user context and re-onboards.
      investor = await resolveUserById(ctx.userId) as InvestorState | null;
    }

    if (investor) {
      const now = new Date().toISOString();
      return `[Trusted server clock: ${now}; UTC date ${now.slice(0, 10)}. Calculate relative date windows from this clock using an explicitly known user timezone when available; never infer today from stored trades or sync dates.]\n${investorContextPrefix(investor, ctx)}\n\n${ctx.text}`;
    }

    // Unlinked access is handled by Utarus before this runs for non-admins.
    // Admins and edge cases: pass text through.
    return ctx.text;
  },
};
