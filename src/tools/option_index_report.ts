import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { getWebRunContext, publishReportHtml, formatReportLinkMessage } from 'utarus';
import { randomUUID } from 'node:crypto';
import { getPortfolio } from '../state/portfolio-state.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import { createOptionIndexBatchDependencies, generateOptionIndex, type IndexDependencies } from '../risk/option-index.js';
import { buildOptionIndexReport, type OptionIndexReportRow } from '../report/option-index-template.js';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';

/** Resolve only the authenticated portfolio, reuse public quotes and retain every unsupported lot. */
export function createOptionIndexReportTool(options: {
  resolve?: typeof resolveInvestorFromChannel; publish?: typeof publishReportHtml;
  context?: typeof getWebRunContext; batch?: () => IndexDependencies;
} = {}): AgentTool {
  return {
    name: 'create_option_index_report', label: 'Create options risk-index report',
    description: 'Automatically score all recorded open option positions and publish a standalone HTML report to the owner’s BinDrive/sidebar. Use for the Options risk-index report preset. No manual price/IV/rate/equity inputs. Includes recorded sides/quantities, contract-normalized indexes, standalone stress losses, unbounded exposure, dated source evidence and all unavailable rows. Does not sum indexes or model portfolio offsets. Available even when the optional index page is hidden. Return the durable session URL verbatim as a Markdown link. No holdings changes or trades.',
    parameters: Type.Object({ ...channelIdParams }, { additionalProperties: false }),
    async execute(_id, raw, signal, onUpdate) {
      try {
        const web = (options.context ?? getWebRunContext)(), p = raw as ChannelIds;
        if (web?.incognito) throw new Error('A registered, non-incognito account is required to save a report.');
        if (web?.userId && (p.user_id && p.user_id !== web.userId || p.telegram_user_id != null || p.slack_user_id))
          throw new Error('Use the authenticated account identity for reports.');
        const snapshot = await (options.resolve ?? resolveInvestorFromChannel)(web?.userId ? { user_id: web.userId } : p);
        const entries = Object.entries(getPortfolio(snapshot.state)).filter(([, h]) => h.instrument === 'option' && h.option && h.units !== 0);
        if (!entries.length) throw new Error('No recorded open option positions. Give an exact contract to get_option_risk_index for a single-option score.');
        const rows: OptionIndexReportRow[] = entries.map(([id, h]) => {
          const o = h.option!;
          const row: OptionIndexReportRow = { id, account: h.channel || 'default', quantity: h.units,
            side: o.side, contract: `${o.underlying} ${o.expiry} ${o.strike} ${o.right.toUpperCase()}`, result: null, error: null };
          if (h.currency !== 'USD' || o.multiplier !== 100 || o.settlement !== 'physical' || !['long', 'short'].includes(o.side) ||
              !Number.isSafeInteger(h.units) || h.units <= 0 || h.units > 1_000_000)
            row.error = 'Unsupported contract, currency, settlement or recorded quantity; only standard USD 100-share options are scored.';
          else try { row.contract = `${canonicalOptionUnderlying(o.underlying, o)} ${o.expiry} ${o.strike} ${o.right.toUpperCase()}`; }
          catch { row.error = 'Recorded contract identity is inconsistent.'; }
          return row;
        });
        const dependencies = (options.batch ?? createOptionIndexBatchDependencies)();
        const unique = [...new Set(rows.filter(r => !r.error).map(r => r.contract))];
        let next = 0, completed = 0;
        await Promise.all(Array.from({ length: Math.min(3, unique.length) }, async () => {
          for (;;) {
            signal?.throwIfAborted(); const i = next++; if (i >= unique.length) return;
            const contract = unique[i];
            try {
              const result = await generateOptionIndex({ contract }, dependencies, signal);
              rows.filter(r => !r.error && r.contract === contract).forEach(r => { r.result = result; });
            } catch (e) {
              if (signal?.aborted) throw e;
              rows.filter(r => !r.error && r.contract === contract).forEach(r => { r.error = e instanceof Error ? e.message : 'Market data unavailable; no score calculated.'; });
            }
            completed++;
            onUpdate?.({ content: [{ type: 'text', text: `Checked ${completed}/${unique.length} unique option contracts.` }], details: { completed, total: unique.length } });
          }
        }));
        signal?.throwIfAborted();
        const report = await (options.publish ?? publishReportHtml)({ ownerUserId: snapshot.state.user.id,
          filename: `option-risk-indexes-${randomUUID()}.html`, html: buildOptionIndexReport(rows), displayName: 'Options risk-index report' });
        const scored = rows.filter(r => r.result).length;
        return { content: [{ type: 'text', text: `Options risk-index report published: ${scored}/${rows.length} lots scored; ${rows.length - scored} unavailable rows included.\n${formatReportLinkMessage(report)}\nInclude the durable session URL verbatim in a Markdown link titled Options risk-index report.` }],
          details: { ...report, status: 'published', totalLots: rows.length, scoredLots: scored, unavailableLots: rows.length - scored } };
      } catch (e) { return { content: [{ type: 'text', text: e instanceof Error ? e.message : 'Option index report unavailable.' }], details: null }; }
    },
  };
}
