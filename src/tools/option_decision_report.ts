import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { getWebRunContext } from 'utarus';
import { ABOVE_STRIKE_PERCENT, CALL_STRIKE_BAND_PERCENT } from '../premarket/decisions.js';
import { runOnDemandOptionReport, type ManualReportResult } from '../premarket/on-demand.js';

function reportLink(result: ManualReportResult) {
  const { confirmed, unverified, incomplete } = result.coverage;
  const outcome = confirmed || unverified
    ? `${confirmed} confirmed matches. ${unverified} positions to verify.`
    : incomplete ? 'The available evidence could not establish whether any positions matched.'
      : 'No positions matched in the available broker snapshots.';
  return [
    `[Open options decision report in Notes](${result.href})`,
    `Scanned short American options expiring from ${result.session.date} through ${result.session.windowEnd} (U.S. dates). Puts qualify up to ${ABOVE_STRIKE_PERCENT}% above strike. Calls qualify within ${CALL_STRIKE_BAND_PERCENT}% on either side of strike.`,
    outcome,
    incomplete ? 'The note identifies the missing or stale evidence.' : '',
    result.notified ? '' : 'The note is available. Notification delivery could not be verified.',
  ].filter(Boolean).join('\n\n');
}

export function createOptionDecisionReportTool(generate = runOnDemandOptionReport) {
  return {
    name: 'generate_option_decision_report',
    label: 'Generate options decision report',
    description: 'Run the Velovest options decision scan now and save the full report to the authenticated user’s private Notes. Use when the user explicitly requests to generate or run their options decision report, including an on-demand run of the daily premarket decision report. The automatic scan setting and the exchange schedule do not control this action. The scan reviews open short puts and urgent short calls. Return the exact Notes link from the completed tool result.',
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _args): Promise<AgentToolResult<ManualReportResult | null>> {
      const ctx = getWebRunContext();
      if (!ctx?.userId || ctx.incognito) {
        return { content: [{ type: 'text', text: 'Open a signed-in, regular Velovest chat to save an options decision report to Notes.' }], details: null };
      }
      try {
        const result = await generate({ userId: ctx.userId, conversationId: ctx.conversationId,
          requestId: ctx.humanInput?.messageId ?? ctx.messageId });
        return { content: [{ type: 'text', text: reportLink(result) }], details: result };
      } catch (error) {
        console.error('[premarket/manual] Could not finish report', error);
        return { content: [{ type: 'text', text: 'The options decision report could not be saved and verified in Notes.' }], details: null };
      }
    },
    renderReceipt(result: AgentToolResult<ManualReportResult | null>) {
      return result.content.find(part => part.type === 'text')?.text;
    },
  } satisfies AgentTool & { renderReceipt(result: AgentToolResult<ManualReportResult | null>): string | undefined };
}
