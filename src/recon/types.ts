import type { InstrumentKind } from '../market/types.js';

export type ReconSessionStatus = 'in_progress' | 'done';
export type ReconSleeveStatus = 'pending' | 'sourced' | 'compared' | 'applied' | 'skipped';
export type ReconLineDecision = 'keep' | 'take' | 'skip';
export type ReconLineKind = 'cash' | 'lot' | 'deposit';
export type ReconSourceKind = 'connector' | 'paste';
export type ReconNext = 'source' | 'decide' | 'apply' | 'done';

export interface ReconCashRow {
  currency: string;
  amount: number;
}

export interface ReconLotRow {
  ticker: string;
  units: number;
  avg_price?: number;
  instrument?: InstrumentKind;
  fund_quote_source?: 'manual' | 'yahoo';
  fund_name?: string;
  mark?: number;
}

export interface ReconDepositRow {
  id?: string;
  amount: number;
  currency: string;
  interest?: number;
  start_date?: string;
  end_date?: string;
  label?: string;
}

export interface ReconStatement {
  cash: ReconCashRow[];
  lots: ReconLotRow[];
  deposits: ReconDepositRow[];
}

export interface ReconLine {
  id: string;
  kind: ReconLineKind;
  decision?: ReconLineDecision;
  books_amount: number | null;
  statement_amount: number | null;
  /** Lot ticker or deposit id when kind is lot/deposit. */
  item?: string;
  currency?: string;
  books_units?: number | null;
  statement_units?: number | null;
  books_avg_price?: number | null;
  statement_avg_price?: number | null;
}

export interface ReconSleeve {
  channel: string;
  status: ReconSleeveStatus;
  source?: ReconSourceKind;
  statement?: ReconStatement;
  lines?: ReconLine[];
}

export interface ChannelReconSession {
  as_of: string;
  status: ReconSessionStatus;
  current_channel: string;
  sleeves: ReconSleeve[];
}

export interface ReconView {
  as_of: string;
  status: ReconSessionStatus;
  current_channel: string;
  next: ReconNext;
  open_lines: ReconLine[];
  sleeves: Array<{ channel: string; status: ReconSleeveStatus }>;
}

const SESSION_KEYS = new Set(['as_of', 'status', 'current_channel', 'sleeves']);
const SLEEVE_KEYS = new Set(['channel', 'status', 'source', 'statement', 'lines']);

function requireYmd(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new Error(`${field} must be YYYY-MM-DD.`);
  }
  return value.trim();
}

function requireChannel(value: unknown): string {
  if (value === undefined || value === null) {
    throw new Error('recon sleeve.channel is required (empty string = unassigned).');
  }
  if (typeof value !== 'string') {
    throw new Error('recon sleeve.channel must be a string.');
  }
  return value.trim();
}

export function assertReconSession(raw: unknown): ChannelReconSession {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('recon must be an object.');
  }
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!SESSION_KEYS.has(k)) throw new Error(`recon: unknown field "${k}".`);
  }
  const as_of = requireYmd(o.as_of, 'recon.as_of');
  if (o.status !== 'in_progress' && o.status !== 'done') {
    throw new Error('recon.status must be in_progress or done.');
  }
  if (typeof o.current_channel !== 'string') {
    throw new Error('recon.current_channel must be a string (empty = unassigned).');
  }
  if (!Array.isArray(o.sleeves)) throw new Error('recon.sleeves must be an array.');
  const sleeves = o.sleeves.map((s, i) => assertSleeve(s, i));
  return {
    as_of,
    status: o.status,
    current_channel: o.current_channel.trim(),
    sleeves,
  };
}

function assertSleeve(raw: unknown, i: number): ReconSleeve {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`recon.sleeves[${i}] must be an object.`);
  }
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!SLEEVE_KEYS.has(k)) throw new Error(`recon.sleeves[${i}]: unknown field "${k}".`);
  }
  const status = o.status;
  if (
    status !== 'pending' &&
    status !== 'sourced' &&
    status !== 'compared' &&
    status !== 'applied' &&
    status !== 'skipped'
  ) {
    throw new Error(`recon.sleeves[${i}].status is invalid.`);
  }
  const sleeve: ReconSleeve = {
    channel: requireChannel(o.channel),
    status,
  };
  if (o.source != null) {
    if (o.source !== 'connector' && o.source !== 'paste') {
      throw new Error(`recon.sleeves[${i}].source must be connector or paste.`);
    }
    sleeve.source = o.source;
  }
  if (o.statement != null) sleeve.statement = assertStatement(o.statement, i);
  if (o.lines != null) {
    if (!Array.isArray(o.lines)) throw new Error(`recon.sleeves[${i}].lines must be an array.`);
    sleeve.lines = o.lines.map((line, j) => assertLine(line, i, j));
  }
  return sleeve;
}

function assertStatement(raw: unknown, i: number): ReconStatement {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`recon.sleeves[${i}].statement must be an object.`);
  }
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (k !== 'cash' && k !== 'lots' && k !== 'deposits') {
      throw new Error(`recon.sleeves[${i}].statement: unknown field "${k}".`);
    }
  }
  if (!Array.isArray(o.cash) || !Array.isArray(o.lots) || !Array.isArray(o.deposits)) {
    throw new Error(`recon.sleeves[${i}].statement needs cash, lots, and deposits arrays.`);
  }
  return {
    cash: o.cash.map((row, j) => assertCashRow(row, i, j)),
    lots: o.lots.map((row, j) => assertLotRow(row, i, j)),
    deposits: o.deposits.map((row, j) => assertDepositRow(row, i, j)),
  };
}

