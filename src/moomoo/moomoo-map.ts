import { BrokerParseError } from '../brokers/errors.js';
import {
  looksLikeOptionCode,
  optionUnderlyingFromBroker,
  parseBrokerOptionCode,
} from '../brokers/option-symbol.js';
import type { BrokerCashSleeve, BrokerSkip, BrokerStatement } from '../brokers/statement.js';
import { yahooSymbolFromBroker } from '../brokers/yahoo-symbol.js';
import type { Holding } from '../market/types.js';
import {
  assertHolding,
  buildHoldingKey,
  buildOptionKey,
  holdingBaseKey,
} from '../market/position-value.js';
import type { BrokerConnectionMetrics } from '../state/portfolio-state.js';
import { envelopeOk, type MooMooRawBundle } from './moomoo-types.js';

export { looksLikeOptionCode } from '../brokers/option-symbol.js';

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

function isOptionRow(item: Record<string, unknown>, symbol: string): boolean {
  const stockType = String(item.stock_type ?? item.security_type ?? '').trim().toUpperCase();
  if (stockType === 'DRVT' || stockType === 'OPTION' || stockType === 'OPT') return true;
  if (item.option_type != null || item.strike_price != null || item.strike_time != null) return true;
  return looksLikeOptionCode(symbol);
}

function ownerOf(item: Record<string, unknown>): string | undefined {
  const raw = item.stock_owner ?? item.underlying ?? item.underlying_symbol ?? item.option_owner;
  const t = raw == null ? '' : String(raw).trim();
  return t || undefined;
}

function mapOptionPosition(
  item: Record<string, unknown>,
  channel: string,
  code: string,
  market: string,
  symbol: string,
  qty: number,
  currency: string,
  seen: Set<string>,
): { lot?: BrokerStatement['lots'][number]; skip?: BrokerSkip } {
  const parsed = parseBrokerOptionCode(symbol);
  const parsedOk = !('skip' in parsed);
  const typeRaw = String(item.option_type ?? item.put_call ?? '').trim().toUpperCase();
  const right =
    typeRaw === 'P' || typeRaw === 'PUT'
      ? 'put'
      : typeRaw === 'C' || typeRaw === 'CALL'
        ? 'call'
        : parsedOk
          ? parsed.right
          : null;
  if (!right) return { skip: skipPos(code, 'option missing right') };
  const strike = parseNum(item.strike_price ?? item.strike) ?? (parsedOk ? parsed.strike : undefined);
  if (strike == null || !(strike > 0)) return { skip: skipPos(code, 'option missing strike') };
  const expiryRaw = String(item.strike_time ?? item.expiry ?? item.expire_date ?? item.expiry_date ?? '').trim();
  let expiry = expiryRaw;
  if (/^\d{8}$/.test(expiryRaw)) {
    expiry = `${expiryRaw.slice(0, 4)}-${expiryRaw.slice(4, 6)}-${expiryRaw.slice(6, 8)}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) && parsedOk) expiry = parsed.expiry;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return { skip: skipPos(code, 'option missing expiry') };
  const multiplier = parseNum(
    item.lot_size ?? item.contract_size ?? item.option_contract_multiplier ?? item.multiplier,
  );
  if (multiplier == null || !(multiplier > 0)) {
    return { skip: skipPos(code, 'option missing multiplier') };
  }
  const underlying = optionUnderlyingFromBroker({
    market,
    owner: ownerOf(item),
    optionRoot: parsedOk ? parsed.root : undefined,
  });
  if (typeof underlying !== 'string') return { skip: skipPos(code, underlying.skip) };
  const costValid = item.cost_price_valid === true;
  const costPerShare = parseNum(item.cost_price);
  if (!costValid || costPerShare == null || !(costPerShare > 0)) {
    return { skip: skipPos(code, 'cost_price is not valid') };
  }
  const markPerShare = parseNum(item.nominal_price ?? item.last_price ?? item.mark_price);
  if (markPerShare == null || !Number.isFinite(markPerShare)) {
    return { skip: skipPos(code, 'option missing mark') };
  }
  const mark = markPerShare * multiplier;
  const avg = costPerShare * multiplier;
  if (!(mark > 0) || !Number.isFinite(mark)) return { skip: skipPos(code, 'option missing mark') };
  if (!(avg > 0) || !Number.isFinite(avg)) return { skip: skipPos(code, 'cost_price is not valid') };
  const units = Math.abs(qty);
  if (!(units > 0)) return { skip: skipPos(code, 'option quantity is zero') };
  const sideRaw = String(item.position_side ?? 'LONG').trim().toUpperCase();
  const side = sideRaw === 'SHORT' || qty < 0 ? 'short' : 'long';
  const base = buildOptionKey({ underlying, right, strike, expiry, side });
  const mapKey = buildHoldingKey(base, channel);
  if (seen.has(mapKey)) return { skip: skipPos(base, 'duplicate map key') };
  seen.add(mapKey);
  const holding: Holding = {
    instrument: 'option',
    units,
    avg_price: avg,
    channel,
    option: {
      right,
      side,
      strike,
      expiry,
      multiplier,
      underlying,
      settlement: 'physical',
      mark,
    },
    broker_ref: { listing_exchange: market, native_id: code },
  };
  assertHolding(mapKey, holding);
  return { lot: { ticker: holdingBaseKey(mapKey), currency, holding } };
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
  const dot = code.indexOf('.');
  if (dot <= 0) return { skip: skipPos(code, 'code is not MARKET.SYMBOL') };
  const market = code.slice(0, dot).toUpperCase();
  const symbol = code.slice(dot + 1);
  if (SKIP_MARKETS.has(market)) {
    return { skip: skipPos(code, `market ${market} is not imported`) };
  }
  const currency = String(item.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(currency)) return { skip: skipPos(code, 'missing currency') };
  if (isOptionRow(item, symbol)) {
    if (qty === 0) return { skip: skipPos(code, 'option quantity is zero') };
    return mapOptionPosition(item, channel, code, market, symbol, qty, currency, seen);
  }
  if (side === 'SHORT' || !(qty > 0)) {
    return { skip: skipPos(code, `short or non-positive qty (${qty}) is not imported`) };
  }
  const yahoo = yahooSymbolFromBroker({ market, symbol });
  if (typeof yahoo !== 'string') return { skip: skipPos(code, yahoo.skip) };
  const costValid = item.cost_price_valid === true;
  const avg = parseNum(item.cost_price);
  if (!costValid || avg == null || !(avg > 0)) {
    return { skip: skipPos(code, 'cost_price is not valid') };
  }
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
