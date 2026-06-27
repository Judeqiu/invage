import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  fetchPrices,
  fetchTargets,
  fetchMetrics,
  runFullAnalysis,
} from '../market/index.js';
import type { Holding } from '../market/index.js';
import { resolveUserByTelegramUser } from '../state/index.js';
import { buildAnalysisReport } from '../report/template.js';

const execFileAsync = promisify(execFile);

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}
function failFrom(error: unknown): AgentToolResult<null> {
  return fail(error instanceof Error ? error.message : String(error));
}

async function sendEmail(to: string, subject: string, html: string): Promise<string> {
  const tmpFile = `/tmp/invage_report_${Date.now()}.html`;
  const fs = await import('fs');
  fs.writeFileSync(tmpFile, html, 'utf-8');

  try {
    const htmlContent = fs.readFileSync(tmpFile, 'utf-8');
    const { stdout, stderr } = await execFileAsync('gws', [
      'gmail', '+send',
      '--to', to,
      '--subject', subject,
      '--body', htmlContent,
      '--html',
    ], { timeout: 30000 });

    if (stderr && stderr.includes('error')) {
      throw new Error(stderr);
    }
    return stdout.trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

export function createSendReportTool(): AgentTool {
  return {
    name: 'send_report',
    label: 'Send Report',
    description: 'Send a portfolio analysis report via email. Two modes: (1) Pass telegram_user_id to auto-generate a report from the user\'s saved portfolio and send it, (2) Pass to + subject + html for a custom email. The telegram_user_id is always from the message context.',
    parameters: Type.Object({
      to: Type.String({ description: 'Recipient email address.' }),
      telegram_user_id: Type.Optional(Type.Number({ description: 'Telegram user ID from the message context. If provided, auto-generates a portfolio analysis report.' })),
      subject: Type.Optional(Type.String({ description: 'Email subject line. Defaults to "Portfolio Analysis Report" when using auto-report mode.' })),
      html: Type.Optional(Type.String({ description: 'Custom HTML body. Only used when telegram_user_id is not provided.' })),
    }),
    async execute(_id, raw) {
      const p = raw as { to: string; telegram_user_id?: number; subject?: string; html?: string };

      try {
        let htmlBody: string;
        let subject: string;

        if (p.telegram_user_id) {
          // Auto-report mode: load portfolio, run analysis, generate HTML
          const state = resolveUserByTelegramUser(p.telegram_user_id);
          if (!state) {
            return fail(`No user linked to Telegram ID ${p.telegram_user_id}.`);
          }

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
          htmlBody = buildAnalysisReport(result, userName);
          subject = p.subject ?? `Portfolio Analysis Report — ${userName}`;
        } else if (p.html) {
          // Custom HTML mode
          htmlBody = p.html;
          subject = p.subject ?? 'Report from Invester';
        } else {
          return fail('Provide either telegram_user_id (auto-report) or html (custom email).');
        }

        const result = await sendEmail(p.to, subject, htmlBody);
        return ok(`Email sent to ${p.to}.\n${result}`, { to: p.to, subject });
      } catch (e) { return failFrom(e); }
    },
  };
}
