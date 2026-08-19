import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot, signedBinDriveViewUrl } from 'utarus';
import { computeSleeveIndex, type SleeveIndexResult, type SleeveLot } from '../aideal/index-math.js';
import {
  buildAidealNewsletterHtml,
  type AidealNewsletterSectionRow,
} from '../aideal/newsletter.js';
import { AIDEAL_SLEEVES, getAidealSleeve, lotsFromPortfolio } from '../aideal/sleeves.js';
import { fetchHistoricalCloses } from '../market/fetch-history.js';
import { getPortfolio } from '../state/portfolio-state.js';
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseLots(raw: unknown): SleeveLot[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('lots must be a non-empty array of {ticker, units}.');
  }
  return raw.map((row, i) => {
    if (typeof row !== 'object' || row == null) {
      throw new Error(`lots[${i}] must be an object.`);
    }
    const r = row as { ticker?: unknown; units?: unknown };
    if (typeof r.ticker !== 'string' || r.ticker.trim().length === 0) {
      throw new Error(`lots[${i}].ticker is required.`);
    }
    if (typeof r.units !== 'number' || !Number.isFinite(r.units) || r.units <= 0) {
      throw new Error(`lots[${i}].units must be a positive number.`);
    }
    return { ticker: r.ticker.trim().toUpperCase(), units: r.units };
  });
}

function parseSection(raw: unknown, name: string): AidealNewsletterSectionRow[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`${name} must be an array.`);
  }
  return raw.map((row, i) => {
    if (typeof row !== 'object' || row == null) {
      throw new Error(`${name}[${i}] must be an object.`);
    }
    const r = row as Record<string, unknown>;
    if (typeof r.ticker !== 'string' || r.ticker.trim().length === 0) {
      throw new Error(`${name}[${i}].ticker is required.`);
    }
    if (typeof r.pl_pct !== 'number' || !Number.isFinite(r.pl_pct)) {
      throw new Error(`${name}[${i}].pl_pct must be a finite number.`);
    }
    if (typeof r.action !== 'string' || r.action.trim().length === 0) {
      throw new Error(`${name}[${i}].action is required.`);
    }
    if (typeof r.note !== 'string') {
      throw new Error(`${name}[${i}].note is required (use empty string if none).`);
    }
    return {
      ticker: r.ticker.trim().toUpperCase(),
      plPct: r.pl_pct,
      action: r.action.trim(),
      note: r.note,
    };
  });
}

async function pricesOnDates(
  tickers: string[],
  dates: [string, string],
): Promise<{ base: Record<string, number>; report: Record<string, number> }> {
  const base: Record<string, number> = {};
  const report: Record<string, number> = {};
  const missing: string[] = [];
  for (const ticker of tickers) {
    const closes = await fetchHistoricalCloses(ticker, dates);
    if (closes[dates[0]] == null || closes[dates[1]] == null) {
      missing.push(
        `${ticker} (base=${closes[dates[0]] ?? 'none'}, report=${closes[dates[1]] ?? 'none'})`,
      );
      continue;
    }
    base[ticker] = closes[dates[0]];
    report[ticker] = closes[dates[1]];
  }
  if (missing.length > 0) {
    throw new Error(
      `No Yahoo close on/before required dates for: ${missing.join('; ')}. Do not invent prices.`,
    );
  }
  return { base, report };
}

export function createListAidealSleevesTool(): AgentTool {
  return {
    name: 'list_aideal_sleeves',
    label: 'List Aideal Sleeves',
    description:
      'List the Aideal Investment sleeves (id, benchmark, base date, documented tickers). ' +
      'Index weights come from books lots with matching holding.category, not this ticker list.',
    parameters: Type.Object({}),
    async execute() {
      const lines = [
        'AIDEAL SLEEVES (Excelsis Holdings production catalog)',
        'Index lots: holding.category must equal sleeve id (overall = union of the six).',
        '',
        ...AIDEAL_SLEEVES.map((s) => {
          const uni =
            s.id === 'overall'
              ? 'union of financial/healthcare/aerospace/food-staples/utility/technology'
              : s.tickers.join(', ');
          return `${s.id}  ${s.label}  bench=${s.benchmark}  base=${s.baseDate}  universe=${uni}`;
        }),
      ];
      return ok(lines.join('\n'), {
        sleeves: AIDEAL_SLEEVES.map((s) => ({
          id: s.id,
          label: s.label,
          benchmark: s.benchmark,
          baseDate: s.baseDate,
          tickers: [...s.tickers],
        })),
      });
    },
  };
}

