import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot } from '../config.js';
import { resolveUserByTelegramUser } from '../state/index.js';
import {
  fetchPrices,
  fetchTargets,
  runFullAnalysis,
} from '../market/index.js';
import type { Holding } from '../market/index.js';
import { buildAnalysisReport } from '../report/template.js';

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
    description: 'Generate a portfolio analysis report and save it to the user\'s InvesterDrive folder. The report is an HTML file viewable in the browser. The telegram_user_id is always from the message context.',
    parameters: Type.Object({
      telegram_user_id: Type.Number({ description: 'Telegram user ID from the message context.' }),
      name: Type.Optional(Type.String({ description: 'Custom filename. Defaults to "report-YYYY-MM-DD.html".' })),
    }),
    async execute(_id, raw) {
      const { telegram_user_id, name } = raw as { telegram_user_id: number; name?: string };
      try {
        const state = resolveUserByTelegramUser(telegram_user_id);
        if (!state) return fail(`No user linked to Telegram ID ${telegram_user_id}.`);

        const portfolio = (state as unknown as { portfolio?: Record<string, Holding> }).portfolio;
        if (!portfolio || Object.keys(portfolio).length === 0) {
          return fail(`No portfolio saved. Use add_holding to build a portfolio first.`);
        }

        const tickers = Object.keys(portfolio);
        const [prices, targets] = await Promise.all([
          fetchPrices(tickers),
          fetchTargets(tickers),
        ]);

        const result = runFullAnalysis(portfolio, prices, targets);
        const userName = state.profile.display_name ?? state.user.slug;
        const html = buildAnalysisReport(result, userName);

        const fileName = name ?? `report-${new Date().toISOString().slice(0, 10)}.html`;
        const driveDir = join(resolveDataRoot(), 'drive', state.user.slug);
        mkdirSync(driveDir, { recursive: true });
        writeFileSync(join(driveDir, fileName), html, 'utf-8');

        return ok(
          `Report saved to InvesterDrive as "${fileName}". View at: http://localhost:3001/api/files/${encodeURIComponent(fileName)}/view?slug=${encodeURIComponent(state.user.slug)}`,
          { slug: state.user.slug, fileName, positions: result.fullAnalysis.length }
        );
      } catch (e) { return failFrom(e); }
    },
  };
}
