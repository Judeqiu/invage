import type { BrokerLot } from '../brokers/statement.js';
import { assertOptionExecution, decimal, mergeOptionExecutions, type OptionExecution } from '../brokers/option-executions.js';
import { BrokerParseError } from '../brokers/errors.js';
import type { MooMooRawBundle } from './moomoo-types.js';
import { looksLikeOptionCode, parseBrokerOptionCode, optionUnderlyingFromBroker } from '../brokers/option-symbol.js';

function multiply(...values: string[]): string {
  let product = 1n;
  let scale = 0;
  for (const value of values) {
    decimal(value);
    const [whole, fraction = ''] = value.split('.');
    scale += fraction.length;
    product *= BigInt(whole + fraction);
  }
  const digits = product.toString().padStart(scale + 1, '0');
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}

function marketTime(raw: unknown, market: string): string {
  const text = String(raw ?? '');
  if (!/^\d+$/.test(text)) throw new Error('Fill create_time must be epoch microseconds');
  const date = new Date(Number(BigInt(text) / 1000n));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: market === 'US' ? 'America/New_York' : 'Asia/Hong_Kong',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}

/** Import all retained option fills using exact-contract metadata, including closed contracts.
 * Cloud fills omit fees; null means unknown, never a zero commission.
 */
export function mapMooMooExecutions(bundle: MooMooRawBundle, lots: BrokerLot[], channel: string): OptionExecution[] | undefined {
  if (!bundle.fills_history) return undefined;
  const contracts = new Map(lots.filter(lot => lot.holding.option && lot.holding.broker_ref?.native_id)
    .map(lot => [lot.holding.broker_ref!.native_id!, lot]));
  const executions: OptionExecution[] = [];
  for (const row of bundle.fills_history.rows) {
    const code = String(row.code ?? '');
    const [market, symbol] = code.split('.');
    if (!looksLikeOptionCode(symbol ?? '')) continue;
    const lot = contracts.get(code);
    try {
      if (row.status !== 'OK') throw new Error('Changed or cancelled fills require reconciliation');
      const actions: Record<string, [OptionExecution['side'], OptionExecution['effect']]> = {
        BUY: ['buy', 'open'], SELL: ['sell', 'close'],
        SELL_SHORT: ['sell', 'open'], BUY_BACK: ['buy', 'close'],
      };
      const action = actions[String(row.trd_side)];
      if (!action) throw new Error('Unknown option trading direction');
      const profiles = (bundle.option_basicinfo ?? []).filter(info => info.code === code && info.stock_type === 'DRVT');
      if (profiles.length > 1) throw new Error('Ambiguous exact-contract metadata');
      const info = profiles[0];
      const parsed = parseBrokerOptionCode(symbol!);
      if ('skip' in parsed) throw new Error(parsed.skip);
      const size = info?.contract_size ?? info?.lot_size;
      if (size != null && (!Number.isFinite(Number(size)) || Number(size) <= 0)) throw new Error('Invalid contract multiplier');
      if (lot && size != null && Number(size) !== lot.holding.option!.multiplier) throw new Error('Contract multiplier disagrees with position');
      const underlying = optionUnderlyingFromBroker({ market: market!, owner: info?.stock_owner == null ? undefined : String(info.stock_owner), optionRoot: parsed.root });
      if (typeof underlying !== 'string') throw new Error(underlying.skip);
      const option = lot?.holding.option ?? (size == null ? null : {
        underlying, right: parsed.right, expiry: parsed.expiry, strike: parsed.strike, multiplier: Number(size),
      });
      if (!option) throw new Error('Historical contract metadata unavailable; import a broker statement with the exact contract size');
      const currency = lot?.currency ?? (market === 'US' ? 'USD' : market === 'HK' ? 'HKD' : null);
      if (!currency) throw new Error('Historical contract currency unavailable');
      const contracts = decimal(row.qty);
      const price = decimal(row.price);
      if (price.startsWith('-')) throw new Error('Fill price must not be negative');
      const gross = multiply(price, contracts, String(option.multiplier));
      executions.push(assertOptionExecution({ channel, account_id: bundle.acc_id,
        execution_id: row.deal_id, contract_id: code, executed_at: marketTime(row.create_time, code.split('.')[0]),
        underlying: option.underlying, right: option.right, expiry: option.expiry,
        strike: String(option.strike), multiplier: String(option.multiplier), contracts,
        side: action[0], effect: action[1], currency,
        gross_premium: action[0] === 'buy' ? `-${gross}` : gross, commission: null,
      }));
    } catch (error) {
      throw new BrokerParseError(`MooMoo option fill ${String(row.deal_id ?? '')} (${code}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return mergeOptionExecutions([], executions);
}
