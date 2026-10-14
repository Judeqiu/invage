import { decimal,addDecimals } from '../brokers/option-executions.js';
import { looksLikeOptionCode, parseBrokerOptionCode, optionUnderlyingFromBroker } from '../brokers/option-symbol.js';
import { yahooSymbolFromBroker } from '../brokers/yahoo-symbol.js';
import { assertBrokerHistory, type BrokerHistory, type BrokerHistoryGap, type BrokerHistoryOrder } from '../brokers/history.js';
import type { BrokerLot } from '../brokers/statement.js';
import type { MooMooRawBundle } from './moomoo-types.js';
import { BrokerParseError } from '../brokers/errors.js';

function string(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new BrokerParseError('Moomoo history identifier/text is missing');
  return v;
}
function number(v: unknown): string {
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new BrokerParseError('Moomoo history numeric metadata is not exact');
  return decimal(String(v));
}
function optionalNumber(v: unknown): string | null {
  return v == null || typeof v === 'string' && !v.trim() ? null : number(v);
}
function positive(v: unknown): string {
  const value = number(v);
  if (value.startsWith('-') || !/[1-9]/.test(value)) throw new BrokerParseError('Moomoo history size must be positive');
  return value;
}
function multiply(...values: string[]): string {
  let product = 1n, scale = 0;
  for (const value of values) { decimal(value); scale += value.split('.')[1]?.length ?? 0; product *= BigInt(value.replace('.', '')); }
  const digits = product.toString().padStart(scale + 1, '0');
  return scale ? `${digits.slice(0,-scale)}.${digits.slice(-scale)}` : digits;
}
export function moomooMarketTime(raw: unknown, market: string): string {
  if (!/^\d+$/.test(String(raw))) throw new BrokerParseError('Moomoo history time must be epoch microseconds');
  const date = new Date(Number(BigInt(String(raw)) / 1000n));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: market === 'US' ? 'America/New_York' : 'Asia/Hong_Kong',
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(date);
  const p = (type: string) => parts.find(v => v.type === type)!.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
}
function action(value: unknown): { side: 'buy' | 'sell'; effect: 'open' | 'close' | 'unknown' } {
  const actions = { BUY: { side:'buy',effect:'open' }, SELL: { side:'sell',effect:'close' },
    SELL_SHORT: { side:'sell',effect:'open' }, BUY_BACK: { side:'buy',effect:'close' } } as const;
  const out = actions[String(value) as keyof typeof actions];
  if (!out) throw new BrokerParseError('Unknown Moomoo history direction');
  return out;
}

/** One metadata resolver is shared by imports and archived roll/spread readers. */
export function moomooContractMetadata(bundle: MooMooRawBundle, lots: BrokerLot[] = [], verifiedMultipliers?: ReadonlyMap<string,string>) {
  const metadata = new Map<string, { multiplier: string; owner?: string }>();
  const put = (code: string, size: unknown, owner?: unknown) => {
    const multiplier = positive(size), prior = metadata.get(code);
    if (prior && !/^0(?:\.0+)?$/.test(addDecimals(prior.multiplier,`-${multiplier}`))) throw new BrokerParseError(`Conflicting exact-contract metadata for ${code}`);
    metadata.set(code, { multiplier, owner: owner == null ? prior?.owner : String(owner) });
  };
  for (const [code,multiplier] of verifiedMultipliers ?? []) put(code,multiplier);
  const seen = new Set<string>();
  for (const info of bundle.option_basicinfo ?? []) {
    if (info.stock_type !== 'DRVT') continue;
    const code = string(info.code);
    if (seen.has(code)) throw new BrokerParseError(`Ambiguous exact-contract metadata for ${code}`);
    seen.add(code); put(code, info.contract_size ?? info.lot_size, info.stock_owner);
  }
  for (const row of Array.isArray(bundle.positions?.d) ? bundle.positions.d : []) {
    const size = row.contract_size ?? row.lot_size ?? row.option_contract_multiplier ?? row.multiplier;
    if (size != null && looksLikeOptionCode(String(row.code).split('.').slice(1).join('.'))) put(string(row.code),size,row.stock_owner);
  }
  for (const lot of lots) if (lot.holding.option && lot.holding.broker_ref?.native_id) put(lot.holding.broker_ref.native_id, String(lot.holding.option.multiplier));
  for (const order of bundle.orders_details ?? []) {
    const info = order.multi_leg_info as { leg_infos?: Record<string, unknown>[] } | undefined;
    for (const leg of info?.leg_infos ?? []) {
      if (leg.leg_security_type !== 'OPTION' || leg.leg_hp_multiplier == null) continue;
      put(string(leg.leg_code), leg.leg_hp_multiplier);
    }
  }
  return metadata;
}

