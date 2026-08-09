/**
 * Import InvestorState money fields into books as opening journals.
 * Lossless 1:1 amounts; missing blocks stay missing (no invented zeros).
 */

import type { InvestorState } from '../state/portfolio-state.js';
import {
  getCashes,
  getDeposits,
  getPortfolio,
  holdingInstrument,
} from '../state/portfolio-state.js';
import { cashSlotKey } from '../state/portfolio-state.js';
import {
  ensureAccount,
  ensureHousehold,
  ensureImportEquity,
} from './accounts.js';
import type { BooksClient } from './db.js';
import { assertCurrency, toMinor } from './money.js';
import { addDepositBooks, setCashAbsolute } from './ops.js';
import { postEntry } from './post.js';

export interface ImportResult {
  householdId: string;
  slug: string;
  cashSlots: number;
  deposits: number;
  positions: number;
  requestIds: string[];
}

function portfolioLotKey(ticker: string, channel: string | undefined): string {
  const ch = cashSlotKey(channel);
  return ch.length > 0 ? `${ticker}@${ch}` : ticker;
}

/**
 * Import cash, deposits, and positions from YAML investor state.
 * Safe to re-run only on empty household books — fails if cash journals already exist.
 */
export async function importInvestorStateToBooks(
  client: BooksClient,
  state: InvestorState,
  opts?: { force?: boolean },
): Promise<ImportResult> {
  const householdId = state.user?.id;
  const slug = state.user?.slug;
  if (typeof householdId !== 'string' || householdId.trim().length === 0) {
    throw new Error('import: state.user.id (uuid) is required.');
  }
  if (typeof slug !== 'string' || slug.trim().length === 0) {
    throw new Error('import: state.user.slug is required.');
  }

  await ensureHousehold(client, householdId, slug);

  if (!opts?.force) {
    const existing = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_entries WHERE household_id = $1::uuid`,
      [householdId],
    );
    const n = Number(existing.rows[0]?.n ?? 0);
    if (n > 0) {
      throw new Error(
        `import: household ${slug} already has ${n} journal entries. ` +
          `Use force=true only after intentional wipe, or skip import.`,
      );
    }
  }

  const ctx = {
    householdId,
    slug,
    actor: `import:${slug}`,
  };
  const today = new Date().toISOString().slice(0, 10);
  const requestIds: string[] = [];

  const cashes = getCashes(state);
  for (let i = 0; i < cashes.length; i++) {
    const c = cashes[i]!;
    const requestId = `import-cash-${slug}-${i}-${c.currency}-${c.channel ?? ''}`;
    requestIds.push(requestId);
    await setCashAbsolute(client, ctx, {
      amount: c.amount,
      currency: c.currency,
      channel: c.channel,
      valueDate: c.updated_at || today,
      requestId,
      toolName: 'import_yaml',
    });
  }

  const deposits = getDeposits(state);
  for (let i = 0; i < deposits.length; i++) {
    const d = deposits[i]!;
    const requestId = `import-deposit-${slug}-${d.id}`;
    requestIds.push(requestId);
    await addDepositBooks(client, ctx, {
      id: d.id,
      amount: d.amount,
      interest: d.interest,
      currency: d.currency,
      channel: d.channel,
      startDate: d.start_date,
      endDate: d.end_date,
      label: d.label,
      valueDate: d.updated_at || today,
      requestId,
      adjustCash: false, // opening import: principal vs equity, not double-count cash
      toolName: 'import_yaml',
    });
  }

  const portfolio = getPortfolio(state);
  let positions = 0;
  for (const [mapKey, holding] of Object.entries(portfolio)) {
    const kind = holdingInstrument(holding);
    const ccy = 'USD'; // holdings historically USD-notional cost; fail if we later store ccy
    // Cost basis in cash units (avg_price * units for long; short option negative handled below)
    const notional = holding.avg_price * holding.units;
    if (!(notional >= 0) || !Number.isFinite(notional)) {
      throw new Error(`import position ${mapKey}: invalid notional.`);
    }
    const currency = assertCurrency(ccy);
    const lotKey = portfolioLotKey(mapKey.includes('@') ? mapKey.split('@')[0]! : mapKey, holding.channel);
    // Prefer stored map key as external_key for fidelity
    const externalKey = mapKey;

    const pos = await ensureAccount(client, {
      householdId,
      kind: 'position',
      currency,
      channel: holding.channel,
      externalKey,
      label: mapKey,
    });
    const equity = await ensureImportEquity(client, householdId, currency);
    const costMinor = toMinor(notional);
    const unitCost = toMinor(holding.avg_price);
    const requestId = `import-pos-${slug}-${externalKey}`;
    requestIds.push(requestId);

    let qty = holding.units;
    if (kind === 'option' && holding.option?.side === 'short') {
      // Short: liability-like units still positive in YAML; cost is credit.
      // Import: position quantity positive, amount_minor = -premium (credit) vs equity
      // Actually cashDeployedForHolding short = -notional. Book position value as -notional.
      await postEntry(client, {
        householdId,
        valueDate: today,
        entryType: 'opening_balance',
        createdBy: ctx.actor,
        requestId,
        toolName: 'import_yaml',
        memo: `open short option ${mapKey}`,
        lines: [
          {
            accountId: pos.id,
            amountMinor: -costMinor,
            currency,
            quantity: qty,
            unitCostMinor: unitCost,
          },
          { accountId: equity.id, amountMinor: costMinor, currency },
        ],
      });
    } else {
      await postEntry(client, {
        householdId,
        valueDate: today,
        entryType: 'opening_balance',
        createdBy: ctx.actor,
        requestId,
        toolName: 'import_yaml',
        memo: `open position ${mapKey}`,
        lines: [
          {
            accountId: pos.id,
            amountMinor: costMinor,
            currency,
            quantity: qty,
            unitCostMinor: unitCost,
          },
          { accountId: equity.id, amountMinor: -costMinor, currency },
        ],
      });
    }

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
        householdId,
        kind,
        holding.category ?? null,
        holding.option != null ? JSON.stringify(holding.option) : null,
        holding.fund != null ? JSON.stringify(holding.fund) : null,
      ],
    );
    positions += 1;
  }

  return {
    householdId,
    slug,
    cashSlots: cashes.length,
    deposits: deposits.length,
    positions,
    requestIds,
  };
}
