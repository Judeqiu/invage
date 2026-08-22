/**
 * Canonical broker statement — connector-agnostic apply input.
 * Catalog parsers (IBKR Flex XML) and generated mapping specs both emit this.
 */

import type { FlexCashRow, FlexOpenPosition, FlexSkip, FlexStatementDoc } from '../ibkr/flex-parse.js';

export interface BrokerStatement {
  accountId: string;
  fromDate: string;
  toDate: string;
  whenGenerated?: string;
  period?: string;
  openPositions: FlexOpenPosition[];
  cash: FlexCashRow[];
  skipped: FlexSkip[];
}

export function brokerStatementFromFlex(doc: FlexStatementDoc): BrokerStatement {
  const out: BrokerStatement = {
    accountId: doc.accountId,
    fromDate: doc.fromDate,
    toDate: doc.toDate,
    openPositions: doc.openPositions,
    cash: doc.cash,
    skipped: doc.skipped,
  };
  if (doc.whenGenerated) out.whenGenerated = doc.whenGenerated;
  if (doc.period) out.period = doc.period;
  return out;
}

export function flexDocFromBrokerStatement(doc: BrokerStatement): FlexStatementDoc {
  const out: FlexStatementDoc = {
    accountId: doc.accountId,
    fromDate: doc.fromDate,
    toDate: doc.toDate,
    openPositions: doc.openPositions,
    cash: doc.cash,
    skipped: doc.skipped,
  };
  if (doc.whenGenerated) out.whenGenerated = doc.whenGenerated;
  if (doc.period) out.period = doc.period;
  return out;
}

function requireYmd(value: string, field: string): string {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`Broker statement ${field}: expected YYYY-MM-DD or YYYYMMDD, got "${value}"`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function assertBrokerStatement(raw: unknown): BrokerStatement {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Broker statement must be an object.');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.accountId !== 'string' || !o.accountId.trim()) {
    throw new Error('Broker statement accountId is required.');
  }
  if (typeof o.fromDate !== 'string' || !o.fromDate.trim()) {
    throw new Error('Broker statement fromDate is required.');
  }
  if (typeof o.toDate !== 'string' || !o.toDate.trim()) {
    throw new Error('Broker statement toDate is required.');
  }
  if (!Array.isArray(o.cash) || o.cash.length === 0) {
    throw new Error('Broker statement cash must be a non-empty array of currency sleeves.');
  }
  if (!Array.isArray(o.openPositions)) {
    throw new Error('Broker statement openPositions must be an array (empty allowed).');
  }
  const cash: FlexCashRow[] = o.cash.map((row, i) => {
    if (row == null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Broker statement cash[${i}] must be an object.`);
    }
    const r = row as Record<string, unknown>;
    if (typeof r.currency !== 'string' || !/^[A-Z]{3,4}$/.test(r.currency.trim().toUpperCase())) {
      throw new Error(`Broker statement cash[${i}].currency must be a 3–4 letter code.`);
    }
    if (typeof r.endingCash !== 'number' || !Number.isFinite(r.endingCash) || r.endingCash < 0) {
      throw new Error(`Broker statement cash[${i}].endingCash must be a finite number ≥ 0.`);
    }
    return { currency: r.currency.trim().toUpperCase(), endingCash: r.endingCash };
  });
  const openPositions: FlexOpenPosition[] = o.openPositions.map((row, i) => {
    if (row == null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`Broker statement openPositions[${i}] must be an object.`);
    }
    const r = row as Record<string, unknown>;
    const quantity = r.quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
      throw new Error(`Broker statement openPositions[${i}].quantity must be a finite number.`);
    }
    const req = (key: string): string => {
      const v = r[key];
      if (typeof v !== 'string' || !v.trim()) {
        throw new Error(`Broker statement openPositions[${i}].${key} is required.`);
      }
      return v.trim();
    };
    const pos: FlexOpenPosition = {
      accountId: req('accountId'),
      currency: req('currency').toUpperCase(),
      assetCategory: req('assetCategory').toUpperCase(),
      symbol: req('symbol'),
      quantity,
      raw: {},
    };
    if (typeof r.listingExchange === 'string' && r.listingExchange.trim()) {
      pos.listingExchange = r.listingExchange.trim();
    }
    for (const numKey of [
      'multiplier',
      'costBasisPrice',
      'costBasisMoney',
      'markPrice',
      'positionValue',
      'strike',
    ] as const) {
      const v = r[numKey];
      if (v == null) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`Broker statement openPositions[${i}].${numKey} must be a finite number when set.`);
      }
      pos[numKey] = v;
    }
    if (typeof r.expiry === 'string' && r.expiry.trim()) pos.expiry = r.expiry.trim();
    if (typeof r.putCall === 'string' && r.putCall.trim()) pos.putCall = r.putCall.trim();
    if (typeof r.underlyingSymbol === 'string' && r.underlyingSymbol.trim()) {
      pos.underlyingSymbol = r.underlyingSymbol.trim();
    }
    if (typeof r.conid === 'string' && r.conid.trim()) pos.conid = r.conid.trim();
    return pos;
  });
  const skipped: FlexSkip[] = [];
  if (o.skipped != null) {
    if (!Array.isArray(o.skipped)) throw new Error('Broker statement skipped must be an array when set.');
    for (const s of o.skipped) {
      if (s == null || typeof s !== 'object' || Array.isArray(s)) {
        throw new Error('Broker statement skipped[] must be objects.');
      }
      const r = s as Record<string, unknown>;
      if (r.kind !== 'position' && r.kind !== 'cash') {
        throw new Error('Broker statement skipped[].kind must be position or cash.');
      }
      if (typeof r.reason !== 'string' || !r.reason.trim()) {
        throw new Error('Broker statement skipped[].reason is required.');
      }
      const skip: FlexSkip = { kind: r.kind, reason: r.reason.trim() };
      if (typeof r.symbol === 'string' && r.symbol.trim()) skip.symbol = r.symbol.trim();
      if (typeof r.assetCategory === 'string' && r.assetCategory.trim()) {
        skip.assetCategory = r.assetCategory.trim();
      }
      if (typeof r.currency === 'string' && r.currency.trim()) skip.currency = r.currency.trim();
      skipped.push(skip);
    }
  }
  const doc: BrokerStatement = {
    accountId: o.accountId.trim(),
    fromDate: requireYmd(o.fromDate, 'fromDate'),
    toDate: requireYmd(o.toDate, 'toDate'),
    openPositions,
    cash,
    skipped,
  };
  if (typeof o.whenGenerated === 'string' && o.whenGenerated.trim()) {
    doc.whenGenerated = o.whenGenerated.trim();
  }
  if (typeof o.period === 'string' && o.period.trim()) doc.period = o.period.trim();
  return doc;
}
