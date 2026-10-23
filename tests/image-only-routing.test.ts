import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invageExtension } from '../src/extension.js';
import { aidealExtension } from '../src/agents/aideal.js';
import { bookkeeperExtension } from '../src/agents/bookkeeper.js';
import { factcheckerExtension } from '../src/agents/factchecker.js';
import { financialPlannerExtension } from '../src/agents/financial-planner.js';
import { investmentAdvisorExtension } from '../src/agents/investment-advisor.js';
import { optionsExpertExtension } from '../src/agents/options-expert.js';
import { realEstateExpertExtension } from '../src/agents/real-estate-expert.js';
import { resetLlmStackForTests } from '../node_modules/utarus/dist/llm/profiles.js';
import { resolveLlmRouteStrategyForAgent } from '../node_modules/utarus/dist/llm/apply-route.js';
import { selectLlmProfileForTurn } from '../node_modules/utarus/dist/llm/routing.js';
import { applyWorkflowWorkerLlm } from '../node_modules/utarus/dist/llm/workflow-route.js';

const extensions = { host: invageExtension, aideal: aidealExtension, bookkeeper: bookkeeperExtension,
  factchecker: factcheckerExtension, financialPlanner: financialPlannerExtension,
  investmentAdvisor: investmentAdvisorExtension, optionsExpert: optionsExpertExtension,
  realEstateExpert: realEstateExpertExtension };

describe('K3 image-only policy with legacy production heavy configuration', () => {
  beforeEach(() => {
    vi.stubEnv('UTARUS_LLM_PROFILES', JSON.stringify({ daily: { provider: 'deepseek' },
      vision: { provider: 'kimi', model: 'k3' }, heavy: { provider: 'kimi', model: 'k3' } }));
    vi.stubEnv('UTARUS_LLM_ROUTING', JSON.stringify({ default: 'daily', has_images: 'vision', utility: 'daily', heavy: 'heavy' }));
    vi.stubEnv('UTARUS_LLM_ROUTING_BY_AGENT', '');
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-only');
    vi.stubEnv('KIMI_API_KEY', 'test-only');
    vi.stubEnv('UTARUS_LLM_ROUTE_HEAVY_MIN_CHARS', '4000');
    vi.stubEnv('UTARUS_LLM_ROUTE_HEAVY_KEYWORDS', 'deep dive');
    resetLlmStackForTests();
  });
  afterEach(() => { vi.unstubAllEnvs(); resetLlmStackForTests(); });

  it.each(Object.entries(extensions))('%s keeps long and classified heavy text on DeepSeek but images on K3', (agentId, extension) => {
    const strategy = resolveLlmRouteStrategyForAgent({ agentId, extension });
    const base = { ...strategy, text: 'deep dive '.repeat(600), userId: 'test', isAdmin: false,
      channel: 'web' as const, agentId };
    for (const classifiedSlot of [undefined, 'heavy'] as const) {
      const text = selectLlmProfileForTurn({ ...base, hasImages: false, classifiedSlot });
      expect(text.resolved.model.id).toBe('deepseek-v4-flash');
    }
    const image = selectLlmProfileForTurn({ ...base, hasImages: true });
    expect(image.reason).toBe('has_images');
    expect(image.resolved.model.id).toBe('k3');
  });

  it.each(['default', 'heavy', 'utility'] as const)('workflow %s workers use DeepSeek', async llmProfile => {
    const result = await applyWorkflowWorkerLlm({ ownerAgentId: 'invage', extension: invageExtension,
      userId: 'test', llmProfile, agent: { state: {} } as never });
    expect(result.decision.resolved.model.id).toBe('deepseek-v4-flash');
  });
});
