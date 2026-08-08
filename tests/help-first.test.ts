import { describe, expect, it } from 'vitest';
import { HELP_FIRST_AND_ASYNC_TASKS } from '../src/agents/help-first.js';
import { invageExtension } from '../src/extension.js';
import { accountantExtension } from '../src/agents/accountant.js';
import { bookkeeperExtension } from '../src/agents/bookkeeper.js';
import { investmentExpertExtension } from '../src/agents/investment-expert.js';
import { realEstateExpertExtension } from '../src/agents/real-estate-expert.js';

describe('HELP_FIRST_AND_ASYNC_TASKS shared contract', () => {
  it('defines help-first, create_task, and host task-runner instruction rules', () => {
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/Help-first/i);
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/create_task/);
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/invoke_local_agent/);
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/Invester/);
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/telegram/i);
    expect(HELP_FIRST_AND_ASYNC_TASKS).toMatch(/do \*\*not\*\* lightly reject/i);
  });

  it('is embedded in every local agent purpose', () => {
    for (const purpose of [
      invageExtension.purpose,
      bookkeeperExtension.purpose,
      accountantExtension.purpose,
      investmentExpertExtension.purpose,
      realEstateExpertExtension.purpose,
    ]) {
      expect(purpose).toContain('create_task');
      expect(purpose).toMatch(/Help-first/i);
      expect(purpose).toMatch(/action plan/i);
    }
  });
});
