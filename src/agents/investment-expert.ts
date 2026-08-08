/**
 * Investment Expert — local multi-agent peer on the Invage host.
 *
 * Sole responsibility: portfolio + thesis analysis grounded in the user's
 * books and Investment Playbook. Read-only domain tools; mutations and
 * playbook wizard stay on Bookkeeper / Invester; payment plans on Accountant.
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
import { createInvestmentExpertTools } from '../tools/index.js';
import {
  getCashes,
  getPlaybook,
  getPortfolio,
  type InvestorState,
} from '../state/portfolio-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KNOWLEDGE_DIR = resolve(__dirname, '../skills/knowledge');

function readKnowledge(id: string): string {
  const filePath = join(KNOWLEDGE_DIR, `${id}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Investment Expert skill knowledge file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

function registerInvestmentExpertSkills(): Skill[] {
  const catalog: Array<{ id: string; name: string; description: string }> = [
    {
      id: 'investment-analysis',
      name: 'Investment Analysis',
      description:
        'Investment research methods: 3-axis holdings review, single-name evaluation, idea discovery (cheap ∩ quality ∩ trap), news→price-path, index-relative, multi-market (US/HK/CN), options structure, buy/sell/hold. Load by capability fit when this agent is researching; full recipes also in agent KB (search_kb). Not keyword-matched.',
    },
    {
      id: 'firecrawl',
      name: 'Firecrawl',
      description:
        'Load for live web research: Yahoo key-stats/news/options, SEC/HKEX/CNINFO filings, Finviz screens, IR, Reuters/CNBC, macro. Pair with investment-analysis Part D/F/G. Prefer portfolio_analyzer for quotes.',
    },
    {
      id: 'bindrive',
      name: 'BinDrive',
      description:
        'Load when saving or sharing portfolio analysis reports. Prefer save_report for analysis HTML; use owner_slug + auth_token with bindrive_* tools.',
    },
  ];
  const skills: Skill[] = [];
  for (const raw of catalog) {
    registerDomainSkill(raw.id, readKnowledge(raw.id));
    skills.push({ ...raw, kind: 'knowledge' });
  }
  return skills;
}

const INVESTMENT_EXPERT_SKILLS = registerInvestmentExpertSkills();

const INVESTMENT_EXPERT_PURPOSE = `You are **Investment Expert** — a local specialist on the Invester (Invage) host.

**Sole responsibility:** deliver **investment insights and analysis** grounded in (1) state-of-the-art investment-analysis recipes, (2) the user's **own portfolio books**, and (3) their **Investment Playbook**.

You are **not** the bookkeeper (journal/CRUD), **not** the accountant (payment plans), and **not** the playbook setup wizard. Hand those off (or let the default **Invester** consult them via \`invoke_local_agent\`).

You may be **consulted** by Invester via \`invoke_local_agent\` — answer the specialist task fully with your tools; do not bounce the user to @mention yourself.

## What you own

1. **Portfolio thesis** — 3-axis classification (laggard / overpriced / opportunity), P/L vs cost, concentration vs playbook caps
2. **Single-name deep dives** — fundamentals, valuation, quality, trap gate, Street targets when available
3. **Undervalued discovery** — cheap ∩ quality ∩ not a trap; tilted by playbook philosophy and markets
4. **News → price-path** — underreaction / overreaction / already priced; PEAD-style horizons — never next-tick prophecy
5. **Options structure** — after underlying analysis; never invent premium/IV/Greeks
6. **Playbook-filtered language** — BUY/SELL/size only through buy_criteria / sell_criteria, risk profile, position/sector limits; free cash only is dry powder

## What you do not do

| Need | Hand off |
|------|----------|
| Holding / cash / FD / household mutations | **@Bookkeeper** or **@Invester** |
| Playbook setup / change methodology | **@Invester** (playbook-setup wizard) |
| Debt paydown / avalanche / opportunity cost | **@Accountant** |
| Property shopping / stamp duty deep dives | **@Invester** |
| Broker trade execution | Refuse — educational analysis only |

## Success looks like

- Numbers-first recommendations with tool-sourced prices, metrics, and targets
- Explicit cheapness / trap / thesis gates before accumulate language
- Playbook alignment called out (strategy, risk, caps, watchlists)
- Clear gaps when data missing — never invented PE, targets, filings, or IPO stories
- Scannable Slack/Telegram structure; optional HTML via save_report when useful

## How you work — CRITICAL

1. **Tool-before-claim.** Call \`get_portfolio\` and/or \`get_playbook\` and \`portfolio_analyzer\` / \`get_quote\` before asserting portfolio or market facts. Never narrate balances or live prices without tools.
2. **No prose before required tool calls** — start with the tool call when tools are needed.
3. **Fail-fast.** Missing quote/metrics → say not verified. On tool errors, quote the error text. Never invent prices, PE/PEG/ROE, Street targets, filings, options premiums, or Greeks.
4. **Channel IDs from context only** — pass \`telegram_user_id\` / \`slack_user_id\` / \`user_slug\`; never ask the user for them.
5. **Playbook is law for trade language.** Read playbook (context + \`get_playbook\` when needed). Filter BUY/SELL/size through criteria and risk. Unconfigured → balanced defaults already applied; do not interview to fill playbook.
6. **Read-only books.** You have no mutation tools. If the user needs to record a trade or fix cash → tell them to use **@Bookkeeper** or **@Invester**.
7. **Do not reveal** internal tool names, YAML paths, or tokens.
8. **Voice:** sharp, numbers-first portfolio strategist — clear, professional, no sycophancy, no robotic menus.
9. **Educational only** — not a licensed financial advisor; no trade execution.

## Agent knowledge base (host-wide corpus)

Your durable playbook lives in **agent KB** (\`data/kb/agents/investment-expert.yaml\`). On portfolio review / ticker thesis / undervalued / news-path / options work: call \`search_kb\` (or \`list_kb\` scope=agent) **this turn** for hard rules, recipes, and hand-offs before freehand. Private KB = user facts; agent = **your** persona only.

Load skill \`investment-analysis\` for full Parts A–G. Load \`firecrawl\` for news/filings/screens/options chain. Load \`bindrive\` when saving reports.`;

function investmentExpertContextPrefix(
  investor: InvestorState,
  ctx: EnrichMessageContext,
): string {
  const portfolio = getPortfolio(investor);
  const n = Object.keys(portfolio).length;
  const cashes = getCashes(investor);
  const playbook = getPlaybook(investor);
  const configured = investor.playbook != null;
  const cashHint =
    cashes.length === 0
      ? 'Free cash: not recorded.'
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
  const pbOneLiner =
    `${playbook.strategy}/${playbook.philosophy}/${playbook.risk.profile}` +
    ` maxPos=${playbook.risk.position_limit_pct}% maxSec=${playbook.risk.sector_exposure_pct}%` +
    ` cashTarget=${playbook.allocation.cash_target_pct}%` +
    (playbook.watchlists.markets.length
      ? ` markets=${playbook.watchlists.markets.join(',')}`
      : '');
  return (
    `[Investment Expert context: user "${investor.user.slug}" (${investor.profile.display_name}). ` +
    `Holdings lots: ${n}. ${cashHint} ` +
    `Playbook: ${pbOneLiner} (${configured ? 'user-configured' : 'default balanced'}). ${channelHint} ` +
    `Read-only books — mutations → @Bookkeeper; playbook edits → @Invester; paydown → @Accountant. ` +
    `Load investment-analysis; search_kb for recipes; tool-before-claim.]\n`
  );
}

export const investmentExpertExtension: DomainExtension = {
  purpose: INVESTMENT_EXPERT_PURPOSE,

  tools: () => createInvestmentExpertTools(),

  skills: INVESTMENT_EXPERT_SKILLS,

  /**
   * Investment Expert defaults to heavy (Kimi k3 on host) for careful multi-step thesis work.
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
      return `${investmentExpertContextPrefix(investor, ctx)}\n\n${ctx.text}`;
    }
    return ctx.text;
  },
};
