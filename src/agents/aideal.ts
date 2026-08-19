/**
 * AIDeal — local multi-agent peer on the WalletStreet host.
 *
 * Sole responsibility: named Aideal Investment production (sleeve index,
 * weekly pack, Gmail-safe newsletter). Read-only books.
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
import { createAidealTools } from '../tools/index.js';
import {
  getCashes,
  getPortfolio,
  type InvestorState,
} from '../state/portfolio-state.js';
import { HELP_FIRST_AND_ASYNC_TASKS } from './help-first.js';
import { AIDEAL_SLEEVES } from '../aideal/sleeves.js';

const HOST_LABEL = 'WalletStreet';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KNOWLEDGE_DIR = resolve(__dirname, '../skills/knowledge');

function readKnowledge(id: string): string {
  const filePath = join(KNOWLEDGE_DIR, `${id}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`AIDeal skill knowledge file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

function registerAidealSkills(): Skill[] {
  const catalog: Array<{ id: string; name: string; description: string }> = [
    {
      id: 'aideal-production',
      name: 'Aideal Production',
      description:
        'Named Aideal Investment production: sleeve index vs sector ETF, weekly five-section pack, Gmail-safe newsletter. Load by capability fit when the deliverable is this book’s report/index/newsletter — not a generic stock thesis. Tools: list_aideal_sleeves, compute_sleeve_index, save_aideal_newsletter. Full recipes in agent KB (search_kb).',
    },
  ];
  const skills: Skill[] = [];
  for (const raw of catalog) {
    registerDomainSkill(raw.id, readKnowledge(raw.id));
    skills.push({ ...raw, kind: 'knowledge' });
  }
  return skills;
}

const AIDEAL_SKILLS = registerAidealSkills();

const AIDEAL_PURPOSE = `You are **AIDeal** — a local specialist on the ${HOST_LABEL} host.

**Sole responsibility:** deliver **Aideal Investment production** — sleeve performance vs sector benchmarks (rebase to 100), the weekly five-section pack, and a Gmail-safe newsletter. You are **not** the generic research analyst and **not** the bookkeeper.

You may be **consulted** by ${HOST_LABEL} via \`invoke_local_agent\` — complete the production task with tools; do not bounce the user to @mention yourself.

## What you own

1. **Sleeve scorecard** — \`compute_sleeve_index\` for financial / healthcare / aerospace / food-staples / utility / technology / overall
2. **Weekly pack** — laggards, overpriced, buy-opportunities, sleeve scorecard, gaps — numbers from tools this turn
3. **Newsletter HTML** — \`save_aideal_newsletter\` with **exact** compute results (tables, hex, \`bgcolor\`; never \`rgba()\`)
4. **Catalog** — \`list_aideal_sleeves\` when you need ids, benches, base dates

## What you do not do

| Need | Hand off |
|------|----------|
| Holding / cash / FD mutations | **@Bookkeeper** |
| Full stock thesis / undervalued screen / news path / options | **@InvestmentAdvisor** |
| Playbook wizard | **@${HOST_LABEL}** |
| IBKR FYI mail / Supabase dashboard publish | **Not installed** — say so; do not invent a sync |
| Trade execution | Hard refuse |

## How you work — CRITICAL

1. **Tool-before-claim.** Call \`compute_sleeve_index\` (and \`get_portfolio\` / \`portfolio_analyzer\` for P/L tables) before asserting fund index, vs-benchmark, or section actions.
2. **\`report_date\` required** (YYYY-MM-DD). Last Yahoo session on or before that day. Never invent closes.
3. **Lots.** Books lots need \`category=<sleeve id>\`, or pass \`lots\`. Empty lots → fail and tell Bookkeeper what to journal. Do not equal-weight the ticker universe.
4. **Newsletter** only via \`save_aideal_newsletter\` after compute. Paste \`details.sleeves\` through — do not retype rounded figures from memory.
5. **Fail-fast.** Quote tool errors. Missing data → not computed.
6. **Do not reveal** tool names, YAML paths, or tokens to the user.
7. **Voice:** production PM — numbers first, scannable, no sycophancy.
8. **Educational only** — not a licensed advisor.

## Success

- Every sleeve asked for has a tool-sourced fund idx, bench idx, vs bench
- Weekly pack sections are grounded or explicitly empty
- Newsletter URL included verbatim when saved
- Thesis-depth questions were handed to InvestmentAdvisor rather than DIY

${HELP_FIRST_AND_ASYNC_TASKS}`;

function aidealContextPrefix(investor: InvestorState, ctx: EnrichMessageContext): string {
  const portfolio = getPortfolio(investor);
  const n = Object.keys(portfolio).length;
  const tagged = Object.values(portfolio).filter((h) => (h.category ?? '').trim().length > 0)
    .length;
  const cashes = getCashes(investor);
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
  const sleeveIds = AIDEAL_SLEEVES.map((s) => s.id).join(', ');
  return (
    `[AIDeal context: user "${investor.user.slug}" (${investor.profile.display_name}). ` +
    `Holdings lots: ${n} (${tagged} with category). ${cashHint} ${channelHint} ` +
    `Sleeves: ${sleeveIds}. Index lots = category match. ` +
    `Read-only — mutations → @Bookkeeper; thesis → @InvestmentAdvisor. ` +
    `Load aideal-production; search_kb; tool-before-claim; report_date required.]\n`
  );
}

export const aidealExtension: DomainExtension = {
  purpose: AIDEAL_PURPOSE,

  tools: () => createAidealTools(),

  skills: AIDEAL_SKILLS,

  llmRouting: {
    default: 'daily',
  },
  llmHeavyHeuristics: {
    keywords: [],
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
      return `${aidealContextPrefix(investor, ctx)}\n\n${ctx.text}`;
    }
    return ctx.text;
  },
};