function assertCashRow(raw: unknown, i: number, j: number): ReconCashRow {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`recon.sleeves[${i}].statement.cash[${j}] must be an object.`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.currency !== 'string' || !/^[A-Z]{3,4}$/.test(o.currency.trim().toUpperCase())) {
    throw new Error(`recon cash[${j}].currency must be a 3–4 letter code.`);
  }
  if (typeof o.amount !== 'number' || !Number.isFinite(o.amount) || o.amount < 0) {
    throw new Error(`recon cash[${j}].amount must be a finite number ≥ 0.`);
  }
  return { currency: o.currency.trim().toUpperCase(), amount: o.amount };
}

function assertLotRow(raw: unknown, i: number, j: number): ReconLotRow {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`recon.sleeves[${i}].statement.lots[${j}] must be an object.`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.ticker !== 'string' || !o.ticker.trim()) {
    throw new Error(`recon lots[${j}].ticker is required.`);
  }
  if (typeof o.units !== 'number' || !Number.isFinite(o.units) || !(o.units > 0)) {
    throw new Error(`recon lots[${j}].units must be a finite number > 0.`);
  }
  const row: ReconLotRow = { ticker: o.ticker.trim().toUpperCase(), units: o.units };
  if (o.avg_price != null) {
    if (typeof o.avg_price !== 'number' || !Number.isFinite(o.avg_price) || !(o.avg_price > 0)) {
      throw new Error(`recon lots[${j}].avg_price must be a finite number > 0 when set.`);
    }
    row.avg_price = o.avg_price;
  }
  if (o.instrument != null) {
    if (o.instrument !== 'equity' && o.instrument !== 'fund' && o.instrument !== 'option') {
      throw new Error(`recon lots[${j}].instrument must be equity, fund, or option.`);
    }
    row.instrument = o.instrument;
  }
  if (o.fund_quote_source != null) {
    if (o.fund_quote_source !== 'manual' && o.fund_quote_source !== 'yahoo') {
      throw new Error(`recon lots[${j}].fund_quote_source must be manual or yahoo.`);
    }
    row.fund_quote_source = o.fund_quote_source;
  }
  if (typeof o.fund_name === 'string' && o.fund_name.trim()) row.fund_name = o.fund_name.trim();
  if (o.mark != null) {
    if (typeof o.mark !== 'number' || !Number.isFinite(o.mark) || !(o.mark > 0)) {
      throw new Error(`recon lots[${j}].mark must be a finite number > 0 when set.`);
    }
    row.mark = o.mark;
  }
  return row;
}

function assertDepositRow(raw: unknown, i: number, j: number): ReconDepositRow {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`recon.sleeves[${i}].statement.deposits[${j}] must be an object.`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.amount !== 'number' || !Number.isFinite(o.amount) || o.amount < 0) {
    throw new Error(`recon deposits[${j}].amount must be a finite number ≥ 0.`);
  }
  if (typeof o.currency !== 'string' || !/^[A-Z]{3,4}$/.test(o.currency.trim().toUpperCase())) {
    throw new Error(`recon deposits[${j}].currency must be a 3–4 letter code.`);
  }
  const row: ReconDepositRow = { amount: o.amount, currency: o.currency.trim().toUpperCase() };
  if (typeof o.id === 'string' && o.id.trim()) row.id = o.id.trim();
  return row;
}

function assertLine(raw: unknown, i: number, j: number): ReconLine {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`recon.sleeves[${i}].lines[${j}] must be an object.`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id.trim()) {
    throw new Error(`recon.sleeves[${i}].lines[${j}].id is required.`);
  }
  if (o.kind !== 'cash' && o.kind !== 'lot' && o.kind !== 'deposit') {
    throw new Error(`recon.sleeves[${i}].lines[${j}].kind is invalid.`);
  }
  const line: ReconLine = {
    id: o.id,
    kind: o.kind,
    books_amount: o.books_amount === null || typeof o.books_amount === 'number' ? o.books_amount : null,
    statement_amount:
      o.statement_amount === null || typeof o.statement_amount === 'number' ? o.statement_amount : null,
  };
  if (o.decision != null) {
    if (o.decision !== 'keep' && o.decision !== 'take' && o.decision !== 'skip') {
      throw new Error(`recon.sleeves[${i}].lines[${j}].decision is invalid.`);
    }
    line.decision = o.decision;
  }
  if (typeof o.item === 'string') line.item = o.item;
  if (typeof o.currency === 'string') line.currency = o.currency;
  if (o.books_units === null || typeof o.books_units === 'number') line.books_units = o.books_units;
  if (o.statement_units === null || typeof o.statement_units === 'number') {
    line.statement_units = o.statement_units;
  }
  if (o.books_avg_price === null || typeof o.books_avg_price === 'number') {
    line.books_avg_price = o.books_avg_price;
  }
  if (o.statement_avg_price === null || typeof o.statement_avg_price === 'number') {
    line.statement_avg_price = o.statement_avg_price;
  }
  return line;
}

export function sameNumber(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a === b;
}