export function createComputeSleeveIndexTool(): AgentTool {
  return {
    name: 'compute_sleeve_index',
    label: 'Compute Sleeve Index',
    description:
      'Rebase an Aideal sleeve (or all) and its benchmark to 100 on the sleeve base date. ' +
      'Requires report_date (YYYY-MM-DD). Lots: pass lots=[{ticker,units}] OR resolve books via ' +
      'user_slug/telegram/slack where holding.category equals the sleeve id. Fail-fast if no lots or Yahoo close missing.',
    parameters: Type.Object({
      ...channelIdParams,
      sleeve_id: Type.String({
        description:
          'One sleeve id (financial, healthcare, aerospace, food-staples, utility, technology, overall) or "all".',
      }),
      report_date: Type.String({
        description: 'Report date YYYY-MM-DD. Uses last Yahoo session on or before this day.',
      }),
      lots: Type.Optional(
        Type.Array(
          Type.Object({
            ticker: Type.String(),
            units: Type.Number(),
          }),
          { description: 'Explicit lots. When set, books are not used for weights.' },
        ),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        sleeve_id: string;
        report_date: string;
        lots?: unknown;
      };
      try {
        if (!DATE_RE.test(p.report_date)) {
          return fail(`report_date must be YYYY-MM-DD, got "${p.report_date}".`);
        }
        const explicit = parseLots(p.lots);
        const ids =
          p.sleeve_id.trim().toLowerCase() === 'all'
            ? AIDEAL_SLEEVES.map((s) => s.id)
            : [p.sleeve_id.trim()];
        const results: SleeveIndexResult[] = [];
        const lines: string[] = [
          `AIDEAL SLEEVE INDEX  report=${p.report_date}`,
          'Fund idx = 100 × sleeve NAV now / sleeve NAV on base date. vs bench = fund − bench.',
          '',
        ];
        for (const id of ids) {
          const sleeve = getAidealSleeve(id);
          if (p.report_date < sleeve.baseDate) {
            return fail(
              `report_date ${p.report_date} is before ${sleeve.id} base ${sleeve.baseDate}.`,
            );
          }
          let lots: SleeveLot[];
          if (explicit) {
            lots = explicit;
          } else {
            const state = resolveInvestorFromChannel(p);
            lots = lotsFromPortfolio(sleeve, getPortfolio(state));
          }
          if (lots.length === 0) {
            return fail(
              `No lots for sleeve "${sleeve.id}". Journal holdings with category=${sleeve.id} ` +
                `via Bookkeeper, or pass lots=[{ticker,units}].`,
            );
          }
          const tickers = [...new Set([...lots.map((l) => l.ticker), sleeve.benchmark])];
          const { base, report } = await pricesOnDates(tickers, [sleeve.baseDate, p.report_date]);
          const computed = computeSleeveIndex({
            sleeveId: sleeve.id,
            label: sleeve.label,
            benchmark: sleeve.benchmark,
            baseDate: sleeve.baseDate,
            reportDate: p.report_date,
            lots,
            basePrices: base,
            reportPrices: report,
          });
          results.push(computed);
          lines.push(
            `${computed.label}  fund=${computed.fundIndex.toFixed(2)}  ` +
              `${computed.benchmark}=${computed.benchmarkIndex.toFixed(2)}  ` +
              `vs=${computed.vsBenchmark.toFixed(2)}  lots=${computed.lotCount}  ` +
              `NAV ${computed.sleeveValueBase.toFixed(2)} → ${computed.sleeveValueNow.toFixed(2)}  ` +
              `base=${computed.baseDate}`,
          );
        }
        return ok(lines.join('\n'), { report_date: p.report_date, sleeves: results });
      } catch (e) {
        return failFrom(e);
      }
    },
  };
}

export function createSaveAidealNewsletterTool(): AgentTool {
  return {
    name: 'save_aideal_newsletter',
    label: 'Save Aideal Newsletter',
    description:
      'Write a Gmail-safe HTML Aideal weekly pack to BinDrive. ' +
      'Pass sleeve rows from compute_sleeve_index (do not invent indices). ' +
      'Section rows (laggards / overpriced / buy_opportunities) must be grounded in tools this chain.',
    parameters: Type.Object({
      ...channelIdParams,
      title: Type.String({ description: 'Newsletter title shown in the header.' }),
      report_date: Type.String({ description: 'YYYY-MM-DD.' }),
      filename: Type.Optional(Type.String({ description: 'BinDrive filename; default aideal-YYYY-MM-DD.html' })),
      sleeves: Type.Array(
        Type.Object({
          sleeveId: Type.String(),
          label: Type.String(),
          benchmark: Type.String(),
          baseDate: Type.String(),
          reportDate: Type.String(),
          sleeveValueBase: Type.Number(),
          sleeveValueNow: Type.Number(),
          fundIndex: Type.Number(),
          benchmarkIndex: Type.Number(),
          vsBenchmark: Type.Number(),
          lotCount: Type.Number(),
        }),
        { description: 'Exact sleeve objects from compute_sleeve_index details.sleeves.' },
      ),
      laggards: Type.Optional(
        Type.Array(
          Type.Object({
            ticker: Type.String(),
            pl_pct: Type.Number(),
            action: Type.String(),
            note: Type.String(),
          }),
        ),
      ),
      overpriced: Type.Optional(
        Type.Array(
          Type.Object({
            ticker: Type.String(),
            pl_pct: Type.Number(),
            action: Type.String(),
            note: Type.String(),
          }),
        ),
      ),
      buy_opportunities: Type.Optional(
        Type.Array(
          Type.Object({
            ticker: Type.String(),
            pl_pct: Type.Number(),
            action: Type.String(),
            note: Type.String(),
          }),
        ),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        title: string;
        report_date: string;
        filename?: string;
        sleeves: SleeveIndexResult[];
        laggards?: unknown;
        overpriced?: unknown;
        buy_opportunities?: unknown;
      };
      try {
        const state = resolveInvestorFromChannel(p);
        const html = buildAidealNewsletterHtml({
          title: p.title,
          reportDate: p.report_date,
          sleeves: p.sleeves,
          laggards: parseSection(p.laggards, 'laggards'),
          overpriced: parseSection(p.overpriced, 'overpriced'),
          buyOpportunities: parseSection(p.buy_opportunities, 'buy_opportunities'),
        });
        const fileName = p.filename ?? `aideal-${p.report_date}.html`;
        const driveDir = join(resolveDataRoot(), 'drive', state.user.slug);
        mkdirSync(driveDir, { recursive: true });
        writeFileSync(join(driveDir, fileName), html, 'utf-8');
        const signed = signedBinDriveViewUrl(state.user.slug, fileName, {
          displayName: state.profile.display_name,
        });
        const ttlMin = Math.round(signed.expiresInMs / 60000);
        return ok(
          [
            `Aideal newsletter saved to BinDrive as "${fileName}".`,
            `Sleeves: ${p.sleeves.length}`,
            `View: ${signed.url}`,
            `Opens without login for ~${ttlMin} minutes.`,
            '',
            'YOU MUST include the URL above verbatim in your reply to the user.',
          ].join('\n'),
          {
            slug: state.user.slug,
            fileName,
            viewUrl: signed.url,
            sleeves: p.sleeves.length,
          },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };
}

export function createAidealTools(): AgentTool[] {
  return [
    createListAidealSleevesTool(),
    createComputeSleeveIndexTool(),
    createSaveAidealNewsletterTool(),
    // Read books for P/L tables that feed the newsletter sections
  ];
}
