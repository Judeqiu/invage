/** Keep the journal projections aligned with every persisted portfolio mutation. */
import { createHash } from 'node:crypto';
import type { Holding } from '../market/types.js';
import {
  getCashes, getDeposits, getPortfolio, holdingInstrument,
  type FixedDeposit, type InvestorState,
} from '../state/portfolio-state.js';
import { ensureHousehold, ensureImportEquity } from './accounts.js';
import { isBooksEnabled, type BooksClient } from './db.js';
import { assertCurrency, fromMinor, normalizeChannelKey, toMinor } from './money.js';
import { addDepositBooks, postCashAdjustment } from './ops.js';
import { postHoldingClose, postHoldingOpen } from './position-ops.js';
import { postEntry } from './post.js';
import { householdContextFromState, newRequestId } from './service.js';

interface PositionRow {
  id: string; external_key: string; channel: string; currency: string;
  balance_minor: string; quantity: string;
}
interface DepositRow {
  id: string; external_key: string; channel: string; currency: string;
  balance_minor: string;
}

function moneyState(state: InvestorState): string {
  return JSON.stringify({
    portfolio: getPortfolio(state), cash: getCashes(state), deposits: getDeposits(state),
  });
}

function signedCost(holding: Holding): bigint {
  const cost = toMinor(holding.avg_price * holding.units);
  return holdingInstrument(holding) === 'option' && holding.option?.side === 'short' ? -cost : cost;
}

function uniqueCurrency(key: string, holding: Holding, rows: PositionRow[]): string {
  if (holding.currency) return assertCurrency(holding.currency);
  const currencies = [...new Set(rows.filter(row => row.external_key === key &&
    row.channel === normalizeChannelKey(holding.channel)).map(row => row.currency))];
  if (currencies.length > 1) throw new Error(`Position ${key} has ambiguous currency in books.`);
  return currencies[0] ?? 'USD';
}

async function reconcilePositions(
  client: BooksClient, state: InvestorState, valueDate: string,
): Promise<number> {
  const ctx = householdContextFromState(state);
  const result = await client.query<PositionRow>(
    `SELECT a.id::text, a.external_key, a.channel, a.currency,
            b.balance_minor::text, b.quantity::text
     FROM accounts a JOIN account_balances b ON b.account_id = a.id
     WHERE a.household_id = $1::uuid AND a.kind = 'position'
     ORDER BY a.external_key, a.channel, a.currency`, [ctx.householdId],
  );
  const all = result.rows;
  const active = all.filter(row => BigInt(row.balance_minor) !== 0n || Number(row.quantity) !== 0);
  const desired = new Map<string, { holding: Holding; currency: string }>();
  for (const [key, holding] of Object.entries(getPortfolio(state))) {
    const currency = uniqueCurrency(key, holding, all);
    // Persist the verified currency so later changes cannot silently default it.
    holding.currency = currency;
    desired.set(`${normalizeChannelKey(holding.channel)}\0${key}\0${currency}`, { holding, currency });
  }
  let journals = 0;
  for (const row of active) {
    const target = desired.get(`${row.channel}\0${row.external_key}\0${row.currency}`);
    if (target && Number(row.quantity) === target.holding.units &&
        BigInt(row.balance_minor) === signedCost(target.holding)) continue;
    const quantity = Number(row.quantity);
    const balance = BigInt(row.balance_minor);
    if (!(quantity > 0) || balance === 0n) {
      throw new Error(`Position ${row.external_key}/${row.currency} has inconsistent books quantity or cost.`);
    }
    await postHoldingClose(client, ctx, {
      mapKey: row.external_key,
      holding: { units: quantity, avg_price: Math.abs(fromMinor(balance)) / quantity,
        channel: row.channel || undefined, currency: row.currency },
      currency: row.currency, valueDate, requestId: newRequestId('state-position-close'),
      adjustCash: false, toolName: 'portfolio_save', entryType: 'position_reconcile_close',
      memo: `Portfolio save: close ${row.external_key}`,
    });
    journals++;
  }
  for (const [compoundKey, target] of desired) {
    const [channel, key, currency] = compoundKey.split('\0');
    const unchanged = active.some(row => row.channel === channel && row.external_key === key &&
      row.currency === currency && Number(row.quantity) === target.holding.units &&
      BigInt(row.balance_minor) === signedCost(target.holding));
    if (unchanged) {
      const row = active.find(r => r.channel === channel && r.external_key === key && r.currency === currency)!;
      await client.query(
        `INSERT INTO position_meta (account_id, household_id, instrument, category, option_json, fund_json)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb)
         ON CONFLICT (account_id) DO UPDATE SET instrument = EXCLUDED.instrument,
           category = EXCLUDED.category, option_json = EXCLUDED.option_json,
           fund_json = EXCLUDED.fund_json`,
        [row.id, ctx.householdId, holdingInstrument(target.holding), target.holding.category ?? null,
          target.holding.option == null ? null : JSON.stringify(target.holding.option),
          target.holding.fund == null ? null : JSON.stringify(target.holding.fund)],
      );
      continue;
    }
    await postHoldingOpen(client, ctx, {
      mapKey: key, holding: target.holding, purchaseUnits: target.holding.units,
      purchaseAvg: target.holding.avg_price, currency, valueDate,
      requestId: newRequestId('state-position-open'), adjustCash: false,
      toolName: 'portfolio_save', entryType: 'position_reconcile_open',
      memo: `Portfolio save: open ${key}`,
    });
    journals++;
  }
  return journals;
}

