import { assertHolding, holdingBaseKey } from '../market/position-value.js';
import {
  cashSlotKey,
  findCashesForChannel,
  getCashes,
  getDeposits,
  getPortfolio,
  type InvestorState,
} from '../state/portfolio-state.js';
import { sameNumber, type ReconLine, type ReconStatement } from './types.js';

function cashLineId(currency: string): string {
  return `cash:${currency}`;
}

function lotLineId(ticker: string): string {
  return `lot:${ticker}`;
}

function depositLineId(id: string): string {
  return `deposit:${id}`;
}

function lotMatches(line: ReconLine): boolean {
  const unitsOk = sameNumber(line.books_units ?? null, line.statement_units ?? null);
  if (!unitsOk) return false;
  if (line.statement_avg_price == null || line.books_avg_price == null) return true;
  return sameNumber(line.books_avg_price, line.statement_avg_price);
}

function cashMatches(line: ReconLine): boolean {
  return sameNumber(line.books_amount, line.statement_amount);
}

function depositMatches(line: ReconLine): boolean {
  return sameNumber(line.books_amount, line.statement_amount);
}

export function lineIsMatch(line: ReconLine): boolean {
  if (line.kind === 'cash') return cashMatches(line);
  if (line.kind === 'lot') return lotMatches(line);
  return depositMatches(line);
}

export function compareChannel(
  state: InvestorState,
  channel: string,
  statement: ReconStatement,
): ReconLine[] {
  const ch = cashSlotKey(channel);
  const lines: ReconLine[] = [];

  const booksCash = findCashesForChannel(getCashes(state), ch || undefined);
  const stmtCash = new Map(statement.cash.map((r) => [r.currency, r]));
  const currencies = new Set<string>([
    ...booksCash.map((c) => c.currency.trim().toUpperCase()),
    ...stmtCash.keys(),
  ]);
  for (const currency of [...currencies].sort()) {
    const b = booksCash.find((c) => c.currency.trim().toUpperCase() === currency);
    const s = stmtCash.get(currency);
    const line: ReconLine = {
      id: cashLineId(currency),
      kind: 'cash',
      currency,
      books_amount: b != null ? b.amount : null,
      statement_amount: s != null ? s.amount : null,
    };
    if (lineIsMatch(line)) line.decision = 'keep';
    lines.push(line);
  }

  const portfolio = getPortfolio(state);
  const booksLots = Object.entries(portfolio).filter(
    ([, h]) => cashSlotKey(h.channel) === ch,
  );
  const stmtLots = new Map(statement.lots.map((r) => [r.ticker.trim().toUpperCase(), r]));
  const booksByTicker = new Map<string, (typeof booksLots)[0]>();
  for (const entry of booksLots) {
    const ticker = holdingBaseKey(entry[0]).toUpperCase();
    if (booksByTicker.has(ticker)) {
      throw new Error(
        `Channel ${ch || '(unassigned)'} has two lots for ${ticker}. Recon needs unique tickers per sleeve.`,
      );
    }
    booksByTicker.set(ticker, entry);
  }
  for (const ticker of [...new Set([...booksByTicker.keys(), ...stmtLots.keys()])].sort()) {
    const b = booksByTicker.get(ticker);
    const s = stmtLots.get(ticker);
    if (b) assertHolding(b[0], b[1]);
    const line: ReconLine = {
      id: lotLineId(ticker),
      kind: 'lot',
      item: ticker,
      books_amount: b ? b[1].avg_price * b[1].units : null,
      statement_amount: s ? s.avg_price != null ? s.avg_price * s.units : null : null,
      books_units: b ? b[1].units : null,
      statement_units: s ? s.units : null,
      books_avg_price: b ? b[1].avg_price : null,
      statement_avg_price: s?.avg_price ?? null,
    };
    if (lineIsMatch(line)) line.decision = 'keep';
    lines.push(line);
  }

  const booksDeps = getDeposits(state).filter((d) => cashSlotKey(d.channel) === ch);
  const stmtDeps = statement.deposits;
  const usedStmt = new Set<number>();
  for (const d of booksDeps) {
    const idx = stmtDeps.findIndex((s, i) => {
      if (usedStmt.has(i)) return false;
      if (d.id && s.id) return s.id === d.id;
      return s.currency === d.currency.trim().toUpperCase() && s.amount === d.amount;
    });
    const s = idx >= 0 ? stmtDeps[idx] : undefined;
    if (idx >= 0) usedStmt.add(idx);
    const id = d.id;
    const line: ReconLine = {
      id: depositLineId(id),
      kind: 'deposit',
      item: id,
      currency: d.currency,
      books_amount: d.amount,
      statement_amount: s != null ? s.amount : null,
    };
    if (lineIsMatch(line)) line.decision = 'keep';
    lines.push(line);
  }
  stmtDeps.forEach((s, i) => {
    if (usedStmt.has(i)) return;
    const id = s.id ?? `${s.currency}:${s.amount}`;
    const line: ReconLine = {
      id: depositLineId(id),
      kind: 'deposit',
      item: id,
      currency: s.currency,
      books_amount: null,
      statement_amount: s.amount,
    };
    if (lineIsMatch(line)) line.decision = 'keep';
    lines.push(line);
  });

  return lines;
}
