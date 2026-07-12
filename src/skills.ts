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
      'Load when the user asks about portfolio analysis, stock evaluation, investment recommendations, P/E ratios, analyst targets, buy/sell decisions, or portfolio performance. Covers the 3-axis framework (Laggards, Overpriced, Buy Opportunities) and financial metrics interpretation.',
    keywords: [
      'portfolio',
      'stocks',
      'analysis',
      'investment',
      'P/E',
      'targets',
      'buy',
      'sell',
      'laggards',
      'overpriced',
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
      'Load when you need live web search or page scrape — news, company research, filings, competitor pages. Use the firecrawl tool (action: search | scrape). Not for portfolio cost basis (use portfolio tools).',
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
