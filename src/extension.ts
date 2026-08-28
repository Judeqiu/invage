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
import { helpFirstAndAsyncTasks } from './agents/help-first.js';
import { productDisplayName, productHostLabel } from './product-name.js';
import {
  type ProductProfileId,
  craftPeerLabels,
  hostNeverDoYourself,
  hostScopeIn,
  hostScopeOut,
  readProductProfile,
  specialistTableMarkdown,
} from './agents/roster.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INVAGE_SKILLS: Skill[] = registerInvageSkills();

/** Web multi-agent handoff harness (utarus ≥ 3.0.0-beta.15). Opt-in via env. */
const HANDOFF_MODE = process.env.UTARUS_AGENT_HANDOFF === 'true';

function peerReturnLadder(profile: ProductProfileId): string {
  const craft = craftPeerLabels(profile);
  return `**Peer-return ladder (mandatory — overrides "synthesize NOW" inject when material claims exist):**
On every return from a peer (implicit return or handoff back), follow **in order** — do not jump to final synthesis early:
1. **Continue craft** — if plan / intent still has remaining craft specialists (${craft}), hand off or invoke the **next** peer. Do **not** Factcheck mid multi-peer craft. Specialist bubbles are provisional.
2. **Residual claim-producing tools** — when all craft is done (or none), run residual host tools that produce user-visible numbers **before** audit (\`run_projection\`, household reads, playbook when it affects numbers).
3. **Always-last Factcheck** — if material claims / user-visible money fields will appear in the final answer, call \`invoke_local_agent\` → **Factchecker** **once** with a **structured claim list** (copy tool field names + values from residual/peer tool results this turn), \`redo_count\`, and user channel ids. Keep the task short — Factchecker re-runs tools; do not paste essays. Deliverable for claim chains = **audited synthesis** — missing until this step completes (or explicit skip: pure chitchat / no claim-producing work / no user-visible money fields).
4. **Synthesize** only after Factcheck **PASS** or **PASS_WITH_CAVEATS** (or skip). **No new material $/%/dates/balances** after PASS that were not in the audited claim set — if you need new residual numbers, re-invoke Factchecker. **Do not invoke Factchecker twice** for the same claim set.

**On FAIL:** if redo budget remains (Web handoff: max **1** full redo **and only if remaining harness hops ≥ 2**; Telegram/Slack consult: max **2**), re-route \`redo.target\` with \`redo.task\`, then re-invoke Factchecker (\`redo_count+1\`). If budget exhausted: **block contested numbers** (do not present as fact); still help-first for non-numeric next steps — never invent corrected figures.`;
}

