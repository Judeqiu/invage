/**
 * Declarative CSV-table mapping spec. LLM generates this; the host interprets it.
 * No eval. Missing required columns fail.
 */

import type { FlexCashRow, FlexOpenPosition, FlexSkip } from '../ibkr/flex-parse.js';
import type { BrokerStatement } from './statement.js';

export interface CsvColumnMap {
  headerMustInclude: string[];
  columns: Record<string, string>;
}

export interface CsvTablesParserSpec {
  kind: 'csv_tables';
  skipCurrencies: string[];
  cash: CsvColumnMap;
  positions: CsvColumnMap;
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function headerIndex(headers: string[]): Map<string, number> {
  const m = new Map<string, number>();
  headers.forEach((h, i) => m.set(h.trim(), i));
  return m;
}

function cell(idx: Map<string, number>, row: string[], column: string, ctx: string): string {
  const i = idx.get(column);
  if (i == null) throw new Error(`CSV parser: column "${column}" missing in ${ctx}.`);
  return (row[i] ?? '').trim();
}

function optCell(idx: Map<string, number>, row: string[], column: string | undefined): string {
  if (!column) return '';
  const i = idx.get(column);
  if (i == null) return '';
  return (row[i] ?? '').trim();
}

function isHeaderRow(row: string[], mustInclude: string[]): boolean {
  const set = new Set(row.map((c) => c.trim()));
  return mustInclude.every((h) => set.has(h));
}

function numOrUndef(raw: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`CSV parser: not a number (${raw})`);
  return n;
}

