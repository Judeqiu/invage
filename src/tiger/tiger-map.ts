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
import { envelopeOk, type TigerGatewayEnvelope, type TigerRawBundle } from './tiger-types.js';
import { BrokerParseError } from '../brokers/errors.js';

export function parseNum(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function pick(item: Record<string, unknown>, ...keys: string[]): unknown {
  const nested =
    item.contract && typeof item.contract === 'object' && !Array.isArray(item.contract)
      ? (item.contract as Record<string, unknown>)
      : undefined;
  for (const k of keys) {
    if (item[k] != null) return item[k];
    if (nested?.[k] != null) return nested[k];
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function positionItems(data: unknown): Record<string, unknown>[] {
  const items = Array.isArray(data) ? data : asRecord(data)?.items;
  if (!Array.isArray(items)) {
    throw new BrokerParseError('positions data has no items array');
  }
  return items.filter((x): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x));
}

function ymdExpiry(raw: string): string | undefined {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function qtyOf(item: Record<string, unknown>): number | undefined {
  const pq = parseNum(item.positionQty ?? item.position_qty);
  if (pq != null) return pq;
  const q = parseNum(item.quantity);
  const scale = parseNum(item.positionScale ?? item.position_scale);
  if (q == null) return undefined;
  if (scale != null) return q / 10 ** scale;
  return q;
}

function skipPos(symbol: string | undefined, reason: string): BrokerSkip {
  const s: BrokerSkip = { kind: 'position', reason };
  if (symbol) s.symbol = symbol;
  return s;
}

function mapOnePosition(
  item: Record<string, unknown>,
  channel: string,
  seen: Set<string>,
): { lot?: { ticker: string; currency: string; holding: Holding }; skip?: BrokerSkip } {
  const symbol = String(pick(item, 'symbol') ?? '').trim();
  const secType = String(pick(item, 'secType', 'sec_type') ?? '').trim().toUpperCase();
  const market = String(pick(item, 'market') ?? '').trim();
  const currency = String(pick(item, 'currency') ?? '').trim().toUpperCase();
  const qty = qtyOf(item);
  if (!currency || !/^[A-Z]{3,4}$/.test(currency)) {
    return { skip: skipPos(symbol || undefined, 'missing currency') };
  }
  if (qty == null || !Number.isFinite(qty)) {
    return { skip: skipPos(symbol || undefined, 'non-finite quantity') };
  }
  if (secType === 'FUT' || (secType && secType !== 'STK' && secType !== 'OPT' && secType !== 'FUND')) {
    return { skip: skipPos(symbol || undefined, `secType ${secType} is not imported`) };
  }
  if (secType === 'STK' || secType === '') {
    if (!(qty > 0)) return { skip: skipPos(symbol || undefined, `short stock (${qty}) is not supported on the books`) };
    const yahoo = yahooSymbolFromBroker({ market: market || 'US', symbol });
    if (typeof yahoo !== 'string') return { skip: skipPos(symbol || undefined, yahoo.skip) };
    const avg = parseNum(item.averageCost ?? item.average_cost);
    if (avg == null || !(avg > 0)) return { skip: skipPos(yahoo, 'missing averageCost') };
    const mapKey = buildHoldingKey(yahoo, channel);
    if (seen.has(mapKey)) return { skip: skipPos(yahoo, 'duplicate map key') };
    seen.add(mapKey);
    const holding: Holding = {
      instrument: 'equity',
      units: qty,
      avg_price: avg,
      channel,
    };
    if (market) holding.broker_ref = { listing_exchange: market.toUpperCase() };
    assertHolding(mapKey, holding);
    return { lot: { ticker: holdingBaseKey(mapKey), currency, holding } };
  }
  if (secType === 'FUND') {
    if (!(qty > 0)) return { skip: skipPos(symbol || undefined, `short fund (${qty}) is not supported`) };
    const yahoo = yahooSymbolFromBroker({ market: market || 'US', symbol });
    if (typeof yahoo !== 'string') return { skip: skipPos(symbol || undefined, yahoo.skip) };
    const avg = parseNum(item.averageCost ?? item.average_cost);
    const mark = parseNum(item.latestPrice ?? item.latest_price);
    if (avg == null || !(avg > 0)) return { skip: skipPos(yahoo, 'missing averageCost') };
    if (mark == null || !Number.isFinite(mark)) return { skip: skipPos(yahoo, 'fund missing mark') };
    const mapKey = buildHoldingKey(yahoo, channel);
    if (seen.has(mapKey)) return { skip: skipPos(yahoo, 'duplicate map key') };
    seen.add(mapKey);
    const holding: Holding = {
      instrument: 'fund',
      units: qty,
      avg_price: avg,
      channel,
      fund: { quote_source: 'manual', mark, name: symbol },
    };
    if (market) holding.broker_ref = { listing_exchange: market.toUpperCase() };
    assertHolding(mapKey, holding);
    return { lot: { ticker: holdingBaseKey(mapKey), currency, holding } };
  }
  const rightRaw = String(pick(item, 'right', 'putCall') ?? '').trim().toUpperCase();
  const right = rightRaw === 'P' || rightRaw === 'PUT' ? 'put' : rightRaw === 'C' || rightRaw === 'CALL' ? 'call' : null;
  if (!right) return { skip: skipPos(symbol || undefined, 'option missing right') };
  const strike = parseNum(pick(item, 'strike'));
  if (strike == null || !(strike > 0)) return { skip: skipPos(symbol || undefined, 'option missing strike') };
  const expiryRaw = String(pick(item, 'expiry') ?? '').trim();
  const expiry = ymdExpiry(expiryRaw);
  if (!expiry) return { skip: skipPos(symbol || undefined, 'option missing expiry') };
  const multiplier = parseNum(pick(item, 'multiplier'));
  if (multiplier == null || !(multiplier > 0)) {
    return { skip: skipPos(symbol || undefined, 'option missing multiplier') };
  }
  const underlying = String(
    pick(item, 'underlyingSymbol', 'underlying_symbol') ?? item.identifier ?? '',
  ).trim().toUpperCase();
  if (!underlying || underlying === String(symbol).toUpperCase() && !pick(item, 'underlyingSymbol', 'underlying_symbol') && !item.identifier) {
    if (!pick(item, 'underlyingSymbol', 'underlying_symbol') && item.identifier == null) {
      return { skip: skipPos(symbol || undefined, 'option missing underlying') };
    }
  }
  if (!underlying) return { skip: skipPos(symbol || undefined, 'option missing underlying') };
  const latest = parseNum(item.latestPrice ?? item.latest_price);
  if (latest == null) return { skip: skipPos(symbol || undefined, 'option missing mark') };
  const mark = latest * multiplier;
  if (!Number.isFinite(mark)) return { skip: skipPos(symbol || undefined, 'option missing mark') };
  const avg = parseNum(item.averageCost ?? item.average_cost);
  if (avg == null || !(avg > 0)) return { skip: skipPos(symbol || undefined, 'missing averageCost') };
  const side = qty < 0 ? 'short' : 'long';
  const units = Math.abs(qty);
  if (!(units > 0)) return { skip: skipPos(symbol || undefined, 'option quantity is zero') };
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
  };
  if (market) holding.broker_ref = { listing_exchange: market.toUpperCase() };
  assertHolding(mapKey, holding);
  return { lot: { ticker: holdingBaseKey(mapKey), currency, holding } };
}

function mapPositionsSleeve(env: TigerGatewayEnvelope, channel: string, seen: Set<string>): {
  lots: BrokerStatement['lots'];
  skipped: BrokerSkip[];
} {
  const lots: BrokerStatement['lots'] = [];
  const skipped: BrokerSkip[] = [];
  if (!envelopeOk(env)) return { lots, skipped };
  let items: Record<string, unknown>[];
  try {
    items = positionItems(env.data);
  } catch (e) {
    throw e;
  }
  for (const item of items) {
    const got = mapOnePosition(item, channel, seen);
    if (got.skip) skipped.push(got.skip);
    else if (got.lot) lots.push(got.lot);
  }
  return { lots, skipped };
}

function currencyMap(raw: unknown): Record<string, Record<string, unknown>> {
  const rec = asRecord(raw);
  if (!rec) return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(rec)) {
    const inner = asRecord(v);
    if (inner) out[k.toUpperCase()] = inner;
  }
  return out;
}

function cashFromCurrencyAssets(
  assets: Record<string, Record<string, unknown>>,
  skipped: BrokerSkip[],
): BrokerCashSleeve[] {
  const cash: BrokerCashSleeve[] = [];
  for (const [ccy, row] of Object.entries(assets)) {
    if (!/^[A-Z]{3,4}$/.test(ccy)) continue;
    const amount = parseNum(row.cashBalance ?? row.cash_balance);
    if (amount == null) continue;
    if (amount < 0) {
      skipped.push({ kind: 'cash', currency: ccy, reason: `negative cash ${amount}` });
      continue;
    }
    cash.push({ currency: ccy, amount });
  }
  return cash;
}

function pickSegment(segments: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return asRecord(segments[key]) ?? asRecord(segments[key.toLowerCase()]);
}

function mapPrimeAssets(data: unknown, asOf: string, skipped: BrokerSkip[]): {
  cash: BrokerCashSleeve[];
  metrics?: BrokerConnectionMetrics;
} {
  const root = asRecord(data);
  const segments = asRecord(root?.segments) ?? {};
  const sec = pickSegment(segments, 'S');
  const cash = cashFromCurrencyAssets(
    currencyMap(sec?.currencyAssets ?? sec?.currency_assets),
    skipped,
  );
  let metrics: BrokerConnectionMetrics | undefined;
  if (sec) {
    const currency = String(sec.currency ?? '').trim().toUpperCase();
    const buying_power = parseNum(sec.buyingPower ?? sec.buying_power);
    const excess_liquidity = parseNum(sec.excessLiquidation ?? sec.excess_liquidation);
    const maintenance_margin = parseNum(sec.maintainMargin ?? sec.maintain_margin);
    if (/^[A-Z]{3,4}$/.test(currency) && (buying_power != null || excess_liquidity != null || maintenance_margin != null)) {
      metrics = { as_of: asOf, currency };
      if (buying_power != null && buying_power >= 0) metrics.buying_power = buying_power;
      if (excess_liquidity != null && excess_liquidity >= 0) metrics.excess_liquidity = excess_liquidity;
      if (maintenance_margin != null && maintenance_margin >= 0) metrics.maintenance_margin = maintenance_margin;
    }
  }
  return { cash, metrics };
}

function mapGlobalAssets(data: unknown, account: string, asOf: string, skipped: BrokerSkip[]): {
  cash: BrokerCashSleeve[];
  metrics?: BrokerConnectionMetrics;
} {
  const rows = Array.isArray(data) ? data : data != null ? [data] : [];
  const match =
    rows.find((r) => asRecord(r)?.account === account) ?? rows[0];
  const rec = asRecord(match);
  if (!rec) return { cash: [] };
  const marketValues = currencyMap(rec.marketValues ?? rec.market_values);
  const cash = cashFromCurrencyAssets(
    Object.fromEntries(
      Object.entries(marketValues).map(([ccy, row]) => [ccy, row]),
    ),
    skipped,
  );
  const summary = asRecord(rec.summary) ?? {};
  const currency = String(summary.currency ?? '').trim().toUpperCase();
  const buying_power = parseNum(summary.buyingPower ?? summary.buying_power);
  const excess_liquidity = parseNum(summary.excessLiquidity ?? summary.excess_liquidity);
  const maintenance_margin = parseNum(
    summary.maintenanceMarginRequirement ?? summary.maintenance_margin_requirement,
  );
  let metrics: BrokerConnectionMetrics | undefined;
  if (/^[A-Z]{3,4}$/.test(currency) && (buying_power != null || excess_liquidity != null || maintenance_margin != null)) {
    metrics = { as_of: asOf, currency };
    if (buying_power != null && buying_power >= 0) metrics.buying_power = buying_power;
    if (excess_liquidity != null && excess_liquidity >= 0) metrics.excess_liquidity = excess_liquidity;
    if (maintenance_margin != null && maintenance_margin >= 0) metrics.maintenance_margin = maintenance_margin;
  }
  return { cash, metrics };
}

export function mapTigerBundleToStatement(bundle: TigerRawBundle, channel: string): BrokerStatement {
  if (bundle.schema !== 'invage.tiger.raw.v1') {
    throw new BrokerParseError('Tiger raw bundle schema is not invage.tiger.raw.v1.');
  }
  const as_of = bundle.fetched_at.slice(0, 10);
  const skipped: BrokerSkip[] = [];
  const seen = new Set<string>();
  const stk = mapPositionsSleeve(bundle.positions.STK, channel, seen);
  const opt = mapPositionsSleeve(bundle.positions.OPT, channel, seen);
  const fund = mapPositionsSleeve(bundle.positions.FUND, channel, seen);
  skipped.push(...stk.skipped, ...opt.skipped, ...fund.skipped);
  const lots = [...stk.lots, ...opt.lots, ...fund.lots];
  const assetsData = bundle.assets.envelope.data;
  const mapped =
    bundle.assets.method === 'prime_assets'
      ? mapPrimeAssets(assetsData, as_of, skipped)
      : mapGlobalAssets(assetsData, bundle.account, as_of, skipped);
  if (mapped.cash.length === 0) {
    throw new BrokerParseError('Tiger assets have no importable cash sleeves.');
  }
  const statement: BrokerStatement = {
    account_id: bundle.account,
    as_of,
    cash: mapped.cash,
    lots,
    skipped,
  };
  if (mapped.metrics) statement.metrics = mapped.metrics;
  return statement;
}
