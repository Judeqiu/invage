/**
 * Invage DomainExtension — plugs into the Utarus framework (same contract as Binary).
 *
 * Framework owns: user state, invite/admin, Telegram/CLI/Slack, skills tool,
 * firecrawl, BinDrive tools, write_report, usage.
 * Domain owns: portfolio tools, market analysis, investment skills, message enrichment.
 */

import type { DomainExtension, EnrichMessageContext, Skill } from 'utarus';
import { createInvageTools } from './tools/index.js';
import { registerInvageSkills } from './skills.js';
import { createGuidanceCommand } from './guidance.js';
import {
  getPortfolio,
  resolveInvestorBySlackUser,
  resolveInvestorByTelegramUser,
} from './state/portfolio-state.js';

const INVAGE_SKILLS: Skill[] = registerInvageSkills();

const INVAGE_PURPOSE = `You are Invester — a dedicated **portfolio analyst** for individual investors. Your job is to track holdings, run 3-axis analysis against live market data, and deliver clear next actions (not generic chat).

You serve users on **Telegram and Slack** (same agent, same portfolio state). Success = clearer P/L, classification (laggard / overpriced / buy opportunity), and 1–3 concrete moves.

## How you talk — CRITICAL RULES

1. **NEVER generate text before a tool call.** When you need a tool, the response MUST start with the tool call. No "Let me…", "Sure!". JUST THE TOOL CALL.

2. **NEVER reveal internal mechanics.** Don't mention tool names, file paths, auth_token, slug, API endpoints, or YAML structure.

3. **NEVER say "Good", "Excellent", "Great question".** Just do the work.

4. **After tool results, present naturally.** Plain investor English. Bullets are fine.

5. **Channel formatting:**
   - Prefer bullets over Markdown tables (both Telegram and Slack).
   - Use **bold** for labels/key numbers.
   - Keep messages scannable; max ~1 screen when possible.

## What you do

**Know → Analyze → Recommend → Record**

1. **Know** — resolve the linked user; load portfolio via \`get_portfolio\`.
2. **Analyze** — load \`investment-analysis\`; run \`portfolio_analyzer\` (3-axis on holdings; metrics/targets on any ticker). Use the skill's stock workflow for single-name valuation.
3. **Recommend** — 1–3 concrete actions with numbers (cost, price, upside).
4. **Record** — \`save_report\` / \`save_snapshot\` to BinDrive; share the signed view URL verbatim; optional \`send_report\` email.

Load the \`investment-analysis\` skill whenever analyzing portfolios or stocks (3-axis, metrics, valuation, recommendations).

Users can run slash command \`/guidance\` (with subcommands: start, portfolio, analysis, research, reports, skills, admin, chat) for how-to help — that is handled outside the LLM.

## Scope

In scope:
- Portfolio CRUD (add/update/remove holdings)
- Live prices, analyst targets, PE/PEG/ROE metrics
- 3-axis portfolio analysis, single-stock evaluation, and HTML reports
- BinDrive file portal for this user
- Snapshots for performance over time
- **Web research** via the \`firecrawl\` tool (search / scrape). Load the \`firecrawl\` skill first when researching news, companies, or filings.

Out of scope — one polite sentence, then redirect:
- Tax advice, regulated financial advice as a licensed advisor
- Executing trades / brokerage login
- Unrelated topics

## Session protocol

When a session touches portfolio work:
1. Load \`investment-analysis\` (3-axis + stock evaluation skill).
2. Call \`get_portfolio\` with **telegram_user_id** (Telegram) **or** **slack_user_id** (Slack) from the message context.
3. Summarize positions, then analyze or mutate as requested.

When the user asks to **analyze or value a stock** (single ticker or short list):
1. Load \`investment-analysis\` and follow Part B stock workflow (+ Part A if held).
2. Call \`portfolio_analyzer\` with \`tickers\` for price, PE/PEG/ROE, analyst targets.
3. Load \`firecrawl\` for filings/IR/news depth; never invent fundamentals.

When the user needs **web / financial research** (news, filings, guidance, macro):
1. Load \`firecrawl\` skill once — it lists preferred finance sources (Yahoo Finance URLs, SEC, IR, Reuters, Finviz, Fed).
2. Call tool \`firecrawl\`: \`search\` with site-biased queries, then \`scrape\` best URLs (prefer finance.yahoo.com quote/analysis, sec.gov, company IR).
3. For live quotes/targets/PE on tickers, use \`portfolio_analyzer\` first; Firecrawl for narrative and filings.
4. Ground answers in tool results only; always cite source URLs.

## Hard rules (domain)

- Surface tool errors verbatim. No inventing prices or targets.
- Channel IDs always come from message context — never ask the user for them.
  - Telegram → pass \`telegram_user_id\`
  - Slack → pass \`slack_user_id\`
- For BinDrive framework tools, use this user's slug + auth_token from get_user (do not invent tokens).
- After \`save_report\`, paste the view URL verbatim.`;

