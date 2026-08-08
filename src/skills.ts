/**
 * Invage domain skills — registered with Utarus via registerDomainSkill().
 *
 * utarus ≥ 1.17: skills are selected by description/intent only — no keywords field.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { registerDomainSkill, type Skill } from 'utarus';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KNOWLEDGE_DIR = resolve(__dirname, 'skills/knowledge');

interface RawSkill {
  id: string;
  name: string;
  description: string;
}

const CATALOG: RawSkill[] = [
  {
    id: 'investment-analysis',
    name: 'Investment Analysis',
    description:
      'Investment research methods for DIY light analysis: portfolio 3-axis, single-name evaluation, idea discovery (cheap ∩ quality ∩ trap), news→price-path, index-relative context, multi-market equities (US/HK/CN suffixes), options structure, valuation multiples, buy/sell/hold framing. Load by capability fit — not keyword matching. Prefer invoke_local_agent Investment Expert for substantive research when coordinating as default host.',
  },
  {
    id: 'bindrive',
    name: 'BinDrive',
    description:
      'Load when saving or sharing portfolio reports, listing BinDrive files, or when the user asks about their file portal. Use owner_slug + user.auth_token with bindrive_* tools; prefer save_report for analysis HTML.',
  },
  {
    id: 'playbook-setup',
    name: 'Playbook Setup Wizard',
    description:
      'Patient guided setup of the Investment Playbook. Load when the user wants to configure strategy, philosophy, risk, allocation, buy/sell rules, rebalancing, or watchlists; "set up my investment style", "help me choose risk", "walk me through settings", questionnaire, or change how recommendations work. One easy question at a time with clear explanations. Uses get_playbook / update_playbook.',
  },
  {
    id: 'family-treasury',
    name: 'Family Treasury & Projections',
    description:
      'Household books and deterministic financial projections. Load for family net worth (property + mortgage + cash + portfolio), recurring income/expense cash flows, 5-year cash flow, house affordability projection, scenario compare, projection assumptions, FX into reporting currency. Tools: get_household, set_treasury, property/liability/cash_flow CRUD, set_projection_assumptions, save_scenario, run_projection, compare_scenarios. For SG stamp duty, HDB comps, yield, ABSD on a buy: also load sg-real-estate-portfolio. Not for stock picking alone — use investment-analysis. Not multi-unit listing shopping.',
  },
  {
    id: 'sg-real-estate-portfolio',
    name: 'SG Real-Estate Portfolio',
    description:
      'Singapore real-estate as a household portfolio sleeve: HDB/private comps via property_intel, BSD/ABSD/SSD and cooling-measure framing (verify IRAS this turn), gross/net yield, cash-on-cash, equity/LTV, all-in buy cost, mark fairness vs comps, lease decay, total wealth allocation (physical RE equity vs portfolio vs REITs), hold/sell and second-property policy cost. Load for stamp duty, ABSD, HDB resale comps, property yield, is my home mark fair, property vs REIT allocation. For second-property / SG buy with duties+affordability: load TOGETHER with family-treasury. Not multi-unit listing shopping, shortlist UX, layout, or interior design. Not pure multi-year cash-flow alone.',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description:
      'Load for live web research, primary news sources, and market themes: Yahoo Finance (US/HK/China tickers), options chains, SEC EDGAR, HKEXnews, CNINFO/SSE/SZSE, IR, Reuters/CNBC, Finviz, Fed/PBOC/macro, earnings releases, and themes (AI, sectors). Also IRAS/HDB official pages for stamp duties (pair with sg-real-estate-portfolio). Pair with investment-analysis Part D for news→price-path, Part F multi-market, Part G options. Prefer portfolio_analyzer for quotes; Firecrawl for news/filings/guidance/options text.',
  },
];

function readContent(id: string): string {
  const filePath = join(KNOWLEDGE_DIR, `${id}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Skill knowledge file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

export function registerInvageSkills(): Skill[] {
  const skills: Skill[] = [];
  for (const raw of CATALOG) {
    const content = readContent(raw.id);
    registerDomainSkill(raw.id, content);
    skills.push({ ...raw, kind: 'knowledge' });
  }
  return skills;
}
