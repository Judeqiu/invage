/**
 * Canonical broker statement — the only apply input.
 * Catalog parsers (IBKR Flex XML, csv_tables) map vendor rows into this
 * books snapshot. Vendor field names are never stored.
 */

import type { Holding } from '../market/types.js';
import { assertHolding, HOLDING_KEY_CHANNEL_SEP } from '../market/position-value.js';
import {
  assertBrokerConnectionMetrics,
  type BrokerConnectionMetrics,
} from '../state/portfolio-state.js';

export interface BrokerSkip {
  kind: 'position' | 'cash';
  reason: string;
  symbol?: string;
  currency?: string;
}

export function formatBrokerSkip(skip: BrokerSkip): string {
  const who = skip.symbol ?? skip.currency;
  return who ? `${who}: ${skip.reason}` : skip.reason;
}

/** Free-cash sleeve on the connector channel. Same fields as YAML CashBalance minus channel/updated_at (apply stamps those). */
export interface BrokerCashSleeve {
  currency: string;
  /** Available cash — YAML `cash.amount`. */
  amount: number;
  settled_amount?: number;
  accrued_interest?: number;
}

/** One lot. `ticker` is the map base (no @channel). Apply stamps `holding.channel` from the catalog. */
export interface BrokerLot {
  ticker: string;
  currency: string;
  holding: Holding;
}

export interface BrokerStatement {
  account_id: string;
  as_of: string;
  from_date?: string;
  cash: BrokerCashSleeve[];
  lots: BrokerLot[];
  skipped: BrokerSkip[];
  metrics?: BrokerConnectionMetrics;
}

export interface BrokerApplyResult {
  accountId: string;
  asOf: string;
  channel: string;
  lotsUpserted: number;
  lotsRemoved: number;
  cash: BrokerCashSleeve[];
  skipped: BrokerSkip[];
  archivePath?: string;
}

function requireYmd(value: string, field: string): string {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`Broker statement ${field}: expected YYYY-MM-DD or YYYYMMDD, got "${value}"`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function rejectVendorShape(o: Record<string, unknown>): void {
  if (
    'openPositions' in o ||
    'accountId' in o ||
    'fromDate' in o ||
    'toDate' in o ||
    'endingCash' in o
  ) {
    throw new Error(
      'BrokerStatement is the books snapshot (account_id, as_of, cash[].amount, lots[].holding). ' +
        'Do not submit Flex/CSV vendor rows (openPositions, endingCash, accountId). ' +
        'The catalog parser or csv_tables maps vendor text into this shape.',
    );
  }
}

function assertCashSleeve(raw: unknown, i: number): BrokerCashSleeve {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Broker statement cash[${i}] must be an object.`);
  }
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (k !== 'currency' && k !== 'amount' && k !== 'settled_amount' && k !== 'accrued_interest') {
      throw new Error(`Broker statement cash[${i}]: unknown field "${k}".`);
    }
  }
  if (typeof r.currency !== 'string' || !/^[A-Z]{3,4}$/.test(r.currency.trim().toUpperCase())) {
    throw new Error(`Broker statement cash[${i}].currency must be a 3–4 letter code.`);
  }
  if (typeof r.amount !== 'number' || !Number.isFinite(r.amount) || r.amount < 0) {
    throw new Error(`Broker statement cash[${i}].amount must be a finite number ≥ 0.`);
  }
  const sleeve: BrokerCashSleeve = {
    currency: r.currency.trim().toUpperCase(),
    amount: r.amount,
  };
  if (r.settled_amount != null) {
    if (typeof r.settled_amount !== 'number' || !Number.isFinite(r.settled_amount) || r.settled_amount < 0) {
      throw new Error(`Broker statement cash[${i}].settled_amount must be a finite number ≥ 0 when set.`);
    }
    sleeve.settled_amount = r.settled_amount;
  }
  if (r.accrued_interest != null) {
    if (
      typeof r.accrued_interest !== 'number' ||
      !Number.isFinite(r.accrued_interest) ||
      r.accrued_interest < 0
    ) {
      throw new Error(`Broker statement cash[${i}].accrued_interest must be a finite number ≥ 0 when set.`);
    }
    sleeve.accrued_interest = r.accrued_interest;
  }
  return sleeve;
}

function assertLot(raw: unknown, i: number): BrokerLot {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Broker statement lots[${i}] must be an object.`);
  }
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (k !== 'ticker' && k !== 'currency' && k !== 'holding') {
      throw new Error(`Broker statement lots[${i}]: unknown field "${k}".`);
    }
  }
  if (typeof r.ticker !== 'string' || !r.ticker.trim()) {
    throw new Error(`Broker statement lots[${i}].ticker is required.`);
  }
  const ticker = r.ticker.trim().toUpperCase();
  if (ticker.includes(HOLDING_KEY_CHANNEL_SEP)) {
    throw new Error(
      `Broker statement lots[${i}].ticker must be the base key without "${HOLDING_KEY_CHANNEL_SEP}channel" (got "${r.ticker}"). Channel comes from the catalog connector.`,
    );
  }
  if (typeof r.currency !== 'string' || !/^[A-Z]{3,4}$/.test(r.currency.trim().toUpperCase())) {
    throw new Error(`Broker statement lots[${i}].currency must be a 3–4 letter code.`);
  }
  if (r.holding == null || typeof r.holding !== 'object' || Array.isArray(r.holding)) {
    throw new Error(`Broker statement lots[${i}].holding must be a Holding object.`);
  }
  const holding = r.holding as Holding;
  assertHolding(ticker, holding);
  return { ticker, currency: r.currency.trim().toUpperCase(), holding };
}

