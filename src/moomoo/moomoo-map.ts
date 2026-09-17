import { BrokerParseError } from '../brokers/errors.js';
import type { BrokerCashSleeve, BrokerSkip, BrokerStatement } from '../brokers/statement.js';
import { yahooSymbolFromBroker } from '../brokers/yahoo-symbol.js';
import type { Holding } from '../market/types.js';
import { assertHolding, buildHoldingKey, holdingBaseKey } from '../market/position-value.js';
import type { BrokerConnectionMetrics } from '../state/portfolio-state.js';
import { envelopeOk, type MooMooRawBundle } from './moomoo-types.js';

const CASH_FIELDS: Record<string, string> = {
  us_cash: 'USD',
  hk_cash: 'HKD',
  cn_cash: 'CNH',
  jp_cash: 'JPY',
  sg_cash: 'SGD',
  kr_cash: 'KRW',
  my_cash: 'MYR',
  au_cash: 'AUD',
};

const SKIP_MARKETS = new Set(['CA', 'BMS', 'CC', 'SH', 'SZ', 'BJ']);

export function parseNum(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function skipPos(symbol: string | undefined, reason: string): BrokerSkip {
  const s: BrokerSkip = { kind: 'position', reason };
  if (symbol) s.symbol = symbol;
  return s;
}

/** Option OCC-style codes are not mapped in v1 (no OptionSpec fixture). */
export function looksLikeOptionCode(symbol: string): boolean {
  return /\d{6}[CP]/i.test(symbol);
}

function mapFunds(d: unknown, asOf: string, skipped: BrokerSkip[]): {
  cash: BrokerCashSleeve[];
  metrics?: BrokerConnectionMetrics;
} {
  const rec = asRecord(d);
  if (!rec) return { cash: [] };
  const cash: BrokerCashSleeve[] = [];
  for (const [field, iso] of Object.entries(CASH_FIELDS)) {
    const amount = parseNum(rec[field]);
    if (amount == null) continue;
    if (amount < 0) {
      skipped.push({ kind: 'cash', currency: iso, reason: `negative cash ${amount}` });
      continue;
    }
    cash.push({ currency: iso, amount });
  }
  const power = parseNum(rec.power);
  const maintenance_margin = parseNum(rec.maintenance_margin);
  const currency = 'USD';
  let metrics: BrokerConnectionMetrics | undefined;
  if (power != null || maintenance_margin != null) {
    if ((power == null || power >= 0) && (maintenance_margin == null || maintenance_margin >= 0)) {
      metrics = { as_of: asOf, currency };
      if (power != null && power >= 0) metrics.buying_power = power;
      if (maintenance_margin != null && maintenance_margin >= 0) {
        metrics.maintenance_margin = maintenance_margin;
      }
    }
  }
  return { cash, metrics };
}

function mapPosition(
  item: Record<string, unknown>,
  channel: string,
  seen: Set<string>,
): { lot?: BrokerStatement['lots'][number]; skip?: BrokerSkip } {
  const code = String(item.code ?? '').trim();
  const side = String(item.position_side ?? 'LONG').trim().toUpperCase();
  const qty = parseNum(item.qty);
  if (!code) return { skip: skipPos(undefined, 'missing code') };
  if (qty == null) return { skip: skipPos(code, 'non-finite quantity') };
  if (side === 'SHORT' || !(qty > 0)) {
    return { skip: skipPos(code, `short or non-positive qty (${qty}) is not imported`) };
  }
  const dot = code.indexOf('.');
  if (dot <= 0) return { skip: skipPos(code, 'code is not MARKET.SYMBOL') };
  const market = code.slice(0, dot).toUpperCase();
  const symbol = code.slice(dot + 1);
  if (SKIP_MARKETS.has(market)) {
    return { skip: skipPos(code, `market ${market} is not imported`) };
  }
  if (looksLikeOptionCode(symbol)) {
    return { skip: skipPos(code, 'option code not mapped') };
  }
  const yahoo = yahooSymbolFromBroker({ market, symbol });
  if (typeof yahoo !== 'string') return { skip: skipPos(code, yahoo.skip) };
  const costValid = item.cost_price_valid === true;
  const avg = parseNum(item.cost_price);
  if (!costValid || avg == null || !(avg > 0)) {
    return { skip: skipPos(code, 'cost_price is not valid') };
  }
  const currency = String(item.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(currency)) return { skip: skipPos(code, 'missing currency') };
  const mapKey = buildHoldingKey(yahoo, channel);
  if (seen.has(mapKey)) return { skip: skipPos(yahoo, 'duplicate map key') };
  seen.add(mapKey);
  const holding: Holding = {
    instrument: 'equity',
    units: qty,
    avg_price: avg,
    channel,
    broker_ref: { listing_exchange: market },
  };
  assertHolding(mapKey, holding);
  return { lot: { ticker: holdingBaseKey(mapKey), currency, holding } };
}

export function mapMooMooBundleToStatement(bundle: MooMooRawBundle, channel: string): BrokerStatement {
  if (bundle.schema !== 'invage.moomoo.raw.v1') {
    throw new BrokerParseError('MooMoo raw bundle schema is not invage.moomoo.raw.v1.');
  }
  if (!envelopeOk(bundle.funds) || !envelopeOk(bundle.positions)) {
    throw new BrokerParseError('MooMoo funds/positions envelope is not ok.');
  }
  const as_of = bundle.fetched_at.slice(0, 10);
  const skipped: BrokerSkip[] = [];
  const { cash, metrics } = mapFunds(bundle.funds.d, as_of, skipped);
  if (cash.length === 0) {
    throw new BrokerParseError('MooMoo funds have no importable cash sleeves.');
  }
  const rows = Array.isArray(bundle.positions.d) ? bundle.positions.d : [];
  const lots: BrokerStatement['lots'] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row == null || typeof row !== 'object' || Array.isArray(row)) continue;
    const got = mapPosition(row as Record<string, unknown>, channel, seen);
    if (got.skip) skipped.push(got.skip);
    else if (got.lot) lots.push(got.lot);
  }
  const statement: BrokerStatement = {
    account_id: bundle.acc_id,
    as_of,
    cash,
    lots,
    skipped,
  };
  if (metrics) statement.metrics = metrics;
  return statement;
}