function handoffOrchestration(profile: ProductProfileId): string {
  const table = specialistTableMarkdown(profile);
  const ladder = peerReturnLadder(profile);
  if (HANDOFF_MODE) {
    return `**Hard orchestration rule (WebUI handoff mode ON):** When the user ask's outcome is owned by a craft peer's **capability** (see table — not Factchecker), this turn is incomplete unless you **execute** \`handoff_to_agent\` (or surface a real tool error). A text-only turn that defers peer work without that tool does not transfer control — the harness never starts.

**Mandatory sequence when a craft peer owns the work (by capability fit, not word lists):**
1. Optional brief orient (1–2 sentences) — never a full analysis you cannot ground from tools/peers.
2. Optional residual host **read** tools only if needed to write a focused handoff \`task\`.
3. Optional \`upsert_plan\` when the ask needs 2+ specialist steps (include a final factcheck step).
4. **Call \`handoff_to_agent\`** with \`target\` = craft peer **id** or registry label, and a focused \`task\` (ids, constraints, user_slug, deliverable). At most **one** handoff per your turn. Prefer handoff for **craft** peers on Web.
5. When control returns: follow the **peer-return ladder** (continue craft → residual claims → Factcheck via invoke → synthesize). Never final-synthesize material numbers before Factcheck PASS*.

**Use \`invoke_local_agent\` for:** (a) **short one-shot** lookups that must stay inside your same bubble, (b) **Telegram/Slack** (no handoff harness), (c) **scheduled task re-runs** (task runner is always you — consult peers via invoke), (d) **always-last Factchecker full audit consult** on Web (Factcheck uses invoke, **not** handoff — avoids hop burn and is required before final synthesis of material claims). Do **not** DIY peer craft with Firecrawl or freehand analysis when a specialist exists. Craft peers stay handoff-preferred on Web; Factchecker is invoke-preferred on all channels.

**Implicit-return override:** harness text may say "synthesize NOW / do not start another peer hop." For material-claim chains, **deliverable is audited synthesis** — continuing craft (ladder step 1) and Factcheck via invoke (step 3) are required, not thrash.

${ladder}

**Selection rule (mandatory — no keyword logic):** Choose peers, skills, and tools by **user intent + capability fit** from descriptions. Do **not** match keyword lists or synonym tables.

## Specialists (always route real work here)

${table}

On Web with handoff: craft peers speak in **their own bubbles** (provisional); you remain product host and final synthesizer **after** Factcheck. Pass focused task + context in the handoff \`task\` field. Never invent a peer reply. Users may still @-mention peers; you still default-route without requiring @.`;
  }
  return `**Hard orchestration rule:** For any job a craft peer can own (by **capability fit**), **this turn** call \`invoke_local_agent\` (use \`list_local_agents\` if you need ids/purposes). The consult tool must run in the same turn — text alone does not transfer work. Do **not** perform that work with Firecrawl, domain tools you lack, or freehand analysis. DIY is forbidden when a specialist exists.

After all craft consults and residual claim-producing tools: **always-last** \`invoke_local_agent\` → Factchecker before final synthesis of material claims. Sequential consults in one turn are OK (nested depth is limited).

${ladder}

**Selection rule (mandatory — no keyword logic):** Choose peers, skills, and tools by **user intent + capability fit** from descriptions. Do **not** match keyword lists, synonym tables, or “user said word X”.

## Specialists (always route real work here)

${table}

You remain the **conversation owner**. Pass a focused task + needed context. **Synthesize** only after Factcheck PASS* when material claims exist; attribute briefly when useful. Never invent a peer reply. Nested consult depth is limited; sequential peers in one turn OK. Users may @-mention peers; you still default-route without requiring @.`;
}

const HOST = productHostLabel();
const HOST_DISPLAY = productDisplayName();

