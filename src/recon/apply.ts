import { booksPostAdjustment, booksPostOpeningBalance, isBooksEnabled } from '../books/index.js';
import type { Holding } from '../market/types.js';
import {
  assertHolding,
  buildHoldingKey,
  holdingBaseKey,
} from '../market/position-value.js';
import {
  cashSlotKey,
  getDeposits,
  getPortfolio,
  setDeposits,
  setPortfolio,
  type InvestorState,
} from '../state/portfolio-state.js';
import { compareChannel, lineIsMatch } from './compare.js';
import { markSleeve, requireSession, requireSleeve, requireYmd } from './session.js';
import type { ReconLine, ReconLineDecision, ReconLotRow, ReconStatement } from './types.js';

function channelArg(channel: string): string | undefined {
  const k = cashSlotKey(channel);
  return k.length > 0 ? k : undefined;
}

export function decideReconLine(
  state: InvestorState,
  lineId: string,
  decision: ReconLineDecision,
): ReconLine {
  const session = requireSession(state);
  const sleeve = requireSleeve(session, session.current_channel);
  if (sleeve.status !== 'compared' && sleeve.status !== 'sourced') {
    throw new Error(
      `Cannot decide lines on ${sleeve.channel || '(unassigned)'} while status is ${sleeve.status}.`,
    );
  }
  const lines = sleeve.lines;
  if (!lines) throw new Error('No compare lines. Source the statement first.');
  const line = lines.find((l) => l.id === lineId);
  if (!line) {
    throw new Error(`Unknown recon line "${lineId}". Open lines: ${lines.map((l) => l.id).join(', ')}.`);
  }
  line.decision = decision;
  sleeve.status = 'compared';
  markSleeve(state, sleeve.channel, { lines, status: 'compared' });
  return line;
}

function holdingFromStatement(
  channel: string,
  row: ReconLotRow,
  existing: Holding | undefined,
): Holding {
  const key = buildHoldingKey(row.ticker, channelArg(channel));
  const avg_price = row.avg_price ?? existing?.avg_price;
  if (avg_price == null) {
    throw new Error(`Taking lot ${row.ticker} needs avg_price on the statement or an existing books lot.`);
  }
  const instrument = row.instrument ?? existing?.instrument ?? 'equity';
  const holding: Holding = {
    avg_price,
    units: row.units,
    ...(channelArg(channel) ? { channel: channelArg(channel) } : {}),
  };
  if (instrument === 'fund') {
    const quote_source = row.fund_quote_source ?? existing?.fund?.quote_source;
    if (quote_source == null) {
      throw new Error(`Taking fund ${row.ticker} needs fund_quote_source.`);
    }
    holding.instrument = 'fund';
    holding.fund = {
      quote_source,
      ...(row.fund_name || existing?.fund?.name
        ? { name: row.fund_name ?? existing?.fund?.name }
        : {}),
      ...(row.mark != null || existing?.fund?.mark != null
        ? { mark: row.mark ?? existing?.fund?.mark }
        : {}),
    };
  } else if (instrument === 'option') {
    if (!existing?.option) {
      throw new Error(`Taking option ${row.ticker} needs an existing option lot (paste cannot invent the contract).`);
    }
    holding.instrument = 'option';
    holding.option = existing.option;
  } else if (instrument === 'equity') {
    holding.instrument = 'equity';
  }
  if (existing) {
    if (existing.category) holding.category = existing.category;
    if (existing.encumbrance) holding.encumbrance = existing.encumbrance;
    if (existing.broker_ref) holding.broker_ref = existing.broker_ref;
  }
  assertHolding(key, holding);
  return holding;
}

