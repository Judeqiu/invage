import type { Holding, HoldingBrokerRef } from '../market/types.js';
import {
  assertHolding,
  buildHoldingKey,
  buildOptionKey,
  holdingBaseKey,
} from '../market/position-value.js';
import type {
  BrokerCashSleeve,
  BrokerSkip,
  BrokerStatement,
} from '../brokers/statement.js';
import type { FlexOpenPosition, FlexSkip, FlexStatementDoc } from './flex-parse.js';
import { yahooSymbolFromFlex } from '../brokers/yahoo-symbol.js';

export { yahooSymbolFromFlex };

export const IBKR_CHANNEL = 'ibkr';

export interface MappedLot {
  mapKey: string;
  holding: Holding;
  currency: string;
}

function ymdOptionExpiry(raw: string): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`IBKR option expiry must be YYYYMMDD, got "${raw}"`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function avgPrice(pos: FlexOpenPosition, units: number, multiplier: number, isOption: boolean): number {
  if (pos.costBasisMoney != null && units > 0) {
    const avg = Math.abs(pos.costBasisMoney) / units;
    if (!(avg > 0) || !Number.isFinite(avg)) {
      throw new Error(`IBKR Flex ${pos.symbol}: costBasisMoney/quantity is not a positive price.`);
    }
    return avg;
  }
  if (pos.costBasisPrice != null && pos.costBasisPrice > 0) {
    return isOption ? pos.costBasisPrice * multiplier : pos.costBasisPrice;
  }
  throw new Error(`IBKR Flex ${pos.symbol}: need costBasisMoney or costBasisPrice.`);
}

function optionMark(pos: FlexOpenPosition, multiplier: number): number | undefined {
  if (pos.markPrice == null) return undefined;
  return pos.markPrice * multiplier;
}

function skipPosition(pos: FlexOpenPosition, reason: string): FlexSkip {
  return {
    kind: 'position',
    reason,
    symbol: pos.symbol,
    assetCategory: pos.assetCategory,
  };
}

function brokerRefFromFlex(pos: FlexOpenPosition): HoldingBrokerRef | undefined {
  const ref: HoldingBrokerRef = {};
  if (pos.conid?.trim()) ref.native_id = pos.conid.trim();
  if (pos.listingExchange?.trim()) ref.listing_exchange = pos.listingExchange.trim();
  if (ref.native_id == null && ref.listing_exchange == null) return undefined;
  return ref;
}

function withFlexIdentity(holding: Holding, pos: FlexOpenPosition): Holding {
  const broker_ref = brokerRefFromFlex(pos);
  if (broker_ref) holding.broker_ref = broker_ref;
  return holding;
}

export function brokerSkipFromFlex(skip: FlexSkip): BrokerSkip {
  const out: BrokerSkip = { kind: skip.kind, reason: skip.reason };
  if (skip.symbol) out.symbol = skip.symbol;
  if (skip.currency) out.currency = skip.currency;
  return out;
}

export function mapFlexDocToStatement(doc: FlexStatementDoc, channel: string): BrokerStatement {
  const { lots, skipped: mapSkipped } = holdingsFromOpenPositions(doc.openPositions, channel);
  const cash: BrokerCashSleeve[] = doc.cash.map((row) => ({
    currency: row.currency,
    amount: row.endingCash,
  }));
  return {
    account_id: doc.accountId,
    as_of: doc.toDate,
    from_date: doc.fromDate,
    cash,
    lots: lots.map((lot) => ({
      ticker: holdingBaseKey(lot.mapKey),
      currency: lot.currency,
      holding: lot.holding,
    })),
    skipped: [...doc.skipped, ...mapSkipped].map(brokerSkipFromFlex),
    ...(doc.optionExecutions !== undefined ? { option_executions: doc.optionExecutions } : {}),
  };
}