export function assertCsvTablesSpec(raw: unknown): CsvTablesParserSpec {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Broker parser spec must be an object.');
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== 'csv_tables') {
    throw new Error('Broker parser spec.kind must be "csv_tables".');
  }
  if (!Array.isArray(o.skipCurrencies) || o.skipCurrencies.some((x) => typeof x !== 'string' || !x.trim())) {
    throw new Error('Broker parser spec.skipCurrencies must be an array of non-empty strings.');
  }
  const map = (value: unknown, label: string): CsvColumnMap => {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Broker parser spec.${label} must be an object.`);
    }
    const m = value as Record<string, unknown>;
    if (
      !Array.isArray(m.headerMustInclude) ||
      m.headerMustInclude.length === 0 ||
      m.headerMustInclude.some((x) => typeof x !== 'string' || !x.trim())
    ) {
      throw new Error(`Broker parser spec.${label}.headerMustInclude must be a non-empty string array.`);
    }
    if (m.columns == null || typeof m.columns !== 'object' || Array.isArray(m.columns)) {
      throw new Error(`Broker parser spec.${label}.columns must be a mapping of field → header.`);
    }
    const columns: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.columns)) {
      if (typeof v !== 'string' || !v.trim()) {
        throw new Error(`Broker parser spec.${label}.columns.${k} must be a non-empty header name.`);
      }
      columns[k] = v.trim();
    }
    return {
      headerMustInclude: m.headerMustInclude.map((s) => String(s).trim()),
      columns,
    };
  };
  const cash = map(o.cash, 'cash');
  const positions = map(o.positions, 'positions');
  for (const key of ['accountId', 'fromDate', 'toDate', 'currency', 'endingCash']) {
    if (!cash.columns[key]) throw new Error(`Broker parser spec.cash.columns.${key} is required.`);
  }
  for (const key of ['symbol', 'quantity', 'currency', 'assetCategory']) {
    if (!positions.columns[key]) throw new Error(`Broker parser spec.positions.columns.${key} is required.`);
  }
  return {
    kind: 'csv_tables',
    skipCurrencies: o.skipCurrencies.map((s) => String(s).trim().toUpperCase()),
    cash,
    positions,
  };
}

export function runCsvTablesSpec(text: string, spec: CsvTablesParserSpec): BrokerStatement {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const tables: { role: 'cash' | 'positions'; headers: string[]; rows: string[][] }[] = [];
  let current: { role: 'cash' | 'positions'; headers: string[]; rows: string[][] } | null = null;
  for (const line of lines) {
    const row = parseCsvLine(line);
    if (isHeaderRow(row, spec.cash.headerMustInclude)) {
      current = { role: 'cash', headers: row.map((c) => c.trim()), rows: [] };
      tables.push(current);
      continue;
    }
    if (isHeaderRow(row, spec.positions.headerMustInclude)) {
      current = { role: 'positions', headers: row.map((c) => c.trim()), rows: [] };
      tables.push(current);
      continue;
    }
    if (!current) {
      throw new Error('CSV parser: data row before a known header.');
    }
    current.rows.push(row);
  }
  const cashTable = tables.find((t) => t.role === 'cash');
  const posTable = tables.find((t) => t.role === 'positions');
  if (!cashTable) throw new Error('CSV parser: no cash table matching headerMustInclude.');
  if (!posTable) throw new Error('CSV parser: no positions table matching headerMustInclude.');

  const skipCcy = new Set(spec.skipCurrencies);
  const cashIdx = headerIndex(cashTable.headers);
  const cashCols = spec.cash.columns;
  const skipped: FlexSkip[] = [];
  const cash: FlexCashRow[] = [];
  let accountId = '';
  let fromDate = '';
  let toDate = '';
  for (const row of cashTable.rows) {
    const ccy = cell(cashIdx, row, cashCols.currency, 'cash').toUpperCase();
    if (skipCcy.has(ccy)) continue;
    const endingRaw = cell(cashIdx, row, cashCols.endingCash, 'cash');
    const ending = Number(endingRaw);
    if (!Number.isFinite(ending)) {
      throw new Error(`CSV parser: endingCash is not a number (${endingRaw})`);
    }
    if (ending < 0) {
      skipped.push({ kind: 'cash', currency: ccy, reason: 'endingCash < 0 is not stored' });
      continue;
    }
    if (!/^[A-Z]{3,4}$/.test(ccy)) {
      skipped.push({ kind: 'cash', currency: ccy, reason: 'not a 3–4 letter currency code' });
      continue;
    }
    cash.push({ currency: ccy, endingCash: ending });
    if (!accountId) accountId = cell(cashIdx, row, cashCols.accountId, 'cash');
    if (!fromDate) fromDate = cell(cashIdx, row, cashCols.fromDate, 'cash');
    if (!toDate) toDate = cell(cashIdx, row, cashCols.toDate, 'cash');
  }
  if (cash.length === 0) throw new Error('CSV parser: Cash Report has no importable currency rows.');

  const posIdx = headerIndex(posTable.headers);
  const posCols = spec.positions.columns;
  const openPositions: FlexOpenPosition[] = [];
  for (const row of posTable.rows) {
    const symbol = cell(posIdx, row, posCols.symbol, 'positions');
    const qtyRaw = cell(posIdx, row, posCols.quantity, 'positions');
    const quantity = Number(qtyRaw);
    if (!Number.isFinite(quantity)) {
      skipped.push({ kind: 'position', symbol, reason: `quantity is not a number (${qtyRaw})` });
      continue;
    }
    const posAccount = optCell(posIdx, row, posCols.accountId) || accountId;
    if (!posAccount) throw new Error('CSV parser: accountId is required.');
    const pos: FlexOpenPosition = {
      accountId: posAccount,
      currency: cell(posIdx, row, posCols.currency, 'positions').toUpperCase(),
      assetCategory: cell(posIdx, row, posCols.assetCategory, 'positions').toUpperCase(),
      symbol,
      quantity,
      raw: {},
    };
    const listingExchange = optCell(posIdx, row, posCols.listingExchange);
    if (listingExchange) pos.listingExchange = listingExchange;
    const multiplier = numOrUndef(optCell(posIdx, row, posCols.multiplier));
    if (multiplier != null) pos.multiplier = multiplier;
    const costBasisPrice = numOrUndef(optCell(posIdx, row, posCols.costBasisPrice));
    if (costBasisPrice != null) pos.costBasisPrice = costBasisPrice;
    const costBasisMoney = numOrUndef(optCell(posIdx, row, posCols.costBasisMoney));
    if (costBasisMoney != null) pos.costBasisMoney = costBasisMoney;
    const markPrice = numOrUndef(optCell(posIdx, row, posCols.markPrice));
    if (markPrice != null) pos.markPrice = markPrice;
    const positionValue = numOrUndef(optCell(posIdx, row, posCols.positionValue));
    if (positionValue != null) pos.positionValue = positionValue;
    const strike = numOrUndef(optCell(posIdx, row, posCols.strike));
    if (strike != null) pos.strike = strike;
    const expiry = optCell(posIdx, row, posCols.expiry);
    if (expiry) pos.expiry = expiry;
    const putCall = optCell(posIdx, row, posCols.putCall);
    if (putCall) pos.putCall = putCall;
    const underlyingSymbol = optCell(posIdx, row, posCols.underlyingSymbol);
    if (underlyingSymbol) pos.underlyingSymbol = underlyingSymbol;
    openPositions.push(pos);
    if (!accountId) accountId = posAccount;
  }
  if (!accountId) throw new Error('CSV parser: accountId is required.');
  if (!fromDate || !toDate) throw new Error('CSV parser: fromDate and toDate are required on the cash table.');
  return {
    accountId,
    fromDate: ymd(fromDate, 'fromDate'),
    toDate: ymd(toDate, 'toDate'),
    openPositions,
    cash,
    skipped,
  };
}

function ymd(raw: string, field: string): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`CSV parser ${field}: expected YYYYMMDD, got "${raw}"`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}
