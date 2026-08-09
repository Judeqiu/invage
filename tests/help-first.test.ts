import { describe, expect, it } from 'vitest';
import { HELP_FIRST_AND_ASYNC_TASKS } from '../src/agents/help-first.js';
import { invageExtension } from '../src/extension.js';
import { financialPlannerExtension } from '../src/agents/financial-planner.js';
import { bookkeeperExtension } from '../src/agents/bookkeeper.js';
import { investmentAdvisorExtension } from '../src/agents/investment-advisor.js';
import { realEstateExpertExtension } from '../src/agents/real-estate-expert.js';
import { factcheckerExtension } from '../src/agents/factchecker.js';

describe('HELP_FIRST_AND_ASYNC_TASKS shared contract', () => {
  it('defines help-first, create_task, and host task-runner instruction rules', () => {
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/Help-first/i);
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/create_task/);
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/invoke_local_agent/);
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/Invester/);
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/telegram/i);
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/do \*\*not\*\* lightly reject/i);
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/factchecker/i);
  });

  it('is embedded in craft agents and host (not full paste on Factchecker)', () => {
    for (const purpose of [
      invageExtension.purpose,
      bookkeeperExtension.purpose,
      financialPlannerExtension.purpose,
      investmentAdvisorExtension.purpose,
      realEstateExpertExtension.purpose,
    ]) {
      expect(purpose).toContain('create_task');
      expect(purpose).toMatch(/Help-first/i);
      expect(purpose).toMatch(/action plan/i);
    }
    // Factchecker uses tailored auditor help-first, not full shared block
    expect(factcheckerExtension.purpose).toMatch(/Auditor help-first/i);
    expect(factcheckerExtension.purpose).not.toContain(HELP_FIRST_AND_ASYNC_TASKS);
  });
});
