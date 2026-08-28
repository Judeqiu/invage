import { describe, expect, it } from 'vitest';
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

  it('consultant profile drops FinancialPlanner, AIDeal, and RealEstateExpert', () => {
    const ids = enabledPeerIds('consultant');
    expect(ids).toEqual(['bookkeeper', 'investment-advisor', 'options-expert', 'factchecker']);
    expect(peerEnabled('consultant', 'financial-planner')).toBe(false);
    expect(peerEnabled('consultant', 'aideal')).toBe(false);
    expect(peerEnabled('consultant', 'real-estate-expert')).toBe(false);
    expect(craftPeerIds('consultant')).toEqual([
      'bookkeeper',
      'investment-advisor',
      'options-expert',
    ]);
    expect(redoTargetIds('consultant')).toEqual([
      'bookkeeper',
      'investment-advisor',
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
      'investment-advisor',
      'options-expert',
      'factchecker',
    ]);
    expect(agents.map((a) => a.label)).toContain('Bookkeeper');
    expect(agents.map((a) => a.label)).toContain('InvestmentAdvisor');
    expect(agents.map((a) => a.label)).toContain('Factchecker');
  });

  it('consultant host purpose orchestrates remaining peers only', () => {
    const purpose = buildHostPurpose('consultant');
    expect(purpose).toMatch(/orchestrat/i);
    expect(purpose).toMatch(/invoke_local_agent/);
    expect(purpose).toMatch(/capability fit/i);
    expect(purpose).toMatch(/Bookkeeper/);
    expect(purpose).toMatch(/InvestmentAdvisor/);
    expect(purpose).toMatch(/OptionsExpert/);
    expect(purpose).toMatch(/Factchecker/);
    expect(purpose).toMatch(/always-last Factcheck/i);
    expect(purpose).not.toMatch(/\*\*FinancialPlanner\*\*/);
    expect(purpose).not.toMatch(/\*\*AIDeal\*\*/);
    expect(purpose).not.toMatch(/\*\*RealEstateExpert\*\*/);
    expect(purpose).not.toMatch(/Real Estate Expert/);
    expect(purpose).toMatch(/Not installed on this product/);
    const table = specialistTableMarkdown('consultant');
    expect(table).toMatch(/bookkeeper/);
    expect(table).toMatch(/investment-advisor/);
    expect(table).not.toMatch(/financial-planner/);
    expect(table).not.toMatch(/aideal/);
    expect(hostNeverDoYourself('consultant')).not.toMatch(/→ \*\*FinancialPlanner\*\*/);
  });

  it('consultant help-first examples omit uninstalled specialists', () => {
    const text = helpFirstAndAsyncTasks('consultant');
    expect(text).toMatch(/investment-advisor/);
    expect(text).toMatch(/factchecker/);
    expect(text).not.toMatch(/Consult aideal/);
    expect(text).not.toMatch(/financial-planner/);
    expect(text).not.toMatch(/real-estate-expert/);
  });
});
