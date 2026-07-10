import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fetchPrices, fetchTargets, runFullAnalysis } from '../market/index.js';
import { getPortfolio } from '../state/portfolio-state.js';
import { buildAnalysisReport } from '../report/template.js';
import {
  channelIdParams,
  resolveInvestorFromChannel,
  type ChannelIds,
} from './channel.js';

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
    const { stdout, stderr } = await execFileAsync(
      'gws',
      ['gmail', '+send', '--to', to, '--subject', subject, '--body', htmlContent, '--html'],
      { timeout: 30000 },
    );

    if (stderr && stderr.includes('error')) {
      throw new Error(stderr);
    }
    return stdout.trim();
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup failure
    }
  }
}

export function createSendReportTool(): AgentTool {
  return {
    name: 'send_report',
    label: 'Send Report',
    description:
      "Send a portfolio analysis report via email (gws Gmail CLI). Prefer the user's contact_email for `to`. Pass telegram_user_id or slack_user_id for auto-report mode.",
    parameters: Type.Object({
      to: Type.String({ description: 'Recipient email address.' }),
      ...channelIdParams,
      subject: Type.Optional(Type.String({ description: 'Email subject line.' })),
      html: Type.Optional(
        Type.String({
          description: 'Custom HTML body. Only used when no channel id is provided.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { to: string; subject?: string; html?: string };

      try {
        let htmlBody: string;
        let subject: string;

        if (p.telegram_user_id != null || p.slack_user_id) {
          const state = resolveInvestorFromChannel(p);
          const portfolio = getPortfolio(state);
          if (Object.keys(portfolio).length === 0) {
            return fail('No portfolio saved. Use add_holding to build a portfolio first.');
          }

          const tickers = Object.keys(portfolio);
          const [prices, targets] = await Promise.all([fetchPrices(tickers), fetchTargets(tickers)]);

          const result = runFullAnalysis(portfolio, prices, targets);
          const userName = state.profile.display_name;
          htmlBody = buildAnalysisReport(result, userName);
          subject = p.subject ?? `Portfolio Analysis Report — ${userName}`;
        } else if (p.html) {
          htmlBody = p.html;
          subject = p.subject ?? 'Report from Invester';
        } else {
          return fail(
            'Provide telegram_user_id or slack_user_id (auto-report) or html (custom email).',
          );
        }

        const result = await sendEmail(p.to, subject, htmlBody);
        return ok(`Email sent to ${p.to}.\n${result}`, { to: p.to, subject });
      } catch (e) {
        return failFrom(e);
      }
    },
  };
}
