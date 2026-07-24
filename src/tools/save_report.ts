import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot, signedBinDriveViewUrl } from 'utarus';
import { equityKeys, fetchPrices, fetchTargets, runFullAnalysis } from '../market/index.js';
import { getPortfolio } from '../state/portfolio-state.js';
import { loadSnapshots } from '../state/snapshot.js';
import { buildAnalysisReport } from '../report/template.js';
import { buildDashboardModel, buildLivePositions } from '../report/dashboard-model.js';
import { buildDashboardReport } from '../report/dashboard-template.js';
import {
  channelIdParams,
  resolveInvestorFromChannel,
  type ChannelIds,
} from './channel.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}
function failFrom(error: unknown): AgentToolResult<null> {
  return fail(error instanceof Error ? error.message : String(error));
}

type ReportKind = 'analysis' | 'dashboard';

export function createSaveReportTool(): AgentTool {
  return {
    name: 'save_report',
    label: 'Save Report',
    description:
      "Generate a portfolio report and save it to the user's BinDrive folder. " +
      'kind="analysis" (default): 3-axis analysis HTML. kind="dashboard": value + P/L vs cost + snapshot history. ' +
      'Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({
      ...channelIdParams,
      kind: Type.Optional(
        Type.Union([Type.Literal('analysis'), Type.Literal('dashboard')], {
          description:
            'Report type. "analysis" = 3-axis targets report (default). "dashboard" = live value, P/L vs cost, and snapshot history.',
        }),
      ),
      name: Type.Optional(
        Type.String({
          description:
            'Custom filename. Defaults to report-YYYY-MM-DD.html or dashboard-YYYY-MM-DD.html by kind.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { kind?: ReportKind; name?: string };
      try {
        const kind: ReportKind = p.kind ?? 'analysis';
        if (kind !== 'analysis' && kind !== 'dashboard') {
          return fail(`Invalid kind "${String(p.kind)}". Use "analysis" or "dashboard".`);
        }

        const state = resolveInvestorFromChannel(p);
        const portfolio = getPortfolio(state);
        if (Object.keys(portfolio).length === 0) {
          return fail('No portfolio saved. Use add_holding to build a portfolio first.');
        }

        const eqKeys = equityKeys(portfolio);
        const userName = state.profile.display_name;
        const today = new Date().toISOString().slice(0, 10);
        let html: string;
        let defaultName: string;
        let positions: number;
        let historyNote = '';

        if (kind === 'dashboard') {
          const prices = eqKeys.length > 0 ? await fetchPrices(eqKeys) : {};
          const live = buildLivePositions(portfolio, prices);
          const snapshots = loadSnapshots(state.user.slug);
          const model = buildDashboardModel(live, snapshots);
          html = buildDashboardReport(model, userName);
          defaultName = `dashboard-${today}.html`;
          positions = live.positionCount;
          historyNote =
            snapshots.length < 2
              ? 'Snapshot history is thin — use save_snapshot periodically so period change and sparkline appear.'
              : `History: ${snapshots.length} snapshot(s).`;
        } else {
          const [prices, targets] =
            eqKeys.length > 0
              ? await Promise.all([fetchPrices(eqKeys), fetchTargets(eqKeys)])
              : [{}, {} as Awaited<ReturnType<typeof fetchTargets>>];
          const result = runFullAnalysis(portfolio, prices, targets);
          html = buildAnalysisReport(result, userName);
          defaultName = `report-${today}.html`;
          positions = result.fullAnalysis.length;
        }

        const fileName = p.name ?? defaultName;
        const driveDir = join(resolveDataRoot(), 'drive', state.user.slug);
        mkdirSync(driveDir, { recursive: true });
        writeFileSync(join(driveDir, fileName), html, 'utf-8');

        const signed = signedBinDriveViewUrl(state.user.slug, fileName, {
          displayName: userName,
        });
        const ttlMin = Math.round(signed.expiresInMs / 60000);

        const lines = [
          `${kind === 'dashboard' ? 'Dashboard' : 'Analysis report'} saved to BinDrive as "${fileName}".`,
          `Positions: ${positions}`,
          historyNote,
          `View: ${signed.url}`,
          `Opens without login for ~${ttlMin} minutes.`,
          '',
          'YOU MUST include the URL above verbatim in your reply to the user.',
        ].filter((line) => line !== '');

        return ok(lines.join('\n'), {
          slug: state.user.slug,
          fileName,
          kind,
          positions,
          viewUrl: signed.url,
        });
      } catch (e) {
        return failFrom(e);
      }
    },
  };
}
