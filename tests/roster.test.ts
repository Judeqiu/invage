import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
  HOST_AGENT_ID,
  craftPeerIds,
  enabledPeerIds,
  hostNeverDoYourself,
  parseProductProfile,
  peerEnabled,
  redoTargetIds,
  specialistTableMarkdown,
} from '../src/agents/roster.js';
import { buildFrameworkAgentList } from '../src/agents/framework-agents.js';
import { buildHostPurpose } from '../src/extension.js';
import { chatEmptyStateFor } from '../src/webapp/invage-webui.js';
import { helpFirstAndAsyncTasks } from '../src/agents/help-first.js';

describe('INVAGE_PRODUCT_PROFILE roster', () => {
  it('fails fast on missing or unknown profile', () => {
    expect(() => parseProductProfile(undefined)).toThrow(/INVAGE_PRODUCT_PROFILE is required/);
    expect(() => parseProductProfile('')).toThrow(/INVAGE_PRODUCT_PROFILE is required/);
    expect(() => parseProductProfile('walletstreet')).toThrow(/Unknown INVAGE_PRODUCT_PROFILE/);
  });

  it('full profile keeps every specialist', () => {
    const ids = enabledPeerIds('full');
    expect(ids).toEqual([
      'bookkeeper',
      'financial-planner',
      'investment-advisor',
      'options-expert',
      'real-estate-expert',
      'aideal',
      'factchecker',
    ]);
  });

  it('consultant profile keeps only options craft and records peers', () => {
    const ids = enabledPeerIds('consultant');
    expect(ids).toEqual(['bookkeeper', 'options-expert', 'factchecker']);
    expect(peerEnabled('consultant', 'investment-advisor')).toBe(false);
    expect(peerEnabled('consultant', 'financial-planner')).toBe(false);
    expect(peerEnabled('consultant', 'aideal')).toBe(false);
    expect(peerEnabled('consultant', 'real-estate-expert')).toBe(false);
    expect(craftPeerIds('consultant')).toEqual([
      'bookkeeper',
      'options-expert',
    ]);
    expect(redoTargetIds('consultant')).toEqual([
      'bookkeeper',
      'options-expert',
      HOST_AGENT_ID,
    ]);
  });

  it('consultant framework list is host + remaining peers; default id stays invage', () => {
    const agents = buildFrameworkAgentList('consultant');
    expect(agents[0]).toMatchObject({ id: HOST_AGENT_ID });
    expect(agents.map((a) => a.id)).toEqual([
      'invage',
      'bookkeeper',
      'options-expert',
      'factchecker',
    ]);
    expect(agents.map((a) => a.label)).toContain('Bookkeeper');
    expect(agents.map((a) => a.label)).not.toContain('InvestmentAdvisor');
    expect(agents.map((a) => a.label)).toContain('Factchecker');
  });

  it('consultant host purpose orchestrates remaining peers only', () => {
    const purpose = buildHostPurpose('consultant');
    expect(purpose).toMatch(/coordinate/i);
    expect(purpose).toMatch(/invoke_local_agent/);
    expect(purpose).toMatch(/capability fit/i);
    expect(purpose).toMatch(/Bookkeeper/);
    expect(purpose).not.toMatch(/InvestmentAdvisor/);
    expect(purpose).toMatch(/OptionsExpert/);
    expect(purpose).toMatch(/Factchecker/);
    expect(purpose).toMatch(/always-last Factcheck/i);
    expect(purpose).not.toMatch(/\*\*FinancialPlanner\*\*/);
    expect(purpose).not.toMatch(/\*\*AIDeal\*\*/);
    expect(purpose).not.toMatch(/\*\*RealEstateExpert\*\*/);
    expect(purpose).not.toMatch(/Real Estate Expert/);
    expect(purpose).toMatch(/listed calls and puts/i);
    expect(purpose).not.toMatch(/run_projection|playbook-setup|family-treasury/);
    const table = specialistTableMarkdown('consultant');
    expect(table).toMatch(/bookkeeper/);
    expect(table).not.toMatch(/investment-advisor/);
    expect(table).not.toMatch(/financial-planner/);
    expect(table).not.toMatch(/aideal/);
    expect(hostNeverDoYourself('consultant')).not.toMatch(/→ \*\*FinancialPlanner\*\*/);
  });

  it('consultant help-first examples omit uninstalled specialists', () => {
    const text = helpFirstAndAsyncTasks('consultant');
    expect(text).not.toMatch(/investment-advisor/);
    expect(text).toMatch(/factchecker/);
    expect(text).not.toMatch(/Consult aideal/);
    expect(text).not.toMatch(/financial-planner/);
    expect(text).not.toMatch(/real-estate-expert/);
  });

  it('shows option shortcut cards on an empty Victor chat', () => {
    const empty = chatEmptyStateFor('consultant');
    const catalog = JSON.parse(readFileSync(new URL('../l10n/en.json', import.meta.url), 'utf8')) as Record<string, string>;
    expect(empty.startersVariant).toBe('cards');
    expect(empty.startersPlacement).toBe('above');
    expect(empty.starters?.map((starter) => starter.id)).toEqual([
      'review_options', 'explore_chain', 'covered_call', 'cash_secured_put', 'protective_put',
    ]);
    expect(empty.starters?.every((starter) => starter.message && starter.description)).toBe(true);
    for (const starter of empty.starters ?? []) {
      for (const field of ['label', 'description', 'message'] as const) {
        expect(catalog[`chat.empty.starter.${starter.id}.${field}`]).toBe(starter[field]);
      }
    }
    expect(JSON.stringify(empty)).not.toMatch(/household|undervalued|cash flow|Aideal/i);
  });
});