export function mapMooMooHistory(bundle: MooMooRawBundle, lots: BrokerLot[], channel: string): BrokerHistory | undefined {
  if (!bundle.fills_history) return undefined;
  const bound = { broker_id:'moomoo', channel, account_id:bundle.acc_id };
  const metadata = moomooContractMetadata(bundle, lots), gaps: BrokerHistoryGap[] = [];
  const assertAccount = (row: Record<string, unknown>) => {
    const account = row.account_id ?? row.acc_id;
    if (account != null && String(account) !== bundle.acc_id) throw new BrokerParseError('Moomoo historical record account mismatch');
  };
  const gap = (kind: BrokerHistoryGap['kind'], reference: string | null, reason: string) => {
    if (!gaps.some(g => g.kind === kind && g.reference === reference)) gaps.push({ kind, reference, reason });
  };
  const executions = bundle.fills_history.rows.map(row => {
    assertAccount(row);
    const code = string(row.code), market = code.slice(0,code.indexOf('.')), native = code.slice(code.indexOf('.')+1);
    if (!['US','HK'].includes(market) || !native) throw new BrokerParseError('Unsupported Moomoo history market');
    if (row.status !== 'OK') throw new BrokerParseError(`Moomoo fill ${row.deal_id}: Changed or cancelled fills require reconciliation`);
    const direction = action(row.trd_side), isOption = looksLikeOptionCode(native);
    const quantity = positive(row.qty), price = number(row.price);
    if (price.startsWith('-')) throw new BrokerParseError('Moomoo fill price must not be negative');
    const parsed = isOption ? parseBrokerOptionCode(native) : null;
    if (parsed && 'skip' in parsed) throw new BrokerParseError(parsed.skip);
    const info = metadata.get(code), multiplier = isOption ? info?.multiplier ?? null : '1';
    const underlying = isOption ? optionUnderlyingFromBroker({ market, optionRoot: parsed && !('skip' in parsed) ? parsed.root : undefined, owner:info?.owner }) : yahooSymbolFromBroker({ market, symbol:native });
    const symbol = typeof underlying === 'string' ? underlying : null;
    if (!multiplier) gap('metadata', code, 'Exact historical contract multiplier unavailable; execution retained with unknown cash.');
    else if (!symbol) gap('metadata',code,'Historical underlying unavailable; execution retained outside the verified option projection.');
    const gross = multiplier ? multiply(price, quantity, multiplier) : null;
    return { ...bound, id:string(row.deal_id), order_id:row.order_id == null ? null : string(row.order_id), native_symbol:code,
      symbol, instrument:isOption ? 'option' as const : 'security' as const, side:direction.side, effect:isOption ? direction.effect : 'unknown' as const,
      executed_at:moomooMarketTime(row.create_time,market), clock:market === 'US' ? 'America/New_York' : 'Asia/Hong_Kong',
      currency:market === 'US' ? 'USD' : 'HKD', quantity, price, multiplier, gross_cash:gross === null ? null : direction.side === 'buy' ? `-${gross}` : gross,
      fee_cash:null, option:parsed && !('skip' in parsed) ? { right:parsed.right, expiry:parsed.expiry, strike:String(parsed.strike) } : null };
  });
  const orders = new Map<string, BrokerHistoryOrder>();
  for (const row of [...(bundle.orders_history?.rows ?? []), ...(bundle.orders_details ?? [])]) {
    assertAccount(row);
    const code = string(row.code), market = String(row.exchange ?? code.split('.')[0]);
    const info = row.multi_leg_info as { leg_infos?: Record<string, unknown>[] } | undefined;
    const legs = (info?.leg_infos ?? []).map(l => ({ native_symbol:string(l.leg_code), ...action(l.leg_side), ratio:positive(l.leg_ratio_qty), multiplier:l.leg_hp_multiplier == null ? null : positive(l.leg_hp_multiplier) }));
    const mapped: BrokerHistoryOrder = { ...bound, id:string(row.order_id), native_symbol:code, side:row.side === 'BUY' ? 'buy' : row.side === 'SELL' ? 'sell' : 'unknown',
      status:string(row.order_status), created_at:moomooMarketTime(row.create_time,market), updated_at:moomooMarketTime(row.updated_time ?? row.create_time,market),
      clock:market === 'US' ? 'America/New_York' : 'Asia/Hong_Kong', currency:row.currency == null ? null : string(row.currency), quantity:optionalNumber(row.qty),
      limit_price:optionalNumber(row.price), filled_quantity:optionalNumber(row.dealt_qty), filled_price:optionalNumber(row.dealt_avg_price),
      order_type:string(row.order_type), time_in_force:row.time_in_force == null ? null : string(row.time_in_force), session:row.session == null ? null : string(row.session), legs };
    const prior = orders.get(mapped.id);
    if (!prior || mapped.updated_at >= prior.updated_at) orders.set(mapped.id,mapped);
  }
  for (const row of bundle.orders_details ?? []) {
    const info = row.multi_leg_info as { leg_infos?: unknown[] } | undefined;
    if (row.security_type === 'MULTILEG_OPTION' && !info?.leg_infos?.length) gap('orders',string(row.order_id),'Historical multi-leg order details have no leg metadata.');
  }
  if (!bundle.orders_history) gap('orders',null,'Historical parent orders have not been retrieved.');
  for (const problem of bundle.history_gaps ?? []) gap('orders',problem.reference,problem.reason);
  const from = new Date(Number(BigInt(bundle.fills_history.start)/1000n)).toISOString();
  const through = new Date(Number(BigInt(bundle.fills_history.end)/1000n)).toISOString();
  const mode = bundle.history_mode ?? 'full';
  return assertBrokerHistory({ ...bound, executions, orders:[...orders.values()], sync:{ version:1, mode, from, through,
    status:gaps.length ? 'partial' : 'complete', full_history_synced:mode === 'full' && !gaps.length, fees:'unavailable', gaps } });
}