export async function applyReconChannel(state: InvestorState, channel: string): Promise<void> {
  const session = requireSession(state);
  const sleeve = requireSleeve(session, channel);
  if (sleeve.status === 'applied') {
    throw new Error(`Channel ${channel || '(unassigned)'} is already applied.`);
  }
  if (sleeve.status === 'skipped') {
    throw new Error(`Channel ${channel || '(unassigned)'} was skipped.`);
  }
  const lines = sleeve.lines;
  const statement = sleeve.statement;
  if (!lines || !statement) {
    throw new Error('Source and compare before apply.');
  }
  const undecided = lines.filter((l) => l.decision == null);
  if (undecided.length > 0) {
    throw new Error(
      `Decide remaining lines before apply: ${undecided.map((l) => l.id).join(', ')}.`,
    );
  }
  const takes = lines.filter((l) => l.decision === 'take');
  const cashTakes = takes.filter((l) => l.kind === 'cash');
  if (cashTakes.length > 0 && !isBooksEnabled()) {
    throw new Error(
      'Books of record required to apply cash recon lines (set INVAGE_BOOKS_DATABASE_URL). ' +
        'Lot/FD takes were not written.',
    );
  }

  const ch = cashSlotKey(channel);
  const stmtLots = new Map(statement.lots.map((r) => [r.ticker.trim().toUpperCase(), r]));
  const portfolio = { ...getPortfolio(state) };
  for (const line of takes) {
    if (line.kind !== 'lot') continue;
    const ticker = (line.item ?? '').toUpperCase();
    const mapKey =
      Object.keys(portfolio).find(
        (k) => cashSlotKey(portfolio[k].channel) === ch && holdingBaseKey(k).toUpperCase() === ticker,
      ) ?? buildHoldingKey(ticker, channelArg(channel));
    const existing = portfolio[mapKey];
    const stmt = stmtLots.get(ticker);
    if (stmt) {
      portfolio[mapKey] = holdingFromStatement(channel, stmt, existing);
    } else {
      delete portfolio[mapKey];
    }
  }
  setPortfolio(state, portfolio);

  if (takes.some((l) => l.kind === 'deposit')) {
    let deposits = getDeposits(state).filter((d) => cashSlotKey(d.channel) === ch);
    const others = getDeposits(state).filter((d) => cashSlotKey(d.channel) !== ch);
    for (const line of takes) {
      if (line.kind !== 'deposit') continue;
      const stmt = statement.deposits.find((d) => depositLineId(d, line));
      if (!stmt) {
        deposits = deposits.filter((d) => d.id !== line.item);
        continue;
      }
      const existing = deposits.find((d) => d.id === line.item);
      if (existing) {
        existing.amount = stmt.amount;
        existing.currency = stmt.currency;
        existing.updated_at = session.as_of;
      } else if (stmt.id) {
        deposits.push({
          id: stmt.id,
          amount: stmt.amount,
          interest: stmt.interest ?? 0,
          currency: stmt.currency,
          start_date: stmt.start_date ?? session.as_of,
          end_date: stmt.end_date ?? session.as_of,
          updated_at: session.as_of,
          ...(channelArg(channel) ? { channel: channelArg(channel) } : {}),
          ...(stmt.label ? { label: stmt.label } : {}),
        });
      } else {
        throw new Error(`Taking a new deposit needs id on the statement (line ${line.id}).`);
      }
    }
    setDeposits(state, [...others, ...deposits]);
  }

  for (const line of cashTakes) {
    const currency = line.currency;
    if (!currency) throw new Error(`Cash line ${line.id} is missing currency.`);
    const stmt = line.statement_amount;
    const books = line.books_amount;
    const memo = `Channel recon ${session.as_of} ${channel || '(unassigned)'} ${line.id}`;
    if (books == null) {
      if (stmt == null) continue;
      if (stmt === 0) continue;
      await booksPostOpeningBalance(state, {
        amount: stmt,
        currency,
        channel: channelArg(channel) ?? null,
        valueDate: session.as_of,
        memo,
      });
      continue;
    }
    const target = stmt == null ? 0 : stmt;
    const delta = target - books;
    if (delta === 0) continue;
    await booksPostAdjustment(state, {
      amount: delta,
      currency,
      channel: channelArg(channel) ?? null,
      valueDate: session.as_of,
      memo,
      contra: 'adjustment',
    });
  }

  markSleeve(state, channel, { status: 'applied' });
}

function depositLineId(
  row: { id?: string; currency: string; amount: number },
  line: ReconLine,
): boolean {
  if (row.id && line.item) return row.id === line.item;
  return `deposit:${row.currency}:${row.amount}` === line.id || `deposit:${row.id}` === line.id;
}

export function sourceReconStatement(
  state: InvestorState,
  channel: string,
  statement: ReconStatement,
  source: 'paste' | 'connector',
): void {
  requireYmd(requireSession(state).as_of, 'recon.as_of');
  const sleeve = requireSleeve(requireSession(state), channel);
  if (sleeve.status === 'applied' || sleeve.status === 'skipped') {
    throw new Error(
      `Channel ${channel || '(unassigned)'} is ${sleeve.status}; cannot source again.`,
    );
  }
  const lines = compareChannel(state, channel, statement);
  for (const line of lines) {
    if (lineIsMatch(line)) line.decision = 'keep';
  }
  const allKeep = lines.length > 0 && lines.every((l) => l.decision === 'keep');
  const emptyBoth = lines.length === 0;
  markSleeve(state, channel, {
    status: allKeep || emptyBoth ? 'applied' : 'compared',
    source,
    statement,
    lines,
  });
}

export function sourceReconPaste(
  state: InvestorState,
  channel: string,
  statement: ReconStatement,
): void {
  sourceReconStatement(state, channel, statement, 'paste');
}
