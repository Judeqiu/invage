import { BrokerParseError } from '../brokers/errors.js';
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
import type { WebullRawBundle, WebullRegion } from './webull-types.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseNum(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function skipPos(symbol: string | undefined, reason: string): BrokerSkip {
  const s: BrokerSkip = { kind: 'position', reason };
  if (symbol) s.symbol = symbol;
  return s;
}

/** Infer listing market when Webull only sends ticker + currency. */
export function marketForWebullSymbol(args: {
  symbol: string;
  region: WebullRegion;
  currency: string;
}): string | { skip: string } {
  const symbol = args.symbol.trim();
  if (/^\d+$/.test(symbol)) return 'HK';
  if (args.region === 'jp' && args.currency === 'JPY') return 'JP';
  if (args.region === 'sg' && args.currency === 'SGD') return 'SG';
  if (args.region === 'au' && args.currency === 'AUD') return 'AU';
  if (args.region === 'hk' && (args.currency === 'HKD' || args.currency === 'CNH')) return 'HK';
  if (args.currency === 'USD' || args.currency === '') return 'US';
  return { skip: `currency ${args.currency} is not mapped for region ${args.region}` };
}

function positionRows(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x));
  }
  const rec = asRecord(raw);
  const inner = rec?.holdings ?? rec?.data ?? rec?.positions;
  if (Array.isArray(inner)) {
    return inner.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x));
  }
  throw new BrokerParseError('Webull positions are not an array.');
}

function mapCash(balances: unknown, asOf: string, skipped: BrokerSkip[]): {
  cash: BrokerCashSleeve[];
  metrics?: BrokerConnectionMetrics;
} {
  const rec = asRecord(balances);
  if (!rec) throw new BrokerParseError('Webull balances are not an object.');
  const rows = rec.account_currency_assets;
  if (!Array.isArray(rows)) throw new BrokerParseError('Webull balances missing account_currency_assets.');
  const cash: BrokerCashSleeve[] = [];
  let buyingPower: number | undefined;
  let metricsCurrency = String(rec.total_asset_currency ?? 'USD').trim().toUpperCase() || 'USD';
  for (const row of rows) {
    const item = asRecord(row);
    if (!item) continue;
    const currency = String(item.currency ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3,4}$/.test(currency)) continue;
    const amount = parseNum(item.cash_balance);
    if (amount == null) continue;
    if (amount < 0) {
      skipped.push({ kind: 'cash', currency, reason: `negative cash ${amount}` });
      continue;
    }
    cash.push({ currency, amount });
    const bp = parseNum(item.buying_power);
    if (bp != null && bp >= 0 && (currency === 'USD' || buyingPower == null)) {
      buyingPower = bp;
      if (currency === 'USD') metricsCurrency = 'USD';
    }
  }
  let metrics: BrokerConnectionMetrics | undefined;
  if (buyingPower != null) {
    metrics = { as_of: asOf, currency: metricsCurrency, buying_power: buyingPower };
  }
  return { cash, metrics };
}

function optionLegsOf(item: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(item.legs)) return [];
  return item.legs.filter((x): x is Record<string, unknown> => {
    if (x == null || typeof x !== 'object' || Array.isArray(x)) return false;
    const t = String((x as { instrument_type?: unknown }).instrument_type ?? '').trim().toUpperCase();
    if (t === 'EQUITY' || t === 'STOCK') return false;
    return (
      t === 'OPTION' ||
      (x as { option_type?: unknown }).option_type != null ||
      (x as { option_expire_date?: unknown }).option_expire_date != null
    );
  });
}

