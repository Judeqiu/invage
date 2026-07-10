import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot, signedBinDriveViewUrl } from 'utarus';
import { fetchPrices, fetchTargets, runFullAnalysis } from '../market/index.js';
import { getPortfolio } from '../state/portfolio-state.js';
import { buildAnalysisReport } from '../report/template.js';
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

export function createSaveReportTool(): AgentTool {
  return {
    name: 'save_report',
    label: 'Save Report',
    description:
      "Generate a portfolio analysis report and save it to the user's BinDrive folder. Pass telegram_user_id or slack_user_id from the message context.",
    parameters: Type.Object({
      ...channelIdParams,
      name: Type.Optional(
        Type.String({ description: 'Custom filename. Defaults to "report-YYYY-MM-DD.html".' }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { name?: string };
      try {
        const state = resolveInvestorFromChannel(p);

        const portfolio = getPortfolio(state);
        if (Object.keys(portfolio).length === 0) {
          return fail('No portfolio saved. Use add_holding to build a portfolio first.');
        }

        const tickers = Object.keys(portfolio);
        const [prices, targets] = await Promise.all([fetchPrices(tickers), fetchTargets(tickers)]);

        const result = runFullAnalysis(portfolio, prices, targets);
        const userName = state.profile.display_name;
        const html = buildAnalysisReport(result, userName);

        const fileName = p.name ?? `report-${new Date().toISOString().slice(0, 10)}.html`;
        const driveDir = join(resolveDataRoot(), 'drive', state.user.slug);
        mkdirSync(driveDir, { recursive: true });
        writeFileSync(join(driveDir, fileName), html, 'utf-8');

        const signed = signedBinDriveViewUrl(state.user.slug, fileName, {
          displayName: userName,
        });
        const ttlMin = Math.round(signed.expiresInMs / 60000);

        return ok(
          [
            `Report saved to BinDrive as "${fileName}".`,
            `Positions: ${result.fullAnalysis.length}`,
            `View: ${signed.url}`,
            `Opens without login for ~${ttlMin} minutes.`,
            '',
            'YOU MUST include the URL above verbatim in your reply to the user.',
          ].join('\n'),
          {
            slug: state.user.slug,
            fileName,
            positions: result.fullAnalysis.length,
            viewUrl: signed.url,
          },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };
}
