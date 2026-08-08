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

/** Default host skills — orchestration residuals only (no investment DIY skill). */
const CATALOG: RawSkill[] = [
  {
    id: 'bindrive',
    name: 'BinDrive',
    description:
      'Load when listing or managing the user file portal after specialists produce artifacts. Use owner_slug + user.auth_token with bindrive_* tools. Investment HTML reports are produced by Investment Expert via save_report — orchestrator does not run analysis reports.',
  },
  {
    id: 'playbook-setup',
    name: 'Playbook Setup Wizard',
    description:
      'Patient guided setup of the Investment Playbook (host-owned methodology config). Load by capability fit when the user intends to configure strategy, philosophy, risk, allocation, buy/sell rules, rebalancing, or watchlists. One easy question at a time. Uses get_playbook / update_playbook. Not keyword-matched.',
  },
  {
    id: 'family-treasury',
    name: 'Family Treasury & Projections',
    description:
      'Host residual: household books and deterministic projections (net worth path, cash flows, house affordability). Load by capability fit. Tools: get_household, set_treasury, property/liability/cash_flow CRUD, assumptions, scenarios, run_projection, compare_scenarios. Pair with sg-real-estate-portfolio for SG duties/comps. Not investment research — route that to Investment Expert. Not ledger journal — route to Bookkeeper.',
  },
  {
    id: 'sg-real-estate-portfolio',
    name: 'SG Real-Estate Portfolio',
    description:
      'Host residual: Singapore physical RE as a household sleeve — comps via property_intel, duties (verify IRAS this turn), yield/LTV, all-in buy cost, allocation vs REITs. Load by capability fit with family-treasury when affordability matters. Not multi-unit listing shopping. Not securities research (Investment Expert).',
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
