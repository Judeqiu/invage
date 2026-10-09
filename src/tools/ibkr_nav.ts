import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { fetchRawData, listRawData, type RawFile } from '../raw-data/store.js';
import { extractSectionInner, xmlSelfClosingTags } from '../ibkr/flex-parse.js';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';

const MAX_FILES = 100;
const MAX_XML_BYTES = 16 * 1024 * 1024;
const CHUNK_BYTES = 65_536;

type NavMark = { account_id: string; date: string; currency: string; total: number };

function result<T>(message: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text', text: message }], details };
}

function xmlText(slug: string, file: RawFile): string {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < file.bytes;) {
    const part = fetchRawData(slug, file.id, file.version, offset, CHUNK_BYTES, 'base64');
    if (part.bytes_read <= 0) throw new Error(`Could not read ${file.id} completely.`);
    chunks.push(Buffer.from(part.content, 'base64'));
    offset += part.bytes_read;
  }
  return Buffer.concat(chunks).toString('utf8');
}

function dateFromFlex(raw: string): string | null {
  const compact = raw.replaceAll('-', '');
  if (!/^\d{8}$/.test(compact)) return null;
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function parseIbkrNavMarks(xml: string): NavMark[] {
  const section = extractSectionInner(xml, 'EquitySummaryInBase');
  if (section == null) return [];
  return xmlSelfClosingTags(section, 'EquitySummaryByReportDateInBase').map((row) => {
    const date = dateFromFlex(row.reportDate ?? '');
    const accountId = row.accountId?.trim();
    const currency = row.currency?.trim().toUpperCase();
    const total = Number(row.total);
    if (!date || !accountId || !currency || !/^[A-Z]{3}$/.test(currency) ||
        row.total == null || row.total.trim() === '' || !Number.isFinite(total)) {
      throw new Error('IBKR EquitySummary has an invalid account, date, currency, or total.');
    }
    return { account_id: accountId, date, currency, total };
  });
}

export function createInspectIbkrNavHistoryTool(): AgentTool {
  return {
    name: 'inspect_ibkr_nav_history',
    label: 'Inspect IBKR NAV history',
    description:
      'Read dated EquitySummaryInBase.total NAV marks from this user\'s archived IBKR Flex XML. ' +
      'Reports coverage for a month and whether the files include an external cash-flow section. ' +
      'This is source inspection, not a TWR calculator. Missing flow sections do not prove there were no flows. ' +
      'Do not annualize NAV change as TWR. Pass channel identity from context.',
    parameters: Type.Object({
      ...channelIdParams,
      month: Type.Optional(Type.String({ description: 'YYYY-MM; defaults to current UTC month.' })),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { month?: string };
      try {
        const month = p.month ?? new Date().toISOString().slice(0, 7);
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
          return result('month must be YYYY-MM.', null);
        }
        const { state } = await resolveInvestorFromChannel(p);
        const page = listRawData(state.user.id, 0, MAX_FILES, 'ibkr');
        const xmlFiles = page.files.filter((file) => file.id.endsWith('.xml') &&
          (file.source_kind === 'broker-sync' || file.source_kind === 'broker-triage'));
        const marks = new Map<string, NavMark>();
        const conflicts: string[] = [];
        const tooLarge: string[] = [];
        let filesWithMarks = 0;
        let filesWithFlowSections = 0;
        for (const file of xmlFiles) {
          if (file.bytes > MAX_XML_BYTES) { tooLarge.push(file.id); continue; }
          const xml = xmlText(state.user.id, file);
          if (/<(?:DepositsAndWithdrawals|DepositWithdrawal|Transfers|Transfer)\b/i.test(xml)) {
            filesWithFlowSections++;
          }
          const rows = parseIbkrNavMarks(xml);
          if (rows.length > 0) filesWithMarks++;
          for (const mark of rows) {
            const key = `${mark.account_id}|${mark.currency}|${mark.date}`;
            const previous = marks.get(key);
            if (previous && previous.total !== mark.total && !conflicts.includes(key)) conflicts.push(key);
            else if (!previous) marks.set(key, mark);
          }
        }
        const accounts = new Map<string, { account_id: string; currency: string; prior_mark: NavMark | null; month_marks: NavMark[]; latest_mark_date: string | null }>();
        for (const mark of marks.values()) {
          const key = `${mark.account_id}|${mark.currency}`;
          let account = accounts.get(key);
          if (!account) {
            account = { account_id: mark.account_id, currency: mark.currency, prior_mark: null, month_marks: [], latest_mark_date: null };
            accounts.set(key, account);
          }
          if (!account.latest_mark_date || mark.date > account.latest_mark_date) account.latest_mark_date = mark.date;
          if (mark.date < `${month}-01` && (!account.prior_mark || mark.date > account.prior_mark.date)) account.prior_mark = mark;
          if (mark.date.startsWith(month)) account.month_marks.push(mark);
        }
        const coverage = [...accounts.values()].map((account) => ({
          ...account,
          month_marks: account.month_marks.sort((a, b) => a.date.localeCompare(b.date)),
        }));
        const details = {
          month,
          files_examined: xmlFiles.length - tooLarge.length,
          files_with_marks: filesWithMarks,
          files_with_flow_sections: filesWithFlowSections,
          files_too_large: tooLarge,
          file_listing_truncated: page.next_offset != null,
          conflicting_mark_keys: conflicts,
          accounts: coverage,
          twr_ready: false,
          reason: 'External cash flows and their completeness are not verified by this tool.',
        };
        return result(`IBKR NAV source coverage for ${month}: ${JSON.stringify(details)}`, details);
      } catch (error) {
        return result(error instanceof Error ? error.message : String(error), null);
      }
    },
  };
}