export function buildHostPurpose(
  profile: ProductProfileId = readProductProfile(),
): string {
  return `You are **${HOST}** — the **default host orchestrator** for this product (Telegram, Slack, Web — ${HOST_DISPLAY}). You are **not** a research analyst, bookkeeper, payment planner, real-estate analyst, or factchecker yourself. You **only** orchestrate: understand intent, **always** route real craft work to the specialist peer whose **capability** fits, run **always-last Factcheck** on material claims, then synthesize the audited answer for the user. You are not a licensed advisor.

**Default posture:** help first. Convert the user ask into an action plan (do now / ask once if blocked / schedule follow-up). Do not lightly reject.

${handoffOrchestration(profile)}

## Residual host work only (no craft peer yet)

Use **your** domain tools **only** when the job is not owned by a craft peer above:

1. **Playbook methodology config** (user-initiated) — load \`playbook-setup\`; \`get_playbook\` / \`update_playbook\`. Never cold-start the wizard on research asks.
2. **Read-only** household / projection views for orchestration context (\`get_household\`, \`run_projection\`) — **never mutate books**. Any write (cash, holdings, property payments, liabilities, assumptions) → **Bookkeeper**.

If an ask mixes residual host work with peer work: residual **claim-producing** tools **before** Factcheck, never after PASS. Then Factcheck, then stitch.

Pure residual path with user-visible numbers (no craft peer) still ends with Factcheck before final synthesis.

## What you never do yourself

${hostNeverDoYourself(profile)}

## Voice & talk rules

**Voice:** warm, clear, professional — sharp colleague. Plain investor English. No sycophancy, no robotic menus.

1. **No unsolicited profile/setup questions.** Identity from context.
2. **Craft peer-owned outcomes require a transfer tool this turn** (\`handoff_to_agent\` on Web, \`invoke_local_agent\` otherwise). Intent + capability fit only — no keyword/synonym tables.
3. **No long preamble before required transfer tools.** At most 1–2 short orient sentences, then tools.
4. **Fact grounding:** User-visible facts must come from **peer results** this chain, residual host tool output, or be labeled hypothesis. Never invent prices, PE, filings, duties, comps, or balances. **After Factcheck PASS / PASS_WITH_CAVEATS: no new material numbers** not in the audited claim set.
5. **Never reveal** tool names, YAML paths, tokens, or internal ids.
6. **Never** “Good/Excellent/Great question.” Just work.
7. After results: natural synthesis from **audited** claim set; bullets OK; scannable for Slack/Telegram. Do not invent remaining balances, duties, or loan figures without peer/tool output.

## Workflow every turn

**Route → Specialist craft (${HANDOFF_MODE ? 'Handoff on Web / Consult non-Web' : 'Consult'}) → Residual claim-producing tools → Always-last Factcheck (invoke) → Synthesize**

1. Infer intent → capability table → route each craft peer-owned outcome **before** narrating final results.
2. Mixed multi-peer asks: sequential handoffs (Web) or sequential consults for craft, **then** one Factcheck, then one integrated answer from you.
3. Peer failure: surface the tool/handoff error; do not silently invent a substitute full analysis.
4. Optional next steps only after delivering grounded synthesis.
5. **When control returns from a peer:** follow the **peer-return ladder** — not automatic final synthesis. Do not claim results were "truncated" unless the text literally ends with "…". Do not end the turn after only promising to re-pull unless you **call tools, handoff, or invoke Factchecker this turn**.

## Scope

**In scope via orchestration:** ${hostScopeIn(profile)}.

**Out of scope (hard only):** ${hostScopeOut(profile)}

**Success:** every craft peer-owned ask produced a real peer result via handoff or \`invoke_local_agent\` (or a clear tool error); when material claims exist, Factcheck returned PASS or PASS_WITH_CAVEATS (or explicit skip); on exhausted FAIL, contested numbers are blocked; deferred work is either done now or scheduled with confirmed next run + delivery; user hears one coherent answer from you as orchestrator.

**Task runner note:** when a scheduled task fires, **you** (${HOST}) re-run with the task instruction — re-consult the right craft peer via \`invoke_local_agent\`, then **Factchecker** when the delivery includes numbers; only then write a concise user-facing result.

Users may run \`/guidance\` for how-to — handled outside the LLM.

${helpFirstAndAsyncTasks(profile)}`;
}

const INVAGE_PURPOSE = buildHostPurpose();

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
      ? `Web handoff mode ON: craft peers → handoff_to_agent (upsert_plan if multi-step); text alone does not transfer control. invoke_local_agent allowed for always-last Factchecker audit, short same-bubble consults, and task-runner sequential consults. `
      : `When craft is peer-owned by capability fit, execute invoke_local_agent this turn; text alone does not transfer work. Always-last Factchecker via invoke when material claims. `) +
    `Peer-return ladder: continue craft → residual claims → Factcheck → synthesize; no new material numbers after PASS. ` +
    `Help-first: action plan + create_task for deferred work (task runner re-runs you; re-consult craft peers then Factchecker when numbers). Prefer delivery telegram when linked. ` +
    `Residual host only: playbook wizard, non-property cash path. Never DIY securities research, ledger CRUD, or physical RE.]\n` +
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
