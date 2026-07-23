/**
 * Invage domain skills — registered with Utarus via registerDomainSkill().
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
  keywords: string[];
}

const CATALOG: RawSkill[] = [
  {
    id: 'investment-analysis',
    name: 'Investment Analysis',
    description:
      'Core Invester analysis skill. Load for portfolio 3-axis, stock evaluation, undervalued discovery (cheap ∩ quality ∩ trap), news→price-path / trend after news (PEAD, underreaction vs overreaction, earnings reaction), index-relative evaluation (SPY/QQQ/HSI/CSI 300/sector ETFs), multi-market equities (US, HK .HK, China A .SS/.SZ, dual-list/ADR), options calls/puts (structure, IV, hedges), value traps, multiples, valuation, buy/sell/hold, "why did TICKER move", "analyze TICKER", "find undervalued stocks".',
    keywords: [
      'portfolio',
      'stocks',
      'analysis',
      'investment',
      'P/E',
      'PEG',
      'ROE',
      'P/B',
      'targets',
      'buy',
      'sell',
      'hold',
      'laggards',
      'overpriced',
      'valuation',
      'DCF',
      'fundamental',
      'moat',
      'ticker',
      'undervalued',
      'overvalued',
      'value trap',
      'cheap',
      'screen',
      'Magic Formula',
      'Piotroski',
      'margin of safety',
      'FCF',
      'EV/EBIT',
      'discover',
      'find stocks',
      'news',
      'trend',
      'earnings',
      'PEAD',
      'guidance',
      'why did it move',
      'price impact',
      'reaction',
      'headline',
      'catalyst',
      'index',
      'indices',
      'benchmark',
      'SPY',
      'QQQ',
      'HSI',
      'Hang Seng',
      'CSI 300',
      'relative performance',
      'Hong Kong',
      'HK',
      'China',
      'A-share',
      'H-share',
      'A-shares',
      'dual listing',
      'AH premium',
      'ADR',
      'options',
      'option',
      'call',
      'put',
      'calls',
      'puts',
      'implied volatility',
      'IV',
      'strike',
      'expiry',
      'covered call',
      'protective put',
      'Greeks',
      'delta',
    ],
  },
  {
    id: 'bindrive',
    name: 'BinDrive',
    description:
      'Load when saving or sharing portfolio reports, listing BinDrive files, or when the user asks about their file portal. Use owner_slug + user.auth_token with bindrive_* tools; prefer save_report for analysis HTML.',
    keywords: ['bindrive', 'drive', 'files', 'reports', 'upload', 'download', 'portal'],
  },
  {
    id: 'playbook-setup',
    name: 'Playbook Setup Wizard',
    description:
      'Patient guided setup of the Investment Playbook. Load when the user wants to configure strategy, philosophy, risk, allocation, buy/sell rules, rebalancing, or watchlists; "set up my investment style", "help me choose risk", "walk me through settings", questionnaire, or change how recommendations work. One easy question at a time with clear explanations. Uses get_playbook / update_playbook.',
    keywords: [
      'playbook',
      'setup',
      'configure',
      'settings',
      'preferences',
      'questionnaire',
      'wizard',
      'strategy',
      'philosophy',
      'risk profile',
      'risk tolerance',
      'conservative',
      'aggressive',
      'balanced',
      'value investing',
      'growth investing',
      'dividend investing',
      'allocation',
      'position limit',
      'rebalance',
      'rebalancing',
      'watchlist',
      'investment style',
      'methodology',
      'customize',
      'personalize',
      'how should you advise me',
      'set my risk',
      'change my playbook',
      'defaults',
      'onboarding investment',
    ],
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description:
      'Load for live web research, primary news sources, and market themes: Yahoo Finance (US/HK/China tickers), options chains, SEC EDGAR, HKEXnews, CNINFO/SSE/SZSE, IR, Reuters/CNBC, Finviz, Fed/PBOC/macro, earnings releases, and themes (AI, sectors). Pair with investment-analysis Part D for news→price-path, Part F multi-market, Part G options. Prefer portfolio_analyzer for quotes; Firecrawl for news/filings/guidance/options text.',
    keywords: [
      'web',
      'search',
      'scrape',
      'news',
      'research',
      'firecrawl',
      'browse',
      'url',
      'article',
      'earnings',
      '10-K',
      '10-Q',
      '8-K',
      'SEC',
      'EDGAR',
      'HKEX',
      'HKEXnews',
      'CNINFO',
      'SSE',
      'SZSE',
      'guidance',
      'filing',
      'yahoo',
      'finviz',
      'reuters',
      'macro',
      'fed',
      'PBOC',
      'investor relations',
      'theme',
      'sector',
      'outlook',
      'AI',
      'market impact',
      'stock market',
      'Hong Kong',
      'China',
      'A-share',
      'options chain',
      'implied volatility',
      'geopolitics',
      'rates',
      'inflation',
      'press release',
      'headline',
      'catalyst',
      'why did it move',
    ],
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