export function holdingsFromOpenPositions(
  rows: FlexOpenPosition[],
  channel: string,
): { lots: MappedLot[]; skipped: FlexSkip[] } {
  if (!channel.trim()) throw new Error('IBKR Flex channel is required.');
  const lots: MappedLot[] = [];
  const skipped: FlexSkip[] = [];
  const seen = new Set<string>();
  for (const pos of rows) {
    try {
      const cat = pos.assetCategory.toUpperCase();
      if (cat === 'CASH') continue;
      if (pos.quantity === 0) continue;
      let lot: MappedLot | undefined;
      if (cat === 'STK' || cat === 'ETF') {
        if (!(pos.quantity > 0)) {
          skipped.push(
            skipPosition(pos, `short stock (${pos.quantity}) is not supported on the books`),
          );
          continue;
        }
        const ticker = yahooSymbolFromFlex(pos);
        const mapKey = buildHoldingKey(ticker, channel);
        const holding: Holding = withFlexIdentity(
          {
            instrument: 'equity',
            units: pos.quantity,
            avg_price: avgPrice(pos, pos.quantity, 1, false),
            channel,
          },
          pos,
        );
        assertHolding(mapKey, holding);
        lot = { mapKey, holding, currency: pos.currency };
      } else if (cat === 'OPT') {
        if (pos.multiplier == null) throw new Error('option missing multiplier');
        const multiplier = pos.multiplier;
        if (!(multiplier > 0)) throw new Error(`multiplier must be > 0`);
        const units = Math.abs(pos.quantity);
        const side = pos.quantity < 0 ? 'short' : 'long';
        const pc = (pos.putCall ?? '').trim().toUpperCase();
        const right = pc === 'P' || pc === 'PUT' ? 'put' : pc === 'C' || pc === 'CALL' ? 'call' : null;
        if (!right) throw new Error('option missing putCall');
        if (pos.strike == null || !(pos.strike > 0)) {
          throw new Error('option missing strike');
        }
        if (!pos.expiry) throw new Error('option missing expiry');
        if (!pos.underlyingSymbol?.trim()) throw new Error('option missing underlyingSymbol');
        const underlying = pos.underlyingSymbol.trim().toUpperCase();
        const expiry = ymdOptionExpiry(pos.expiry);
        const base = buildOptionKey({
          underlying,
          right,
          strike: pos.strike,
          expiry,
          side,
        });
        const mapKey = buildHoldingKey(base, channel);
        const mark = optionMark(pos, multiplier);
        if (mark == null) {
          throw new Error('option missing markPrice');
        }
        const holding: Holding = withFlexIdentity(
          {
            instrument: 'option',
            units,
            avg_price: avgPrice(pos, units, multiplier, true),
            channel,
            option: {
              right,
              side,
              strike: pos.strike,
              expiry,
              multiplier,
              underlying,
              settlement: 'physical',
              mark,
            },
          },
          pos,
        );
        assertHolding(mapKey, holding);
        lot = { mapKey, holding, currency: pos.currency };
      } else if (cat === 'FUND' || cat === 'FND' || cat === 'BILL' || cat === 'BOND') {
        if (!(pos.quantity > 0)) {
          throw new Error('non-positive fund/bond quantity');
        }
        const ticker = yahooSymbolFromFlex(pos);
        const mapKey = buildHoldingKey(ticker, channel);
        if (pos.markPrice == null) throw new Error('fund/bond missing markPrice');
        const holding: Holding = withFlexIdentity(
          {
            instrument: 'fund',
            units: pos.quantity,
            avg_price: avgPrice(pos, pos.quantity, 1, false),
            channel,
            fund: {
              quote_source: 'manual',
              mark: pos.markPrice,
              name: pos.symbol,
            },
          },
          pos,
        );
        assertHolding(mapKey, holding);
        lot = { mapKey, holding, currency: pos.currency };
      } else {
        skipped.push(
          skipPosition(
            pos,
            `assetCategory ${pos.assetCategory} is not imported (supported: STK, ETF, OPT, FUND)`,
          ),
        );
        continue;
      }
      if (!lot) continue;
      if (seen.has(lot.mapKey)) {
        skipped.push(skipPosition(pos, `duplicate map key ${lot.mapKey}`));
        continue;
      }
      seen.add(lot.mapKey);
      lots.push(lot);
    } catch (e) {
      skipped.push(
        skipPosition(pos, e instanceof Error ? e.message : String(e)),
      );
    }
  }
  return { lots, skipped };
}
