import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot, saveState } from 'utarus';
import {
  booksPostAdjustment,
  booksPostHoldingClose,
  booksPostHoldingOpen,
  booksPostOpeningBalance,
  isBooksEnabled,
} from '../books/index.js';
import { normalizeOptionalChannel } from '../market/position-value.js';
import {
  cashSlotKey,
  findCashForSlot,
  findCashesForChannel,
  getCashes,
  getPortfolio,
  setCashes,
  setPortfolio,
  type CashBalance,
  type InvestorState,
} from '../state/portfolio-state.js';
import { holdingsFromOpenPositions, IBKR_CHANNEL, type MappedLot } from './flex-map.js';
import type { FlexCashRow, FlexSkip, FlexStatementDoc } from './flex-parse.js';

export interface FlexApplyResult {
  accountId: string;
  asOf: string;
  channel: string;
  lotsUpserted: number;
  lotsRemoved: number;
  cash: FlexCashRow[];
  skipped: FlexSkip[];
  archivePath?: string;
}

export function replaceChannelCash(
  cashes: CashBalance[],
  sleeves: FlexCashRow[],
  channel: string,
  updatedAt: string,
): CashBalance[] {
  const ch = cashSlotKey(channel);
  const kept = cashes.filter((c) => cashSlotKey(c.channel) !== ch);
  return [
    ...kept,
    ...sleeves.map((row) => ({
      amount: row.endingCash,
      currency: row.currency,
      updated_at: updatedAt,
      channel,
    })),
  ];
}

function isIbkrLot(
  holding: { channel?: string },
  channel: string,
): boolean {
  return normalizeOptionalChannel(holding.channel, 'channel') === channel;
}

export function replaceChannelHoldings(
  portfolio: Record<string, import('../market/types.js').Holding>,
  lots: MappedLot[],
  channel: string,
): {
  next: Record<string, import('../market/types.js').Holding>;
  removedKeys: string[];
} {
  const removedKeys = Object.keys(portfolio).filter((k) => isIbkrLot(portfolio[k], channel));
  const kept: Record<string, import('../market/types.js').Holding> = {};
  for (const [k, h] of Object.entries(portfolio)) {
    if (!isIbkrLot(h, channel)) kept[k] = h;
  }
  const next = { ...kept };
  for (const lot of lots) {
    next[lot.mapKey] = lot.holding;
  }
  return { next, removedKeys };
}

function archiveXml(slug: string, xml: Buffer, asOf: string): string {
  const dir = join(resolveDataRoot(), 'drive', slug, 'ibkr-flex');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `activity-${asOf}-${stamp}.xml`);
  writeFileSync(file, xml);
  return file;
}

export async function applyFlexStatement(
  state: InvestorState,
  doc: FlexStatementDoc,
  rawXml?: Buffer,
): Promise<FlexApplyResult> {
  const channel = IBKR_CHANNEL;
  const { lots, skipped: mapSkipped } = holdingsFromOpenPositions(doc.openPositions, channel);
  const skipped: FlexSkip[] = [...doc.skipped, ...mapSkipped];
  const portfolio = { ...getPortfolio(state) };
  const { next, removedKeys } = replaceChannelHoldings(portfolio, lots, channel);
  const today = doc.toDate;
  const existing = getPortfolio(state);
  const removed = removedKeys.filter((k) => !lots.some((l) => l.mapKey === k)).length;

  if (isBooksEnabled()) {
    for (const key of removedKeys) {
      const holding = existing[key];
      if (!holding) continue;
      if (lots.some((l) => l.mapKey === key)) continue;
      await booksPostHoldingClose(state, {
        mapKey: key,
        holding,
        valueDate: today,
        adjustCash: false,
      });
    }
    for (const lot of lots) {
      const prior = existing[lot.mapKey];
      if (prior && isIbkrLot(prior, channel)) {
        await booksPostHoldingClose(state, {
          mapKey: lot.mapKey,
          holding: prior,
          valueDate: today,
          adjustCash: false,
        });
      }
      await booksPostHoldingOpen(state, {
        mapKey: lot.mapKey,
        holding: lot.holding,
        purchaseUnits: lot.holding.units,
        purchaseAvg: lot.holding.avg_price,
        valueDate: today,
        adjustCash: false,
        currency: lot.currency,
      });
    }
    const incoming = new Set(doc.cash.map((row) => row.currency));
    for (const prior of findCashesForChannel(getCashes(state), channel)) {
      if (incoming.has(prior.currency)) continue;
      if (prior.amount !== 0) {
        await booksPostAdjustment(state, {
          amount: -prior.amount,
          currency: prior.currency,
          channel,
          valueDate: today,
          memo: `IBKR Flex Cash Report ${today} close ${prior.currency}`,
          contra: 'adjustment',
        });
      }
    }
    for (const row of doc.cash) {
      const prior = findCashForSlot(getCashes(state), channel, row.currency);
      if (!prior) {
        await booksPostOpeningBalance(state, {
          amount: row.endingCash,
          currency: row.currency,
          channel,
          valueDate: today,
          memo: `IBKR Flex Cash Report ${today} opening ${row.currency}`,
        });
      } else {
        const delta = row.endingCash - prior.amount;
        if (delta !== 0) {
          await booksPostAdjustment(state, {
            amount: delta,
            currency: row.currency,
            channel,
            valueDate: today,
            memo: `IBKR Flex Cash Report ${today} reconcile`,
            contra: 'adjustment',
          });
        }
      }
    }
  }

  setPortfolio(state, next);
  if (!isBooksEnabled()) {
    setCashes(state, replaceChannelCash(getCashes(state), doc.cash, channel, today));
  }

  const slug = state.user.slug;
  let archivePath: string | undefined;
  if (rawXml) {
    archivePath = archiveXml(slug, rawXml, today);
  }

  state.log.push({
    ts: today,
    action: 'ibkr_flex_sync',
    account_id: doc.accountId,
    lots: lots.length,
    removed,
    not_imported: skipped.length,
  });
  saveState(state);

  const result: FlexApplyResult = {
    accountId: doc.accountId,
    asOf: today,
    channel,
    lotsUpserted: lots.length,
    lotsRemoved: removed,
    cash: doc.cash,
    skipped,
  };
  if (archivePath) result.archivePath = archivePath;
  return result;
}
