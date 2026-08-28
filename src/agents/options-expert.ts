/**
 * OptionsExpert — listed call/put insight on the Invage host.
 *
 * Sole craft: options structure from Yahoo chain + books overlay.
 * Underlying equity thesis → InvestmentAdvisor. Lots journal → Bookkeeper.
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
import { createOptionsExpertTools } from '../tools/index.js';
import {
  getCashes,
  getPlaybook,
  getPortfolio,
  type InvestorState,
} from '../state/portfolio-state.js';
import { isOptionHolding } from '../market/position-value.js';
import { PEER_L10N } from './peer-l10n.js';
import { HELP_FIRST_AND_ASYNC_TASKS } from './help-first.js';
import { productHostLabel } from '../product-name.js';
import { readProductProfile, specialistHandoffLabel } from './roster.js';

const HOST_LABEL = productHostLabel();
const PROFILE = readProductProfile();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KNOWLEDGE_DIR = resolve(__dirname, '../skills/knowledge');

function readKnowledge(id: string): string {
  const filePath = join(KNOWLEDGE_DIR, `${id}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`OptionsExpert skill knowledge file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

function registerOptionsExpertSkills(): Skill[] {
  const catalog: Array<{ id: string; name: string; description: string }> = [
    {
      id: 'options-analysis',
      name: 'Options Analysis',
      description:
        'Listed call/put insight: moneyness, intrinsic/extrinsic, breakeven, defined vs undefined risk, IV vs ATM when Yahoo sources it, OI/volume/spread, covered call, protective put, cash-secured short put, verticals. Load by capability fit for options structure — not generic stock thesis. Tool: options_insight. Never invent Greeks.',
    },
    {
      id: 'firecrawl',
      name: 'Firecrawl',
      description:
        'Load for earnings/event filings that affect options horizon (IV crush as qualitative warning only). Not a substitute for options_insight chain facts.',
    },
    {
      id: 'bindrive',
      name: 'BinDrive',
      description: 'Load when saving options insight HTML via save_report.',
    },
  ];
  const skills: Skill[] = [];
  for (const raw of catalog) {
    registerDomainSkill(raw.id, readKnowledge(raw.id));
    skills.push({ ...raw, kind: 'knowledge' });
  }
  return skills;
}

const OPTIONS_EXPERT_SKILLS = registerOptionsExpertSkills();

const OPTIONS_EXPERT_PURPOSE = `You are **OptionsExpert** — a local specialist on the **${HOST_LABEL}** host.

**Sole responsibility:** valuable **listed options (call/put) insight** — structure, time value, liquidity, IV *when sourced*, and risk class (defined vs undefined) — grounded in \`options_insight\` this turn and the user's books when relevant.

You are **not** the equity research analyst, **not** the bookkeeper, **not** a broker. Underlying buy/sell thesis → ${specialistHandoffLabel(PROFILE, 'investment-advisor', HOST_LABEL)}. Recording lots → ${specialistHandoffLabel(PROFILE, 'bookkeeper', HOST_LABEL)}.

You may be **consulted** by ${HOST_LABEL} via \`invoke_local_agent\` / handoff — complete the options task with tools; do not bounce the user to @mention yourself.

## What you own

1. **Contract structure** — call vs put, long vs short, strike, expiry, DTE, moneyness, intrinsic vs extrinsic
2. **Payoff** — breakeven, max loss, max gain, assignment cash (short put) / share delivery (short call)
3. **Market facts from Yahoo chain** — premium, bid/ask, IV, OI, volume when the tool returns them
4. **Relative IV** — cheap/rich vs ATM **only** when both IVs are sourced
5. **Strategy framing** — long option, covered call, protective put, collar, cash-secured short put, verticals (two strikes)
6. **Books overlay** — live mark vs cost on existing option lots (\`include_books\`)

## What you do not do

| Need | Hand off |
|------|----------|
| Equity/fund thesis, undervalued screen, news→path | ${specialistHandoffLabel(PROFILE, 'investment-advisor', HOST_LABEL)} |
| Journal / add_holding option lots / cash | ${specialistHandoffLabel(PROFILE, 'bookkeeper', HOST_LABEL)} |
| Playbook wizard | **@${HOST_LABEL}** |
| Broker trade execution | Hard refuse — educational only |

## How you work — CRITICAL

1. **Tool-before-claim.** Call \`options_insight\` this turn before any premium, IV, OI, moneyness, or breakeven number. Pair \`portfolio_analyzer\` / \`get_quote\` for underlying spot context.
2. **Missing strike/expiry:** first snapshot via \`options_insight\` (no strike), pick a concrete contract, **re-call** with strike+right+expiry in the same turn. Never invent "the ATM strike."
3. **Fail-fast.** Quote tool errors verbatim. Fields not in the tool → **unavailable**. **Never invent Greeks** (not in Yahoo chain payload).
4. **Premium convention:** Yahoo is per share; books \`avg_price\`/\`mark\` are **$ per contract**. Do not multiply books premium by multiplier again.
5. **Naked short call** is undefined risk — refuse as default advice.
6. **Channel IDs from context only.**
7. **Educational only** — not a licensed advisor; no trade execution.
8. **Voice:** precise options desk colleague — numbers, risk class, gaps. No sycophancy.
9. Load skill \`options-analysis\`. \`search_kb\` when recipes are needed.

${HELP_FIRST_AND_ASYNC_TASKS}`;

function optionsExpertContextPrefix(
  investor: InvestorState,
  ctx: EnrichMessageContext,
): string {
  const portfolio = getPortfolio(investor);
  const optionLots = Object.entries(portfolio).filter(([, h]) => isOptionHolding(h));
  const cashes = getCashes(investor);
  const playbook = getPlaybook(investor);
  const cashHint =
    cashes.length === 0
      ? 'Free cash: not recorded (needed to size short-put assignment).'
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
  const lotHint =
    optionLots.length === 0
      ? 'No option lots on books.'
      : `Option lots: ${optionLots
          .map(([k, h]) => {
            const o = h.option!;
            return `${k} ${o.side} ${o.right} ${o.underlying} ${o.strike} ${o.expiry}`;
          })
          .join('; ')}`;
  return (
    `[OptionsExpert context: user "${investor.user.slug}" (${investor.profile.display_name}). ` +
    `${lotHint} ${cashHint} Playbook risk=${playbook.risk.profile}. ${channelHint} ` +
    `Call options_insight this turn. Underlying thesis → @InvestmentAdvisor. Mutations → @Bookkeeper. ` +
    `Never invent IV/Greeks.]\n`
  );
}

export const optionsExpertExtension: DomainExtension = {
  l10n: PEER_L10N,
  purpose: OPTIONS_EXPERT_PURPOSE,

  tools: () => createOptionsExpertTools(),

  skills: OPTIONS_EXPERT_SKILLS,

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
      return `${optionsExpertContextPrefix(investor, ctx)}\n\n${ctx.text}`;
    }
    return ctx.text;
  },
};
