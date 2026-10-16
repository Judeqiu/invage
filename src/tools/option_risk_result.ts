import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { getWebRunContext } from 'utarus';
import { ENGINE_VERSION } from '../risk/types.js';
import { riskEnabled, riskConfigured } from '../risk/context.js';
import { riskRepository } from '../risk/service.js';

/** No model-supplied owner UUID. The trusted web run binds this retrieval. */
export function createOptionRiskResultTool(): AgentTool {
  return {
    name: 'get_option_risk_result', label: 'Read saved option risk analysis',
    description: 'Retrieve a trusted immutable Section 01 risk result for the authenticated web user. State age, scope, assumptions and exclusions before numerical claims. Conditional scenarios carry no forecast probabilities. No trades or writes.',
    parameters: Type.Object({ result_id: Type.String({ minLength: 36, maxLength: 36 }) }, { additionalProperties: false }),
    async execute(_id, raw) {
      try {
        const ctx = getWebRunContext();
        if (!ctx?.userId || ctx.incognito) throw new Error('Risk results require a registered, non-incognito web conversation.');
        if (!riskEnabled() || !riskConfigured()) throw new Error('Risk results unavailable');
        const job = await riskRepository.get(ctx.userId, (raw as { result_id: string }).result_id);
        if (!job?.result || !riskEnabled()) throw new Error('Risk result not found');
        if (job.result.model.version !== ENGINE_VERSION) throw new Error('Saved model version unsupported. Recalculate.');
        const details = { result: job.result, stale: Date.now() - Date.parse(job.result.marketAsOf || job.result.generatedAt) > 900_000 };
        return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
      } catch (e) { return { content: [{ type: 'text' as const, text: e instanceof Error ? e.message : 'Risk result unavailable' }], details: null }; }
    },
  };
}