function assertSkip(raw: unknown, i: number): BrokerSkip {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Broker statement skipped[${i}] must be an object.`);
  }
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'position' && r.kind !== 'cash') {
    throw new Error(`Broker statement skipped[${i}].kind must be position or cash.`);
  }
  if (typeof r.reason !== 'string' || !r.reason.trim()) {
    throw new Error(`Broker statement skipped[${i}].reason is required.`);
  }
  const skip: BrokerSkip = { kind: r.kind, reason: r.reason.trim() };
  if (r.symbol != null) {
    if (typeof r.symbol !== 'string' || !r.symbol.trim()) {
      throw new Error(`Broker statement skipped[${i}].symbol must be a non-empty string when set.`);
    }
    skip.symbol = r.symbol.trim();
  }
  if (r.currency != null) {
    if (typeof r.currency !== 'string' || !r.currency.trim()) {
      throw new Error(`Broker statement skipped[${i}].currency must be a non-empty string when set.`);
    }
    skip.currency = r.currency.trim();
  }
  return skip;
}

export function assertBrokerStatement(raw: unknown): BrokerStatement {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Broker statement must be an object.');
  }
  const o = raw as Record<string, unknown>;
  rejectVendorShape(o);
  const allowed = new Set(['account_id', 'as_of', 'from_date', 'cash', 'lots', 'skipped', 'metrics']);
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) {
      throw new Error(`Broker statement: unknown field "${k}".`);
    }
  }
  if (typeof o.account_id !== 'string' || !o.account_id.trim()) {
    throw new Error('Broker statement account_id is required.');
  }
  if (typeof o.as_of !== 'string' || !o.as_of.trim()) {
    throw new Error('Broker statement as_of is required.');
  }
  if (!Array.isArray(o.cash) || o.cash.length === 0) {
    throw new Error('Broker statement cash must be a non-empty array of currency sleeves.');
  }
  if (!Array.isArray(o.lots)) {
    throw new Error('Broker statement lots must be an array (empty allowed).');
  }
  const cash = o.cash.map((row, i) => assertCashSleeve(row, i));
  const lots = o.lots.map((row, i) => assertLot(row, i));
  const seenTicker = new Set<string>();
  for (const lot of lots) {
    if (seenTicker.has(lot.ticker)) {
      throw new Error(`Broker statement: duplicate lot ticker "${lot.ticker}".`);
    }
    seenTicker.add(lot.ticker);
  }
  const seenCcy = new Set<string>();
  for (const row of cash) {
    if (seenCcy.has(row.currency)) {
      throw new Error(`Broker statement: duplicate cash currency "${row.currency}".`);
    }
    seenCcy.add(row.currency);
  }
  const skipped: BrokerSkip[] = [];
  if (o.skipped != null) {
    if (!Array.isArray(o.skipped)) throw new Error('Broker statement skipped must be an array when set.');
    o.skipped.forEach((s, i) => skipped.push(assertSkip(s, i)));
  }
  const doc: BrokerStatement = {
    account_id: o.account_id.trim(),
    as_of: requireYmd(o.as_of, 'as_of'),
    cash,
    lots,
    skipped,
  };
  if (o.from_date != null) {
    if (typeof o.from_date !== 'string' || !o.from_date.trim()) {
      throw new Error('Broker statement from_date must be a date when set.');
    }
    doc.from_date = requireYmd(o.from_date, 'from_date');
  }
  if (o.metrics != null) {
    doc.metrics = assertBrokerConnectionMetrics(o.metrics, 'Broker statement metrics');
  }
  return doc;
}
