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
      'Core Invester analysis skill. Load for portfolio 3-axis (Laggards, Overpriced, Buy Opportunities), stock evaluation, undervalued discovery funnel (cheap ∩ quality ∩ trap gate), value traps, composite multiples (PE/PEG/P/B/ROE + EV/FCF via Firecrawl), Magic Formula/Piotroski-style checks, valuation (DCF/multiples), analyst targets, buy/sell/hold, fundamentals, moat/value/growth, "find undervalued stocks", or "analyze TICKER" / "what should I do with my stocks".',
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
    id: 'firecrawl',
    name: 'Firecrawl',
    description:
      'Load for live web research with finance sources: Yahoo Finance pages, SEC EDGAR, company IR, Reuters/CNBC, Finviz, Fed/macro. Use firecrawl tool (search/scrape). Prefer portfolio_analyzer for quotes/targets; Firecrawl for news/filings/guidance text.',
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
      'SEC',
      'EDGAR',
      'guidance',
      'filing',
      'yahoo',
      'finviz',
      'reuters',
      'macro',
      'fed',
      'investor relations',
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