async function reconcileDeposits(
  client: BooksClient, state: InvestorState, valueDate: string,
): Promise<number> {
  const ctx = householdContextFromState(state);
  const result = await client.query<DepositRow>(
    `SELECT a.id::text, a.external_key, a.channel, a.currency, b.balance_minor::text
     FROM accounts a JOIN account_balances b ON b.account_id = a.id
     WHERE a.household_id = $1::uuid AND a.kind = 'deposit' AND b.balance_minor <> 0
     ORDER BY a.external_key, a.channel, a.currency`, [ctx.householdId],
  );
  const desired = new Map<string, FixedDeposit>();
  for (const deposit of getDeposits(state)) {
    desired.set(`${normalizeChannelKey(deposit.channel)}\0${deposit.id}\0${assertCurrency(deposit.currency)}`, deposit);
  }
  let journals = 0;
  for (const row of result.rows) {
    const target = desired.get(`${row.channel}\0${row.external_key}\0${row.currency}`);
    if (target && BigInt(row.balance_minor) === toMinor(target.amount)) continue;
    const principal = BigInt(row.balance_minor);
    if (principal <= 0n) throw new Error(`Deposit ${row.external_key} has invalid books principal.`);
    const equity = await ensureImportEquity(client, ctx.householdId, row.currency);
    await postEntry(client, {
      householdId: ctx.householdId, valueDate, entryType: 'deposit_reconcile_close',
      createdBy: ctx.actor, requestId: newRequestId('state-deposit-close'),
      toolName: 'portfolio_save', memo: `Portfolio save: close deposit ${row.external_key}`,
      lines: [
        { accountId: row.id, amountMinor: -principal, currency: row.currency },
        { accountId: equity.id, amountMinor: principal, currency: row.currency },
      ],
    });
    journals++;
  }
  for (const [compoundKey, deposit] of desired) {
    const [channel, key, currency] = compoundKey.split('\0');
    const unchanged = result.rows.some(row => row.channel === channel && row.external_key === key &&
      row.currency === currency && BigInt(row.balance_minor) === toMinor(deposit.amount));
    if (!unchanged) {
      if (toMinor(deposit.amount) === 0n) throw new Error(`Deposit ${key} has zero principal.`);
      await addDepositBooks(client, ctx, {
        id: key, amount: deposit.amount, interest: deposit.interest, currency,
        channel, startDate: deposit.start_date, endDate: deposit.end_date,
        label: deposit.label, valueDate, requestId: newRequestId('state-deposit-open'),
        adjustCash: false, toolName: 'portfolio_save',
      });
      journals++;
    } else {
      const row = result.rows.find(r => r.channel === channel && r.external_key === key && r.currency === currency)!;
      await client.query(
        `INSERT INTO deposit_meta (account_id, household_id, interest_minor, start_date, end_date, label)
         VALUES ($1::uuid, $2::uuid, $3::bigint, $4::date, $5::date, $6)
         ON CONFLICT (account_id) DO UPDATE SET interest_minor = EXCLUDED.interest_minor,
           start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, label = EXCLUDED.label`,
        [row.id, ctx.householdId, toMinor(deposit.interest).toString(),
          deposit.start_date, deposit.end_date, deposit.label ?? null],
      );
    }
  }
  return journals;
}

