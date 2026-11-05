import { retainBrokerPositionValues } from '../brokers/position-values.js';
import type { BrokerConnectionMetrics } from '../state/portfolio-state.js';
import { mapFutubullHistory } from './futubull-history.js';
import { BrokerParseError } from '../brokers/errors.js';
import { looksLikeOptionCode } from '../brokers/option-symbol.js';
import type { BrokerStatement } from '../brokers/statement.js';
import { yahooSymbolFromBroker } from '../brokers/yahoo-symbol.js';
import { assertHolding, buildHoldingKey } from '../market/position-value.js';
import { invalidCashSkip, invalidCostSkip } from '../brokers/snapshot-validation.js';

const cashFields: Record<string, string> = {
  us_cash: 'USD', hk_cash: 'HKD', cn_cash: 'CNH', jp_cash: 'JPY', sg_cash: 'SGD',
  au_cash: 'AUD', ca_cash: 'CAD', my_cash: 'MYR',
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BrokerParseError('Futubull row is invalid.');
  return value as Record<string, unknown>;
}

function number(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function mapFutubullSnapshot(raw: unknown, channel: string, includeHistory = true): BrokerStatement {
  const bundle = record(raw);
  if (bundle.schema !== 'invage.futubull.raw.v1' || typeof bundle.acc_id !== 'string' ||
      !/^\d+$/.test(bundle.acc_id) || typeof bundle.fetched_at !== 'string' ||
      !Array.isArray(bundle.funds) || bundle.funds.length !== 1 || !Array.isArray(bundle.positions)) {
    throw new BrokerParseError('Futubull snapshot has an invalid shape.');
  }
  const as_of = bundle.fetched_at.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(as_of)) throw new BrokerParseError('Futubull snapshot date is invalid.');
  const funds = record(bundle.funds[0]);
  const skipped: BrokerStatement['skipped'] = [];
  const cash: BrokerStatement['cash'] = [];
  for (const [field, currency] of Object.entries(cashFields)) {
    if (!(field in funds)) continue;
    const amount = number(funds[field]);
    if (amount === undefined) { skipped.push(invalidCashSkip(currency)); continue; }
    cash.push({ currency, amount });
  }
  if (cash.length === 0 && !skipped.some(s => s.defer === 'cash')) throw new BrokerParseError('Futubull funds contain no importable per-currency cash.');
  const lots: BrokerStatement['lots'] = [];
  const seen = new Set<string>();
  for (const value of bundle.positions) {
    const row = record(value);
    const code = String(row.code ?? '').trim();
    const [market, symbol] = code.split('.', 2);
    const skip = (reason: string) => skipped.push({ kind: 'position', symbol: code || undefined, reason });
    if (!market || !symbol) { skip('code is not MARKET.SYMBOL'); continue; }
    if (looksLikeOptionCode(symbol)) { skip('option position is not supported by the OpenD snapshot connector'); continue; }
    const ticker = yahooSymbolFromBroker({ market, symbol });
    if (typeof ticker !== 'string') { skip(ticker.skip); continue; }
    const currency = String(row.currency ?? '').toUpperCase();
    const qty = number(row.qty);
    const averageCost = number(row.average_cost);
    if (averageCost === undefined && row.cost_price_valid === false) { skipped.push(invalidCostSkip(code)); continue; }
    const average = averageCost ?? number(row.cost_price);
    if (!/^[A-Z]{3,4}$/.test(currency) || qty === undefined || average === undefined) {
      skip('unsupported side, currency, quantity, or cost'); continue;
    }
    const key = buildHoldingKey(ticker, channel);
    if (seen.has(key)) { skip('duplicate position key'); continue; }
    seen.add(key);
    const holding = { instrument: 'equity' as const, units: row.position_side === 'SHORT' && qty > 0 ? -qty : qty, avg_price: average, channel,
      broker_ref: { listing_exchange: market, native_id: code } };
    retainBrokerPositionValues(holding,currency,'futubull.OpenD.positions',bundle.fetched_at as string,{
      mark:number(row.nominal_price),market_value:number(row.market_val),unrealized_pl:number(row.unrealized_pl),realized_pl:number(row.realized_pl),
      ...(row.pl_val_valid === false ? {} : {position_pl:number(row.pl_val)}),...(row.pl_ratio_valid === false ? {} : {position_pl_pct:number(row.pl_ratio)}),
    });
    assertHolding(key, holding);
    lots.push({ ticker, currency, holding });
  }
  const currency = String(funds.currency ?? '').trim().toUpperCase();
  let metrics: BrokerConnectionMetrics | undefined;
  if (/^[A-Z]{3,4}$/.test(currency)) for (const [native,key] of [ ['total_assets','broker_net_assets'], ['cash','broker_cash'], ['funds_assets','fund_assets'], ['market_val','broker_market_value'] ] as const) {
    const value = number(funds[native]); if (value === undefined) continue;
    metrics ??= {as_of,currency,source_as_of:bundle.fetched_at as string}; metrics[key] = value;
  }
  return { account_id: bundle.acc_id, as_of, cash, lots, skipped, ...(metrics ? {metrics} : {}),history:includeHistory && !bundle.history_error ? mapFutubullHistory(bundle,channel) : undefined };
}
