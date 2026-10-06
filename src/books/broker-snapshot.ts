/** Reconcile a validated internal BrokerStatement to the append-only books. */
import type { Holding } from '../market/types.js';
import { holdingInstrument } from '../state/portfolio-state.js';
import type { InvestorState } from '../state/portfolio-state.js';
import type { BrokerStatement } from '../brokers/statement.js';
import { ensureBooksSeeded, householdContextFromState, newRequestId } from './service.js';
import { withHouseholdTx } from './db.js';
import { ensureHousehold } from './accounts.js';
import { assertCurrency, fromMinor, toMinor } from './money.js';
import { postHoldingClose, postHoldingOpen } from './position-ops.js';
import { postCashAdjustment, postOpeningBalance } from './ops.js';

interface StampedLot { mapKey: string; holding: Holding; currency: string }
interface ExistingPosition {
  id: string;
  external_key: string;
  currency: string;
  balance_minor: string;
  quantity: string;
}
interface ExistingCash { currency: string; balance_minor: string }

/** One broker observation is all-or-nothing in the books database. */
export async function booksApplyBrokerSnapshot(
  state: InvestorState,
  channel: string,
  statement: BrokerStatement,
  lots: StampedLot[],
  externalRef: string,
): Promise<{ journals: number }> {
  const desired = new Map<string, StampedLot>();
  for (const lot of lots) {
    const currency = assertCurrency(lot.currency);
    if (desired.has(lot.mapKey)) throw new Error(`Duplicate broker lot key ${lot.mapKey}.`);
    desired.set(lot.mapKey, { ...lot, currency });
  }
  const desiredCash = new Map<string, bigint>();
  for (const row of statement.cash) {
    const currency = assertCurrency(row.currency);
    if (desiredCash.has(currency)) throw new Error(`Duplicate broker cash currency ${currency}.`);
    if (row.amount < 0) throw new Error(`Broker ${channel} has negative ${currency} cash; books margin cash is not supported.`);
    desiredCash.set(currency, toMinor(row.amount));
  }

  await ensureBooksSeeded(state, { requirePositionCurrency: true });
  const ctx = householdContextFromState(state);
  return withHouseholdTx(ctx.householdId, async (client) => {
    await ensureHousehold(client, ctx.householdId, ctx.slug);
    const positions = await client.query<ExistingPosition>(
      `SELECT a.id::text, a.external_key, a.currency, b.balance_minor::text, b.quantity::text
       FROM accounts a JOIN account_balances b ON b.account_id = a.id
       WHERE a.household_id = $1::uuid AND a.kind = 'position' AND a.channel = $2
         AND (b.balance_minor <> 0 OR b.quantity <> 0)
       ORDER BY a.external_key, a.currency`,
      [ctx.householdId, channel],
    );
    const existingByKey = new Map<string, ExistingPosition[]>();
    for (const row of positions.rows) {
      const group = existingByKey.get(row.external_key) ?? [];
      group.push(row);
      existingByKey.set(row.external_key, group);
    }
    let journals = 0;
    for (const row of positions.rows) {
      const target = desired.get(row.external_key);
      const targetSignedCost = target == null ? null :
        toMinor(target.holding.avg_price * target.holding.units) *
        (holdingInstrument(target.holding) === 'option' && target.holding.option?.side === 'short' ? -1n : 1n);
      if (target?.currency === row.currency &&
          Number(row.quantity) === target.holding.units &&
          BigInt(row.balance_minor) === targetSignedCost) continue;
      const quantity = Number(row.quantity);
      const balance = BigInt(row.balance_minor);
      if (!(quantity > 0) || balance === 0n) {
        throw new Error(`Broker books position ${row.external_key}/${row.currency} has inconsistent quantity or cost.`);
      }
      await postHoldingClose(client, ctx, {
        mapKey: row.external_key,
        holding: { units: quantity, avg_price: Math.abs(fromMinor(balance)) / quantity, channel, currency: row.currency },
        currency: row.currency,
        valueDate: statement.as_of,
        requestId: newRequestId('broker-close'),
        adjustCash: false,
        toolName: 'broker_sync',
        entryType: 'broker_position_close_snapshot',
        memo: `Broker ${channel} ${statement.account_id} snapshot ${statement.as_of}: close ${row.external_key}`,
        externalRef,
      });
      journals++;
    }
    for (const lot of desired.values()) {
      const group = existingByKey.get(lot.mapKey) ?? [];
      const targetSignedCost = toMinor(lot.holding.avg_price * lot.holding.units) *
        (holdingInstrument(lot.holding) === 'option' && lot.holding.option?.side === 'short' ? -1n : 1n);
      const unchanged = group.some((row) => row.currency === lot.currency &&
        Number(row.quantity) === lot.holding.units && BigInt(row.balance_minor) === targetSignedCost);
      if (unchanged) {
        const account = group.find((row) => row.currency === lot.currency)!;
        await client.query(
          `INSERT INTO position_meta (account_id, household_id, instrument, category, option_json, fund_json)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb)
           ON CONFLICT (account_id) DO UPDATE SET instrument = EXCLUDED.instrument,
             category = EXCLUDED.category, option_json = EXCLUDED.option_json,
             fund_json = EXCLUDED.fund_json`,
          [account.id, ctx.householdId, holdingInstrument(lot.holding), lot.holding.category ?? null,
            lot.holding.option == null ? null : JSON.stringify(lot.holding.option),
            lot.holding.fund == null ? null : JSON.stringify(lot.holding.fund)],
        );
        continue;
      }
      await postHoldingOpen(client, ctx, {
        mapKey: lot.mapKey,
        holding: lot.holding,
        purchaseUnits: lot.holding.units,
        purchaseAvg: lot.holding.avg_price,
        currency: lot.currency,
        valueDate: statement.as_of,
        requestId: newRequestId('broker-open'),
        adjustCash: false,
        toolName: 'broker_sync',
        entryType: 'broker_position_open_snapshot',
        memo: `Broker ${channel} ${statement.account_id} snapshot ${statement.as_of}: open ${lot.mapKey}`,
        externalRef,
      });
      journals++;
    }

    const cash = await client.query<ExistingCash>(
      `SELECT a.currency, b.balance_minor::text
       FROM accounts a JOIN account_balances b ON b.account_id = a.id
       WHERE a.household_id = $1::uuid AND a.kind = 'cash' AND a.channel = $2
         AND b.balance_minor <> 0 ORDER BY a.currency`,
      [ctx.householdId, channel],
    );
    const existingCash = new Map(cash.rows.map((row) => [row.currency, BigInt(row.balance_minor)]));
    for (const currency of new Set([...existingCash.keys(), ...desiredCash.keys()])) {
      const prior = existingCash.get(currency) ?? 0n;
      const target = desiredCash.get(currency) ?? 0n;
      const delta = target - prior;
      if (delta === 0n) continue;
      if (prior === 0n && target > 0n) {
        await postOpeningBalance(client, ctx, {
          amount: fromMinor(target), currency, channel,
          valueDate: statement.as_of,
          requestId: newRequestId('broker-cash-opening'),
          memo: `Broker ${channel} ${statement.account_id} snapshot ${statement.as_of}: opening ${currency}`,
          toolName: 'broker_sync', externalRef,
        });
      } else {
        await postCashAdjustment(client, ctx, {
          amount: fromMinor(delta), currency, channel,
          valueDate: statement.as_of,
          requestId: newRequestId('broker-cash-adjustment'),
          memo: `Broker ${channel} ${statement.account_id} snapshot ${statement.as_of}: reconcile ${currency}`,
          contra: 'adjustment', toolName: 'broker_sync', externalRef,
        });
      }
      journals++;
    }
    return { journals };
  });
}