async function reconcileCash(client: BooksClient, state: InvestorState, valueDate: string): Promise<number> {
  const ctx = householdContextFromState(state);
  const result = await client.query<{ channel: string; currency: string; balance_minor: string }>(
    `SELECT a.channel, a.currency, b.balance_minor::text
     FROM accounts a JOIN account_balances b ON b.account_id = a.id
     WHERE a.household_id = $1::uuid AND a.kind = 'cash' AND b.balance_minor <> 0`,
    [ctx.householdId],
  );
  const current = new Map(result.rows.map(row =>
    [`${row.channel}\0${row.currency}`, BigInt(row.balance_minor)]));
  const desired = new Map<string, bigint>();
  for (const cash of getCashes(state)) {
    const key = `${normalizeChannelKey(cash.channel)}\0${assertCurrency(cash.currency)}`;
    if (desired.has(key)) throw new Error(`Duplicate cash sleeve ${key}.`);
    desired.set(key, toMinor(cash.amount));
  }
  let journals = 0;
  for (const key of new Set([...current.keys(), ...desired.keys()])) {
    const prior = current.get(key) ?? 0n;
    const target = desired.get(key) ?? 0n;
    if (prior === target) continue;
    const [channel, currency] = key.split('\0');
    await postCashAdjustment(client, ctx, {
      amount: fromMinor(target - prior), currency, channel, valueDate,
      memo: `Portfolio save: reconcile cash ${channel || '(unassigned)'}/${currency}`,
      contra: 'adjustment', requestId: newRequestId('state-cash'), toolName: 'portfolio_save',
    });
    journals++;
  }
  return journals;
}

/** A successful state save is preceded by a complete, balanced books reconciliation. */
export async function reconcileInvestorBooks(
  persisted: InvestorState, next: InvestorState, revision: number, client?: BooksClient,
): Promise<{ journals: number }> {
  const before = moneyState(persisted);
  const after = moneyState(next);
  if (before === after) return { journals: 0 };
  if (!isBooksEnabled()) {
    if (process.env.INVAGE_REQUIRE_BOOKS_FOR_PORTFOLIO === 'true') {
      throw new Error('Portfolio save requires INVAGE_BOOKS_DATABASE_URL.');
    }
    return { journals: 0 };
  }
  if (!client) throw new Error('Books reconciliation requires a household transaction.');
  const ctx = householdContextFromState(next);
  const valueDate = new Date().toISOString().slice(0, 10);
  const fingerprint = createHash('sha256').update(`${revision}\0${after}`).digest('hex');
  await ensureHousehold(client, ctx.householdId, ctx.slug);
  const journals = await reconcilePositions(client, next, valueDate) +
    await reconcileDeposits(client, next, valueDate) +
    await reconcileCash(client, next, valueDate);
  const requestId = `portfolio-save-${fingerprint}`;
  const existing = await client.query(
    `SELECT 1 FROM audit_events WHERE household_id = $1::uuid AND request_id = $2 LIMIT 1`,
    [ctx.householdId, requestId],
  );
  if (existing.rowCount === 0) {
    await client.query(
      `INSERT INTO audit_events (household_id, actor, tool_name, request_id, detail)
       VALUES ($1::uuid, $2, 'portfolio_save', $3, $4::jsonb)`,
      [ctx.householdId, ctx.actor, requestId,
        JSON.stringify({ revision, journals, before_sha256: createHash('sha256').update(before).digest('hex'),
          after_sha256: createHash('sha256').update(after).digest('hex'),
          portfolio_snapshot: JSON.parse(after) })],
    );
  }
  return { journals };
}
