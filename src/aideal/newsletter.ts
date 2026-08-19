/**
 * Gmail-safe HTML for the Aideal weekly pack.
 * No rgba(), no styled spans — tables + bgcolor + hex only.
 */

import type { SleeveIndexResult } from './index-math.js';

export interface AidealNewsletterSectionRow {
  ticker: string;
  plPct: number;
  action: string;
  note: string;
}

export interface AidealNewsletterInput {
  title: string;
  reportDate: string;
  sleeves: SleeveIndexResult[];
  laggards: AidealNewsletterSectionRow[];
  overpriced: AidealNewsletterSectionRow[];
  buyOpportunities: AidealNewsletterSectionRow[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(n: number, digits = 2): string {
  return n.toFixed(digits);
}

function sectionTable(title: string, rows: AidealNewsletterSectionRow[]): string {
  const body =
    rows.length === 0
      ? `<tr bgcolor="#ffffff"><td colspan="4" style="padding:8px;color:#4a5568;">None this week.</td></tr>`
      : rows
          .map(
            (r) => `<tr bgcolor="#ffffff">
  <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${esc(r.ticker)}</td>
  <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${num(r.plPct)}%</td>
  <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${esc(r.action)}</td>
  <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${esc(r.note)}</td>
</tr>`,
          )
          .join('\n');
  return `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#2c5282" style="margin:16px 0;">
  <tr bgcolor="#2c5282"><td style="padding:10px;color:#ffffff;font-weight:bold;">${esc(title)}</td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff">
  <tr bgcolor="#edf2f7">
    <td style="padding:8px;font-weight:bold;">Ticker</td>
    <td style="padding:8px;font-weight:bold;">P/L %</td>
    <td style="padding:8px;font-weight:bold;">Action</td>
    <td style="padding:8px;font-weight:bold;">Note</td>
  </tr>
  ${body}
</table>`;
}

export function buildAidealNewsletterHtml(input: AidealNewsletterInput): string {
  const title = input.title.trim();
  if (!title) throw new Error('Newsletter title is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reportDate)) {
    throw new Error(`reportDate must be YYYY-MM-DD, got "${input.reportDate}".`);
  }
  if (input.sleeves.length === 0) {
    throw new Error('Newsletter requires at least one sleeve index row from compute_sleeve_index.');
  }

  const sleeveRows = input.sleeves
    .map(
      (s) => `<tr bgcolor="#ffffff">
  <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${esc(s.label)}</td>
  <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${esc(s.benchmark)}</td>
  <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${num(s.fundIndex)}</td>
  <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${num(s.benchmarkIndex)}</td>
  <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${num(s.vsBenchmark)}</td>
</tr>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Arial,sans-serif;color:#1a202c;">
<table width="800" align="center" cellpadding="0" cellspacing="0" bgcolor="#ffffff">
<tr bgcolor="#1a365d"><td style="padding:20px;color:#ffffff;">
  <div style="font-size:22px;font-weight:bold;">${esc(title)}</div>
  <div style="font-size:13px;color:#e2e8f0;">Report date ${esc(input.reportDate)} · Wallet Street / AIDeal</div>
</td></tr>
<tr><td style="padding:16px;">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr bgcolor="#edf2f7">
    <td style="padding:8px;font-weight:bold;">Sleeve</td>
    <td style="padding:8px;font-weight:bold;">Benchmark</td>
    <td style="padding:8px;font-weight:bold;">Fund idx</td>
    <td style="padding:8px;font-weight:bold;">Bench idx</td>
    <td style="padding:8px;font-weight:bold;">vs bench</td>
  </tr>
  ${sleeveRows}
</table>
${sectionTable('Laggards', input.laggards)}
${sectionTable('Overpriced / take-profit', input.overpriced)}
${sectionTable('Buy opportunities', input.buyOpportunities)}
<p style="font-size:12px;color:#4a5568;">Educational analysis only — not licensed financial advice. Indices rebase to 100 on each sleeve base date. Prices from tools this run.</p>
</td></tr>
</table>
</body></html>
`;
}
