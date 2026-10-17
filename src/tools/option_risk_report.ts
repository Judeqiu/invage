import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { getWebRunContext, publishReportHtml, formatReportLinkMessage } from 'utarus';
import { analysisContext, normalizeRiskInputs, parseRiskRequest, readRiskMarketSnapshot, riskConfigured, riskEnabled } from '../risk/context.js';
import { riskRepository, startRiskQueue } from '../risk/service.js';
import { ENGINE_VERSION } from '../risk/types.js';
import { buildOptionRiskReport } from '../report/option-risk-template.js';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';

export function createOptionRiskReportTool(): AgentTool {
  return {
    name: 'create_option_risk_report', label: 'Create Risk & scenarios report',
    description: 'Generate a standalone Risk & scenarios HTML report using the dashboard risk engine and publish it to BinDrive for the Utarus sidebar. Use when asked for an option risk model/scenario report. Default horizon: 5 trading days, all accounts. To export a saved dashboard analysis or continue a pending calculation pass result_id. Pending is not a published report: call again with the returned result_id until complete. Always include the returned durable session URL verbatim in a Markdown link so the WebUI opens it in the sidebar. Never invent probabilities or unavailable results.',
    parameters: Type.Object({
      ...channelIdParams,
      result_id: Type.Optional(Type.String({ pattern: '^[0-9a-fA-F-]{36}$', description: 'Saved result ID, or job ID returned by a pending call.' })),
      horizon_trading_days: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(5), Type.Literal(21)])),
      account_ids: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { minItems: 1, maxItems: 50, uniqueItems: true })),
    }, { additionalProperties: false }),
    async execute(_id, raw, signal) {
      try {
        const p = raw as ChannelIds & { result_id?: string; horizon_trading_days?: 1 | 5 | 21; account_ids?: string[] };
        const web = getWebRunContext();
        if (web?.incognito) throw new Error('Risk reports require a registered, non-incognito conversation.');
        if (!riskEnabled() || !riskConfigured()) throw new Error('Risk analysis is disabled or not configured.');
        const trustedOwner = web?.userId;
        if (trustedOwner && (p.user_id && p.user_id !== trustedOwner || p.telegram_user_id != null || p.slack_user_id)) throw new Error('Use the authenticated user identity for risk reports.');
        const snapshot = await resolveInvestorFromChannel(trustedOwner ? { user_id: trustedOwner } : p);
        const owner = snapshot.state.user.id;
        let job;
        if (p.result_id) {
          if (p.account_ids || p.horizon_trading_days) throw new Error('A saved result fixes its own horizon and accounts. Pass only result_id and channel identity.');
          job = await riskRepository.get(owner, p.result_id);
          if (!job) throw new Error('Risk result not found.');
        } else {
          const request = parseRiskRequest({ analysisContextId: analysisContext(snapshot),
            accountScope: p.account_ids ? { kind: 'selected', accountIds: p.account_ids } : { kind: 'all', accountIds: [] },
            horizonTradingDays: p.horizon_trading_days ?? 5, scenarioSet: 'equity-options-standard-v1', mode: 'conditional', refresh: false });
          const inputs = normalizeRiskInputs(snapshot, request, await readRiskMarketSnapshot(owner));
          if (!inputs.coverage.totalContracts) throw new Error('No option positions in the selected accounts.');
          inputs.collectMarketData = true;
          job = await riskRepository.enqueue(owner, request, inputs);
        }
        startRiskQueue();
        // Bound each tool call; the existing leased queue continues independently.
        const deadline = Date.now() + 10_000;
        while (['queued', 'running'].includes(job.status) && Date.now() < deadline && !signal?.aborted) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          job = await riskRepository.get(owner, job.id) ?? job;
        }
        if (signal?.aborted) throw new Error('Report request interrupted. The queued calculation may continue.');
        if (job.status === 'queued' || job.status === 'running') {
          return { content: [{ type: 'text', text: `Risk calculation ${job.status}. Call create_option_risk_report again with result_id="${job.id}" to finish publishing. No report link exists yet.` }], details: { status: job.status, result_id: job.id } };
        }
        if (!job.result || job.status !== 'complete') throw new Error(job.error || `Risk calculation ${job.status}. Request a new analysis to retry.`);
        if (!riskEnabled()) throw new Error('Risk analysis is disabled.');
        if (job.result.model.version !== ENGINE_VERSION) throw new Error('Saved model version unsupported. Request a new analysis.');
        const result = await publishReportHtml({ ownerUserId: owner, filename: `risk-scenarios-${job.id}.html`,
          html: buildOptionRiskReport(job.result, snapshot.state.profile.display_name, String(snapshot.revision)), displayName: snapshot.state.profile.display_name });
        return { content: [{ type: 'text', text: `Risk & scenarios report published (${job.result.status}).\n${formatReportLinkMessage(result)}\nInclude the session URL verbatim in a Markdown link titled Risk & scenarios report.` }],
          details: { ...result, status: 'published', result_id: job.id, analysisStatus: job.result.status } };
      } catch (e) {
        return { content: [{ type: 'text', text: e instanceof Error ? e.message : 'Risk report unavailable' }], details: null };
      }
    },
  };
}