function mapOptionPosition(
  item: Record<string, unknown>,
  channel: string,
  region: WebullRegion,
  currency: string,
  qty: number,
  seen: Set<string>,
): { lot?: BrokerStatement['lots'][number]; skip?: BrokerSkip } {
  const symbol = String(item.symbol ?? '').trim();
  const legs = optionLegsOf(item);
  if (legs.length === 0) return { skip: skipPos(symbol || undefined, 'option missing legs') };
  if (legs.length !== 1) {
    return { skip: skipPos(symbol || undefined, 'combo option lots are not imported') };
  }
  const leg = legs[0]!;
  const typeRaw = String(leg.option_type ?? '').trim().toUpperCase();
  const right = typeRaw === 'P' || typeRaw === 'PUT' ? 'put' : typeRaw === 'C' || typeRaw === 'CALL' ? 'call' : null;
  if (!right) return { skip: skipPos(symbol || undefined, 'option missing right') };
  const strike = parseNum(leg.strike_price ?? leg.option_exercise_price);
  if (strike == null || !(strike > 0)) return { skip: skipPos(symbol || undefined, 'option missing strike') };
  const expiry = String(leg.option_expire_date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return { skip: skipPos(symbol || undefined, 'option missing expiry') };
  const multiplier = parseNum(leg.option_contract_multiplier ?? item.option_contract_multiplier);
  if (multiplier == null || !(multiplier > 0)) {
    return { skip: skipPos(symbol || undefined, 'option missing multiplier') };
  }
  const underRaw = String(leg.symbol ?? item.symbol ?? '').trim();
  if (!underRaw) return { skip: skipPos(symbol || undefined, 'option missing underlying') };
  const market = marketForWebullSymbol({ symbol: underRaw, region, currency });
  if (typeof market !== 'string') return { skip: skipPos(underRaw, market.skip) };
  const underlying = yahooSymbolFromBroker({ market, symbol: underRaw });
  if (typeof underlying !== 'string') return { skip: skipPos(underRaw, underlying.skip) };
  const costPerShare = parseNum(item.cost_price);
  if (costPerShare == null || !(costPerShare > 0)) {
    return { skip: skipPos(symbol || underlying, 'cost_price is not valid') };
  }
  const markPerShare = parseNum(item.last_price);
  if (markPerShare == null || !Number.isFinite(markPerShare)) {
    return { skip: skipPos(symbol || underlying, 'option missing mark') };
  }
  const mark = markPerShare * multiplier;
  const avg = costPerShare * multiplier;
  if (!(mark > 0) || !Number.isFinite(mark)) return { skip: skipPos(symbol || underlying, 'option missing mark') };
  if (!(avg > 0) || !Number.isFinite(avg)) return { skip: skipPos(symbol || underlying, 'cost_price is not valid') };
  const units = Math.abs(qty);
  if (!(units > 0)) return { skip: skipPos(symbol || underlying, 'option quantity is zero') };
  const sideRaw = String(item.side ?? leg.side ?? '').trim().toUpperCase();
  const side = sideRaw === 'SELL' || qty < 0 ? 'short' : 'long';
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
    broker_ref: { listing_exchange: market },
  };
  const native = String(item.position_id ?? '').trim();
  if (native) holding.broker_ref = { ...holding.broker_ref, native_id: native };
  assertHolding(mapKey, holding);
  return { lot: { ticker: holdingBaseKey(mapKey), currency, holding } };
}

function mapPosition(
  item: Record<string, unknown>,
  channel: string,
  region: WebullRegion,
  seen: Set<string>,
): { lot?: BrokerStatement['lots'][number]; skip?: BrokerSkip } {
  const symbol = String(item.symbol ?? '').trim();
  const type = String(item.instrument_type ?? '').trim().toUpperCase();
  const qty = parseNum(item.quantity);
  const currency = String(item.currency ?? '').trim().toUpperCase();
  if (!symbol) return { skip: skipPos(undefined, 'missing symbol') };
  if (!/^[A-Z]{3,4}$/.test(currency)) return { skip: skipPos(symbol, 'missing currency') };
  if (qty == null) return { skip: skipPos(symbol, 'non-finite quantity') };
  if (type === 'OPTION' || optionLegsOf(item).length > 0) {
    if (qty === 0) return { skip: skipPos(symbol, 'option quantity is zero') };
    return mapOptionPosition(item, channel, region, currency, qty, seen);
  }
  if (type && type !== 'EQUITY' && type !== 'STOCK') {
    return { skip: skipPos(symbol, `instrument_type ${type} is not imported`) };
  }
  if (!(qty > 0)) return { skip: skipPos(symbol, `short or non-positive qty (${qty}) is not imported`) };
  const market = marketForWebullSymbol({ symbol, region, currency });
  if (typeof market !== 'string') return { skip: skipPos(symbol, market.skip) };
  const yahoo = yahooSymbolFromBroker({ market, symbol });
  if (typeof yahoo !== 'string') return { skip: skipPos(symbol, yahoo.skip) };
  const avg = parseNum(item.cost_price);
  if (avg == null || !(avg > 0)) return { skip: skipPos(yahoo, 'cost_price is not valid') };
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
  const native = String(item.position_id ?? '').trim();
  if (native) holding.broker_ref = { ...holding.broker_ref, native_id: native };
  assertHolding(mapKey, holding);
  return { lot: { ticker: holdingBaseKey(mapKey), currency, holding } };
}

export function mapWebullBundleToStatement(bundle: WebullRawBundle, channel: string): BrokerStatement {
  if (bundle.schema !== 'invage.webull.raw.v1') {
    throw new BrokerParseError('Webull raw bundle schema is not invage.webull.raw.v1.');
  }
  if (!bundle.account_id?.trim()) throw new BrokerParseError('Webull bundle missing account_id.');
  const asOf = bundle.fetched_at.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new BrokerParseError('Webull bundle fetched_at is not an ISO timestamp.');
  const skipped: BrokerSkip[] = [];
  const { cash, metrics } = mapCash(bundle.balances, asOf, skipped);
  if (cash.length === 0) throw new BrokerParseError('Webull balances had no importable cash sleeves.');
  const seen = new Set<string>();
  const lots: BrokerStatement['lots'] = [];
  for (const row of positionRows(bundle.positions)) {
    const mapped = mapPosition(row, channel, bundle.region, seen);
    if (mapped.lot) lots.push(mapped.lot);
    if (mapped.skip) skipped.push(mapped.skip);
  }
  const stmt: BrokerStatement = {
    account_id: bundle.account_id,
    as_of: asOf,
    cash,
    lots,
    skipped,
  };
  if (metrics) stmt.metrics = metrics;
  return stmt;
}