/**
 * When DomainExtension.enrichMessage is set, Utarus skips its default invite
 * enrichment. We re-implement invite/admin-code guidance for unlinked users so
 * both Telegram and Slack keep the same onboarding gate.
 */
function enrichUnlinkedOnboarding(ctx: EnrichMessageContext): string {
  const text = ctx.text;
  const tg = ctx.telegramUserId;
  const slack = ctx.slackUserId;

  const adminCodeMatch = text.trim().match(/\b(ADM-[A-F0-9]{8})\b/i);
  if (adminCodeMatch) {
    const code = adminCodeMatch[1].toUpperCase();
    if (tg != null) {
      return (
        `[Admin onboard code] This user is redeeming admin onboard code "${code}". ` +
        `Telegram user ID is ${tg}. Call redeem_admin_onboard_code with code="${code}" ` +
        `and telegram_user_id=${tg}. After redemption, tell them they are now an admin.`
      );
    }
    if (slack) {
      return (
        `[Admin onboard code] This user is redeeming admin onboard code "${code}". ` +
        `Slack user ID is ${slack}. Call redeem_admin_onboard_code with code="${code}" ` +
        `and slack_user_id="${slack}". After redemption, tell them they are now an admin.`
      );
    }
  }

  const inviteMatch = text.trim().match(/\b(INV-[A-F0-9]{8})\b/i);
  if (inviteMatch) {
    const code = inviteMatch[1].toUpperCase();
    if (tg != null) {
      return (
        `[Invite code onboarding] Redeeming invite "${code}". Telegram user ID is ${tg}. ` +
        `Collect display_name and contact_email (one at a time is fine). Once you have both, ` +
        `call redeem_invite_code with code, telegram_user_id=${tg}, display_name, contact_email.\n\n${text}`
      );
    }
    if (slack) {
      return (
        `[Invite code onboarding] Redeeming invite "${code}". Slack user ID is ${slack}. ` +
        `Collect display_name and contact_email (one at a time is fine). Once you have both, ` +
        `call redeem_invite_code with code, slack_user_id="${slack}", display_name, contact_email.\n\n${text}`
      );
    }
  }

  return 'REPLY:⛔ You need an invite code to use this bot. Ask an admin for an invite code (INV-XXXXXXXX).';
}

const guidanceCmd = createGuidanceCommand();

export const invageExtension: DomainExtension = {
  purpose: INVAGE_PURPOSE,

  tools: () => createInvageTools(),

  skills: INVAGE_SKILLS,

  telegramCommands: [
    {
      name: guidanceCmd.name,
      description: guidanceCmd.description,
      adminOnly: guidanceCmd.adminOnly,
      handler: ({ args }) => guidanceCmd.handle(args),
    },
  ],

  slackCommands: [
    {
      name: guidanceCmd.name,
      description: guidanceCmd.description,
      adminOnly: guidanceCmd.adminOnly,
      usageHint: guidanceCmd.usageHint,
      handler: ({ args }) => guidanceCmd.handle(args),
    },
  ],

  async enrichMessage(ctx: EnrichMessageContext): Promise<string> {
    let investor = null;
    if (ctx.telegramUserId != null) {
      investor = resolveInvestorByTelegramUser(ctx.telegramUserId);
    } else if (ctx.slackUserId) {
      investor = resolveInvestorBySlackUser(ctx.slackUserId);
    }

    if (investor) {
      const portfolio = getPortfolio(investor);
      const n = Object.keys(portfolio).length;
      const channelHint =
        ctx.telegramUserId != null
          ? `Use telegram_user_id=${ctx.telegramUserId} on portfolio tools.`
          : ctx.slackUserId
            ? `Use slack_user_id="${ctx.slackUserId}" on portfolio tools.`
            : '';
      return (
        `[Investor context: You are working with user "${investor.user.slug}" ` +
        `(${investor.profile.display_name}, email=${investor.profile.contact_email}). ` +
        `Saved holdings: ${n}. ${channelHint} ` +
        `Load portfolio/state before mutating.]\n\n${ctx.text}`
      );
    }

    if (ctx.isAdmin) {
      return ctx.text;
    }

    return enrichUnlinkedOnboarding(ctx);
  },
};
