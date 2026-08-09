/**
 * Position (holding) trade journals with optional cash legs.
 */

import type { Holding } from '../market/types.js';
import { holdingInstrument } from '../state/portfolio-state.js';
import {
  ensureAccount,
  ensureHousehold,
  ensureImportEquity,
  getBalanceMinor,
  getQuantity,
} from './accounts.js';
import type { BooksClient } from './db.js';
import { assertCurrency, toMinor } from './money.js';
import type { HouseholdContext } from './ops.js';
import { postEntry, type PostedEntry } from './post.js';

async function cashAccount(
  client: BooksClient,
  householdId: string,
  channel: string | undefined,
  currency: string,
) {
  return ensureAccount(client, {
    householdId,
    kind: 'cash',
    currency,
    channel,
    externalKey: '',
  });
}

function costNotional(h: Holding): number {
  return h.avg_price * h.units;
}

/**
 * Record a buy/open (append) or absolute import of a lot.
 * When adjustCash: debit cash for long cost / credit cash for short premium.
 */
export async function postHoldingOpen(
  client: BooksClient,
  ctx: HouseholdContext,
  args: {
    mapKey: string;
    holding: Holding;
    /** This-trade units and avg for append; full lot for import */
    purchaseUnits: number;
    purchaseAvg: number;
    valueDate: string;
    requestId: string;
    adjustCash: boolean;
    currency?: string;
    toolName?: string;
  },
): Promise<PostedEntry> {
  await ensureHousehold(client, ctx.householdId, ctx.slug);
  const h = args.holding;
  const kind = holdingInstrument(h);
  const ccy = assertCurrency(args.currency ?? 'USD');
  if (!(args.purchaseUnits > 0) || !Number.isFinite(args.purchaseUnits)) {
    throw new Error('postHoldingOpen: purchaseUnits must be > 0.');
  }
  if (!(args.purchaseAvg > 0) || !Number.isFinite(args.purchaseAvg)) {
    throw new Error('postHoldingOpen: purchaseAvg must be > 0.');
  }

  const pos = await ensureAccount(client, {
    householdId: ctx.householdId,
    kind: 'position',
    currency: ccy,
    channel: h.channel,
    externalKey: args.mapKey,
    label: args.mapKey,
  });

  const tradeNotional = args.purchaseAvg * args.purchaseUnits;
  const costMinor = toMinor(tradeNotional);
  const unitCost = toMinor(args.purchaseAvg);
  const isShort = kind === 'option' && h.option?.side === 'short';

  // Position amount_minor tracks cost basis signed (long +, short −)
  const posDelta = isShort ? -costMinor : costMinor;
  const cashDelta = isShort ? costMinor : -costMinor; // short premium in; long pay out

  await client.query(
    `INSERT INTO position_meta (account_id, household_id, instrument, category, option_json, fund_json)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (account_id) DO UPDATE SET
       instrument = EXCLUDED.instrument,
       category = EXCLUDED.category,
       option_json = EXCLUDED.option_json,
       fund_json = EXCLUDED.fund_json`,
    [
      pos.id,
      ctx.householdId,
      kind,
      h.category ?? null,
      h.option != null ? JSON.stringify(h.option) : null,
      h.fund != null ? JSON.stringify(h.fund) : null,
    ],
  );

  if (args.adjustCash) {
    const cash = await cashAccount(client, ctx.householdId, h.channel, ccy);
    return postEntry(client, {
      householdId: ctx.householdId,
      valueDate: args.valueDate,
      entryType: 'trade',
      createdBy: ctx.actor,
      requestId: args.requestId,
      toolName: args.toolName ?? 'add_holding',
      memo: `open/buy ${args.mapKey}`,
      lines: [
        {
          accountId: pos.id,
          amountMinor: posDelta,
          currency: ccy,
          quantity: args.purchaseUnits,
          unitCostMinor: unitCost,
        },
        { accountId: cash.id, amountMinor: cashDelta, currency: ccy },
      ],
    });
  }

  const equity = await ensureImportEquity(client, ctx.householdId, ccy);
  return postEntry(client, {
    householdId: ctx.householdId,
    valueDate: args.valueDate,
    entryType: 'trade_import',
    createdBy: ctx.actor,
    requestId: args.requestId,
    toolName: args.toolName ?? 'add_holding',
    memo: `import position ${args.mapKey}`,
    lines: [
      {
        accountId: pos.id,
        amountMinor: posDelta,
        currency: ccy,
        quantity: args.purchaseUnits,
        unitCostMinor: unitCost,
      },
      { accountId: equity.id, amountMinor: -posDelta, currency: ccy },
    ],
  });
}

/** Remove full lot: reverse cost basis and cash at cost (YAML semantics). */
export async function postHoldingClose(
  client: BooksClient,
  ctx: HouseholdContext,
  args: {
    mapKey: string;
    holding: Holding;
    valueDate: string;
    requestId: string;
    adjustCash: boolean;
    currency?: string;
    toolName?: string;
  },
): Promise<PostedEntry> {
  await ensureHousehold(client, ctx.householdId, ctx.slug);
  const ccy = assertCurrency(args.currency ?? 'USD');
  const kind = holdingInstrument(args.holding);
  const isShort = kind === 'option' && args.holding.option?.side === 'short';
  const notional = costNotional(args.holding);
  const costMinor = toMinor(notional);

  const pos = await ensureAccount(client, {
    householdId: ctx.householdId,
    kind: 'position',
    currency: ccy,
    channel: args.holding.channel,
    externalKey: args.mapKey,
  });

  const qty = await getQuantity(client, pos.id);
  const bal = await getBalanceMinor(client, pos.id);
  // Prefer live projection if present; else YAML holding
  const closeQty = qty > 0 ? qty : args.holding.units;
  const closeBal = bal !== 0n ? bal : isShort ? -costMinor : costMinor;

  if (args.adjustCash) {
    const cash = await cashAccount(client, ctx.householdId, args.holding.channel, ccy);
    // Reverse open: cash gets +cost for long close-at-cost; short reverse pays premium back
    const cashDelta = isShort ? closeBal : -closeBal; // long closeBal>0 → cash +closeBal; wait
    // Long open: pos+, cash−. Close at cost: pos−, cash+.
    // Short open: pos−, cash+. Close: pos+, cash−.
    return postEntry(client, {
      householdId: ctx.householdId,
      valueDate: args.valueDate,
      entryType: 'trade_close',
      createdBy: ctx.actor,
      requestId: args.requestId,
      toolName: args.toolName ?? 'remove_holding',
      lines: [
        {
          accountId: pos.id,
          amountMinor: -closeBal,
          currency: ccy,
          quantity: -closeQty,
        },
        {
          accountId: cash.id,
          amountMinor: closeBal, // long: +cost back; short closeBal negative → cash decreases
          currency: ccy,
        },
      ],
    });
  }

  const equity = await ensureImportEquity(client, ctx.householdId, ccy);
  return postEntry(client, {
    householdId: ctx.householdId,
    valueDate: args.valueDate,
    entryType: 'trade_close_import',
    createdBy: ctx.actor,
    requestId: args.requestId,
    toolName: args.toolName ?? 'remove_holding',
    lines: [
      {
        accountId: pos.id,
        amountMinor: -closeBal,
        currency: ccy,
        quantity: -closeQty,
      },
      { accountId: equity.id, amountMinor: closeBal, currency: ccy },
    ],
  });
}
