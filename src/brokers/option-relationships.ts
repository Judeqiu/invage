import { createHash } from 'node:crypto';
import { SaxesParser } from 'saxes';
import { addDecimals, decimal, validDate } from './option-executions.js';
import { canonicalOptionUnderlying, optionUnderlyingFromBroker } from './option-symbol.js';
import { moomooContractMetadata } from '../moomoo/moomoo-history.js';
import type { MooMooRawBundle } from '../moomoo/moomoo-types.js';

export interface RollContract {
  underlying: string; right: 'put' | 'call'; expiry: string; strike: string;
  multiplier: string; currency: string;
}
export interface RollSource { id: string; version: string; }
export interface RollFill {
  id: string; order: string; parent: string; prefix: string; account: string;
  contract: RollContract; at: string; clock: string; quantity: string;
  side: 'buy' | 'sell'; effect: 'open' | 'close' | 'unknown';
  cash: string | null; basis: 'net' | 'gross'; terminal: boolean; source: RollSource;
  gross_cash?: string;
  expected_quantity?: string;
}
export interface OptionRelationship {
  id: string; channel: string; broker_id: string; account_id: string;
  evidence: 'order' | 'execution' | 'possible' | 'review'; reason: string;
  old: RollContract; replacement: RollContract; closed_quantity: string; opened_quantity: string;
  at: string; through: string; clock: string; side: 'short' | 'long';
  replacement_effect: RollFill['effect'] | 'mixed';
  cash: string | null; cash_basis: 'net' | 'gross' | 'unknown';
  gross_cash?: string | null;
  closing_fills: string[]; opening_fills: string[]; orders: string[]; parent: string | null;
  sources: RollSource[];
}
export interface RelationshipGroup {
  id: string; broker_id: string; channel: string; account_id: string; underlying: string;
  latest: RollContract; latest_quantity: string; last_at: string;
  relationships: OptionRelationship[]; continuity: 'unverified';
}
type Row = Record<string, unknown>;
function record(v: unknown): Row {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid broker history row');
  return v as Row;
}
function rows(v: unknown): Row[] { if (!Array.isArray(v)) throw new Error('Invalid broker history list'); return v.map(record); }
function text(v: unknown): string {
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error('Unsafe broker identifier');
  if ((typeof v !== 'string' && typeof v !== 'number') || !String(v).trim()) throw new Error('Missing broker field');
  return String(v).trim();
}
function num(v: unknown): string { return decimal(String(v)); }
function normalize(v: string): string { return addDecimals(v, '0').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'); }
function positive(v: unknown): string {
  const s = num(v); if (s.startsWith('-') || !/[1-9]/.test(s)) throw new Error('Non-positive contract value'); return normalize(s);
}
function negate(v: string): string { return v.startsWith('-') ? v.slice(1) : `-${v}`; }
function multiply(...vs: string[]): string {
  let n = 1n, scale = 0;
  for (const v of vs) { decimal(v); scale += v.split('.')[1]?.length ?? 0; n *= BigInt(v.replace('.', '')); }
  const negative = n < 0n; const digits = (negative ? -n : n).toString().padStart(scale + 1, '0');
  return normalize(`${negative ? '-' : ''}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`);
}
function scaled(v: unknown, scale: unknown): string {
  const n = Number(scale ?? 0); if (!Number.isInteger(n) || n < 0 || n > 18) throw new Error('Invalid quantity scale');
  return multiply(num(v), n ? `0.${'0'.repeat(n - 1)}1` : '1');
}
function ymd(v: unknown): string {
  const date = text(v).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  if (!validDate(date)) throw new Error('Invalid broker date'); return date;
}
function timestamp(v: unknown, micros = false, timeZone = 'America/New_York'): string {
  const raw = typeof v === 'string' && !/^\d+$/.test(v) ? v : Number(micros ? BigInt(text(v)) / 1000n : text(v));
  const d = new Date(raw); if (!Number.isFinite(d.getTime())) throw new Error('Invalid fill timestamp');
  const ps = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const p = (t: string) => ps.find(x => x.type === t)!.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
}
function contract(underlying: unknown, right: unknown, expiry: unknown, strike: unknown,
  multiplier: unknown, currency: unknown): RollContract {
  const r = String(right).toUpperCase();
  if (!['P', 'PUT', 'C', 'CALL'].includes(r)) throw new Error('Invalid option right');
  const ccy = text(currency); if (!/^[A-Z]{3,4}$/.test(ccy)) throw new Error('Invalid currency');
  const result: RollContract = { underlying: text(underlying), right: r === 'P' || r === 'PUT' ? 'put' : 'call',
    expiry: ymd(expiry), strike: positive(strike), multiplier: positive(multiplier), currency: ccy };
  return { ...result, underlying: canonicalOptionUnderlying(result.underlying,
    { ...result, strike: Number(result.strike) }) };
}
export function rollContractKey(c: RollContract): string { return JSON.stringify(c); }
function identity(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24); }

/** Extract linkage directly from retained evidence, independently of today's holdings. */
export function parseRelationshipArchive(broker: string, bytes: Buffer, account: string, source: RollSource, verifiedMultipliers?: ReadonlyMap<string,string>): RollFill[] {
  const fills: RollFill[] = [];
  if (broker === 'ibkr') {
    const parser = new SaxesParser({ xmlns: false }); const path: string[] = []; let statementAccount = '';
    parser.on('doctype', () => { throw new Error('Document types are prohibited'); });
    parser.on('opentag', tag => {
      if (tag.name === 'FlexStatement') statementAccount = String(tag.attributes.accountId ?? '');
      if (tag.name === 'Trade' && path.at(-1) === 'Trades' && statementAccount === account) {
        const r = tag.attributes;
        if (r.accountId !== account) throw new Error('Trade account mismatch');
        if (r.assetCategory === 'OPT' && r.levelOfDetail === 'EXECUTION') {
          if (r.origTradeID && r.origTradeID !== '0') throw new Error('Trade correction needs reconciliation');
          const side = r.buySell; const effect = r.openCloseIndicator;
          if (!['BUY', 'SELL'].includes(side) || !['O', 'C'].includes(effect)) throw new Error('Unknown option action');
          const match = text(r.dateTime).match(/^(\d{8});(\d{2})(\d{2})(\d{2})$/);
          if (!match) throw new Error('Invalid execution clock');
          const at = `${ymd(match[1])}T${match[2]}:${match[3]}:${match[4]}`;
          if (!Number.isFinite(Date.parse(at))) throw new Error('Invalid execution time');
          const terminal = r.transactionType === 'BookTrade';
          if (!terminal && r.transactionType !== 'ExchTrade') throw new Error('Unsupported option transaction');
          const q = num(r.quantity); if (q.startsWith('-') !== (side === 'SELL')) throw new Error('Quantity sign mismatch');
          if (r.ibCommissionCurrency !== r.currency) throw new Error('Commission currency mismatch');
          fills.push({ id: text(r.tradeID), order: text(r.ibOrderID), parent: r.brokerageOrderID || '',
            prefix: (r.ibExecID || '').split('.').slice(0, 2).join('.'), account,
            contract: contract(r.underlyingSymbol, r.putCall, r.expiry, r.strike, r.multiplier, r.currency),
            at, clock: 'Broker-reported clock', quantity: positive(q.replace(/^-/, '')),
            side: side === 'BUY' ? 'buy' : 'sell', effect: effect === 'O' ? 'open' : 'close',
            cash: num(r.netCash), basis: 'net', terminal, source,
            ...(r.proceeds !== undefined ? { gross_cash: num(r.proceeds) } : {}) });
        }
      }
      path.push(tag.name);
    });
    parser.on('closetag', () => { if (path.pop() === 'FlexStatement') statementAccount = ''; });
    parser.write(bytes.toString('utf8')).close(); return fills;
  }
  const b = record(JSON.parse(bytes.toString('utf8')));
  if (broker === 'moomoo') {
    if (text(b.acc_id) !== account) throw new Error('Archive account mismatch');
    if (!b.fills_history) return fills;
    const metadata = moomooContractMetadata(b as unknown as MooMooRawBundle,[],verifiedMultipliers);
    for (const r of rows(record(b.fills_history).rows)) {
      const code = String(r.code); const m = code.match(/^(US|HK)\.(.+?)(\d{6})([PC])(\d+)$/); if (!m) continue;
      if (r.status !== 'OK') throw new Error('Changed option fill needs reconciliation');
      const actions: Record<string, [RollFill['side'], RollFill['effect']]> = {
        BUY_BACK: ['buy', 'close'], SELL_SHORT: ['sell', 'open'], BUY: ['buy', 'open'], SELL: ['sell', 'close'],
      };
      const action = actions[String(r.trd_side)]; if (!action) throw new Error('Unknown fill direction');
      // Historical contract sizes can be absent.
      // Preserve linkage while withholding cash estimates unless size is explicitly reported.
      const profile = metadata.get(code), size = profile?.multiplier;
      const underlying = optionUnderlyingFromBroker({ market: m[1], optionRoot: m[2], owner: profile?.owner });
      if (typeof underlying !== 'string') throw new Error(underlying.skip);
      const c = contract(underlying, m[4], `20${m[3]}`, multiply(m[5], '0.001'), size ?? '100', m[1] === 'US' ? 'USD' : 'HKD');
      const quantity = positive(r.qty); const cash = multiply(positiveOrZero(r.price), quantity, c.multiplier);
      fills.push({ id: text(r.deal_id), order: text(r.order_id), parent: text(r.order_id), prefix: '',
        account, contract: c, quantity, side: action[0], effect: action[1], at: timestamp(r.create_time, true, m[1] === 'US' ? 'America/New_York' : 'Asia/Hong_Kong'),
        clock: m[1] === 'US' ? 'America/New_York' : 'Asia/Hong_Kong', cash: size ? action[0] === 'buy' ? negate(cash) : cash : null,
        basis: 'gross', terminal: false, source });
    }
  } else if (broker === 'tiger') {
    if (text(b.account) !== account) throw new Error('Archive account mismatch');
    if (!b.option_history) return fills;
    const history = record(b.option_history); const orders = new Map(rows(history.orders).map(o => {
      if (text(o.account) !== account) throw new Error('Order account mismatch'); return [text(o.id), o];
    }));
    for (const r of rows(history.transactions)) {
      if (text(r.accountId) !== account || r.secType !== 'OPT') throw new Error('Transaction account mismatch');
      const order = orders.get(text(r.orderId)); if (!order) throw new Error('Missing order metadata');
      if (r.market !== 'US') throw new Error('Unsupported history market');
      let multiplier: unknown = '100';
      let expected_quantity: string | undefined;
      if (order.secType === 'MLEG') {
        const leg = rows(order.legs).find(l => l.symbol === r.symbol && l.expiry === r.expiry &&
          Number(l.strike) === Number(r.strike) && l.right === r.right);
        if (!leg) throw new Error('Missing parent contract leg'); multiplier = leg.multiplier;
        expected_quantity = positive(scaled(leg.filledQuantity, leg.filledQuantityScale));
      }
      const c = contract(r.symbol, r.right, r.expiry, r.strike, multiplier, r.currency);
      const quantity = positive(scaled(r.filledQuantity, r.filledQuantityScale));
      const gross = positiveOrZero(r.filledAmount);
      if (normalize(gross) !== multiply(positiveOrZero(r.filledPrice), quantity, c.multiplier)) throw new Error('Fill amount disagrees with size');
      const side = r.action === 'BUY' ? 'buy' : r.action === 'SELL' ? 'sell' : null;
      if (!side) throw new Error('Unknown trade side');
      fills.push({ id: text(r.id), order: text(r.orderId), parent: order.secType === 'MLEG' ? text(order.id) : '',
        prefix: '', account, contract: c, quantity, side,
        effect: order.secType === 'OPT' && typeof order.isOpen === 'boolean' ? order.isOpen ? 'open' : 'close' : 'unknown',
        at: timestamp(r.transactionTime), clock: 'America/New_York', cash: side === 'buy' ? negate(gross) : gross,
        basis: 'gross', terminal: false, source, ...(expected_quantity ? { expected_quantity } : {}) });
    }
    for (const o of orders.values()) {
      const attrs = Array.isArray(o.attrList) ? o.attrList : [];
      if (o.secType !== 'OPT' || !attrs.some(x => ['ASSIGNMENT', 'EXERCISE', 'EXPIRE', 'CASH_SETTLE'].includes(String(x))) || Number(o.filledQuantity) <= 0) continue;
      const side = o.action === 'BUY' ? 'buy' : o.action === 'SELL' ? 'sell' : null;
      if (!side) throw new Error('Unknown lifecycle side');
      fills.push({ id: `event:${text(o.id)}`, order: text(o.id), parent: '', prefix: '', account,
        contract: contract(o.symbol, o.right, o.expiry, o.strike, '100', o.currency),
        quantity: positive(scaled(o.filledQuantity, o.filledQuantityScale)), side, effect: 'close',
        at: timestamp(o.latestTime ?? o.openTime), clock: 'America/New_York', cash: null,
        basis: 'gross', terminal: true, source });
    }
  } else if (broker === 'webull') {
    if (text(b.account_id) !== account) throw new Error('Archive account mismatch');
    if (!b.option_history) return fills;
    for (const group of rows(b.option_history)) for (const r of rows(group.orders)) {
      if (r.instrument_type !== 'OPTION' || Number(r.filled_quantity ?? 0) <= 0) continue;
      if (!['FILLED', 'CANCELED', 'CANCELLED', 'FAILED'].includes(String(r.status))) continue;
      const legs = rows(r.legs); if (legs.length !== 1) continue;
      const l = legs[0]; const side = r.side === 'BUY' ? 'buy' : ['SELL', 'SHORT'].includes(String(r.side)) ? 'sell' : null;
      if (!side || l.side !== r.side) throw new Error('Order side mismatch');
      const c = contract(l.symbol, l.option_type, l.option_expire_date, l.strike_price, l.option_contract_multiplier, 'USD');
      const quantity = positive(r.filled_quantity); const gross = multiply(positiveOrZero(r.filled_price), quantity, c.multiplier);
      const intent = r.position_intent;
      if (intent != null && !['BUY_TO_OPEN', 'BUY_TO_CLOSE', 'SELL_TO_OPEN', 'SELL_TO_CLOSE'].includes(String(intent))) throw new Error('Unknown position intent');
      if (intent != null && !String(intent).startsWith(side.toUpperCase())) throw new Error('Intent disagrees with side');
      fills.push({ id: text(r.order_id), order: text(r.order_id), parent: '', prefix: '', account, contract: c,
        quantity, side, effect: intent == null ? 'unknown' : String(intent).endsWith('_OPEN') ? 'open' : 'close',
        at: timestamp(r.filled_time_at ?? r.filled_time), clock: 'America/New_York',
        cash: side === 'buy' ? negate(gross) : gross, basis: 'gross', terminal: false, source });
    }
  }
  return fills;
}
function positiveOrZero(v: unknown): string { const n = num(v); if (n.startsWith('-')) throw new Error('Negative trade amount'); return normalize(n); }

interface Leg { fills: RollFill[]; contract: RollContract; quantity: string; first: string; last: string; }
function leg(fs: RollFill[]): Leg {
  return { fills: fs, contract: fs[0].contract, quantity: normalize(addDecimals(...fs.map(f => f.quantity))),
    first: fs.map(f => f.at).sort()[0], last: fs.map(f => f.at).sort().at(-1)! };
}
function compatible(c: Leg, o: Leg): boolean {
  return c.contract.underlying === o.contract.underlying && c.contract.right === o.contract.right &&
    c.contract.currency === o.contract.currency && c.contract.multiplier === o.contract.multiplier &&
    rollContractKey(c.contract) !== rollContractKey(o.contract) && c.fills[0].side !== o.fills[0].side;
}

/** Every duplicate fill must agree economically. Conflicts fail rather than publish uncertain totals. */
export function buildOptionRelationships(broker: string, channel: string, account: string, input: RollFill[]): OptionRelationship[] {
  const unique = new Map<string, RollFill>(); const provenance = new Map<string, RollSource[]>();
  for (const f of input) {
    if (f.account !== account) throw new Error('Relationship account mismatch');
    const { source, ...core } = f; const prior = unique.get(f.id);
    if (prior) {
      const { source: ignored, cash: priorCash, gross_cash: priorGross, ...priorCore } = prior;
      const { cash, gross_cash: gross, ...economic } = core;
      if (JSON.stringify(economic) !== JSON.stringify(priorCore) || cash != null && priorCash != null && normalize(cash) !== normalize(priorCash) ||
        gross != null && priorGross != null && normalize(gross) !== normalize(priorGross)) throw new Error('Conflicting archived option fills');
      // A later archive can supply previously missing contract-size/cash evidence.
      if (prior.cash == null && f.cash != null) prior.cash = f.cash;
      if (prior.gross_cash == null && f.gross_cash != null) prior.gross_cash = f.gross_cash;
    }
    else unique.set(f.id, { ...f });
    const sources = provenance.get(f.id) ?? []; if (!sources.some(s => s.id === source.id && s.version === source.version)) sources.push(source);
    provenance.set(f.id, sources);
  }
  // Infer only from an observed prior balance, including lifecycle deliveries. Unknown initial positions stay unknown.
  const balances = new Map<string, string>();
  for (const f of [...unique.values()].sort((a, b) => a.at.localeCompare(b.at) || Number(a.terminal) - Number(b.terminal) || a.id.localeCompare(b.id))) {
    const key = rollContractKey(f.contract); const before = balances.get(key) ?? '0';
    if (f.effect === 'unknown') {
      const closing = f.side === 'buy' ? before.startsWith('-') : !before.startsWith('-') && /[1-9]/.test(before);
      const remainder = addDecimals(before.replace(/^-/, ''), negate(f.quantity));
      f.effect = closing && !remainder.startsWith('-') ? 'close' : !closing && /[1-9]/.test(before) ? 'open' :
        f.side === 'sell' && before === '0' ? 'open' : 'unknown';
    }
    balances.set(key, normalize(addDecimals(before, f.side === 'buy' ? f.quantity : negate(f.quantity))));
  }
  const trades = [...unique.values()].filter(f => !f.terminal); const used = new Set<string>(); const result: OptionRelationship[] = [];
  const make = (c: Leg, o: Leg, evidence: OptionRelationship['evidence'], parent: string | null) => {
    const all = [...c.fills, ...o.fills];
    if (!compatible(c, o) || all.some(f => used.has(f.id))) return;
    if (evidence !== 'possible' && c.quantity !== o.quantity) evidence = 'review';
    if (evidence !== 'possible' && (c.fills.some(f => f.effect !== 'close') || o.fills.some(f => f.effect !== 'open'))) evidence = 'review';
    if (all.some(f => f.expected_quantity && f.expected_quantity !== (c.fills.includes(f) ? c.quantity : o.quantity))) evidence = 'review';
    const cash = evidence === 'review' || evidence === 'possible' || all.some(f => f.cash == null) ? null : addDecimals(...all.map(f => f.cash!));
    const sources = [...new Map(all.flatMap(f => provenance.get(f.id)!).map(s => [`${s.id}:${s.version}`, s])).values()];
    const at = [c.first, o.first].sort()[0]; const through = [c.last, o.last].sort().at(-1)!;
    result.push({ id: identity([channel, account, c.fills.map(f => f.id).sort(), o.fills.map(f => f.id).sort()]),
      channel, broker_id: broker, account_id: account, evidence,
      reason: evidence === 'order' ? 'Shared parent order; closing and opening quantities and position effects reconcile.' :
        evidence === 'execution' ? 'Matching execution-ID prefixes, timestamps, quantities and explicit position effects support this inferred link.' :
          evidence === 'review' ? 'Shared order exists, but quantities or closing/opening position effects need review.' :
            'Nearby separate orders with an observed prior position support a candidate; shared order linkage and roll intent are unproven.',
      old: c.contract, replacement: o.contract, closed_quantity: c.quantity, opened_quantity: o.quantity,
      at, through, clock: all[0].clock, side: c.fills[0].side === 'buy' ? 'short' : 'long',
      replacement_effect: new Set(o.fills.map(f => f.effect)).size === 1 ? o.fills[0].effect : 'mixed',
      cash, cash_basis: cash == null ? 'unknown' : all.every(f => f.basis === 'net') ? 'net' : 'gross',
      gross_cash: evidence === 'review' || evidence === 'possible' || all.some(f => f.gross_cash == null && (f.basis !== 'gross' || f.cash == null))
        ? null : addDecimals(...all.map(f => f.gross_cash ?? f.cash!)),
      closing_fills: c.fills.map(f => f.id), opening_fills: o.fills.map(f => f.id),
      orders: [...new Set(all.map(f => f.order))], parent, sources });
    all.forEach(f => used.add(f.id));
  };
  const parents = new Map<string, RollFill[]>();
  for (const f of trades) if (f.parent && f.parent !== 'NONE_CLIENT_ORDER_ID') parents.set(f.parent, [...(parents.get(f.parent) ?? []), f]);
  for (const [parent, fs] of parents) {
    const contracts = new Map<string, RollFill[]>();
    for (const f of fs) { const key = `${rollContractKey(f.contract)}:${f.side}`; contracts.set(key, [...(contracts.get(key) ?? []), f]); }
    if (contracts.size !== 2) continue;
    const legs = [...contracts.values()].map(leg);
    // Explicit intent wins; otherwise the prior balance must identify the closing leg.
    const c = legs.find(l => l.fills.every(f => f.effect === 'close'));
    const o = c && legs.find(l => l !== c);
    if (c && o) make(c, o, 'order', parent);
    // Do not relabel newly opened spreads or entirely unknown combinations as rolls.
  }
  if (broker === 'ibkr') {
    const prefixes = new Map<string, RollFill[]>();
    for (const f of trades) if (!used.has(f.id) && f.prefix.includes('.')) prefixes.set(f.prefix, [...(prefixes.get(f.prefix) ?? []), f]);
    const pairs = new Map<string, { c: RollFill[]; o: RollFill[] }>();
    for (const fs of prefixes.values()) {
      if (fs.length !== 2) continue;
      const c = fs.find(f => f.effect === 'close'); const o = fs.find(f => f.effect === 'open');
      if (!c || !o || c.at !== o.at || c.quantity !== o.quantity || !compatible(leg([c]), leg([o]))) continue;
      const key = `${c.order}:${o.order}:${rollContractKey(c.contract)}:${rollContractKey(o.contract)}`;
      const pair = pairs.get(key) ?? { c: [], o: [] }; pair.c.push(c); pair.o.push(o); pairs.set(key, pair);
    }
    for (const p of pairs.values()) {
      // Inferred links must cover the complete contract orders, not a selected subset of their fills.
      if (trades.filter(f => f.order === p.c[0].order).length !== p.c.length || trades.filter(f => f.order === p.o[0].order).length !== p.o.length) continue;
      make(leg(p.c), leg(p.o), 'execution', null);
    }
  }
  if (broker === 'webull') {
    const closes = trades.filter(f => f.effect === 'close' && !used.has(f.id));
    const opens = trades.filter(f => f.effect === 'open' && !used.has(f.id));
    const candidates = closes.flatMap(c => opens.filter(o => c.at.slice(0, 10) === o.at.slice(0, 10) &&
      Math.abs(Date.parse(c.at + 'Z') - Date.parse(o.at + 'Z')) <= 600_000 && compatible(leg([c]), leg([o])))
      .map(o => ({ c, o })));
    for (const p of candidates) if (candidates.filter(x => x.c.id === p.c.id || x.o.id === p.o.id).length === 1) make(leg([p.c]), leg([p.o]), 'possible', null);
  }
  return result.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

export interface OptionVerticalSpread {
  id: string; channel: string; account_id: string; parent: string;
  long: RollContract; short: RollContract; quantity: string;
  at: string; through: string; gross_cash: string | null;
  opening_fills: string[];
}

/** A vertical requires one authoritative parent, explicit opening effects and equal leg sizes. */
export function buildOptionVerticalSpreads(channel: string, account: string, fills: RollFill[]): OptionVerticalSpread[] {
  const unique = new Map<string, RollFill>();
  for (const f of fills) {
    if (f.account !== account) throw new Error('Spread account mismatch');
    const prior = unique.get(f.id);
    if (prior) {
      const { source: ignored, cash: aCash, gross_cash: aGross, ...a } = prior;
      const { source: alsoIgnored, cash: bCash, gross_cash: bGross, ...b } = f;
      if (JSON.stringify(a) !== JSON.stringify(b) || aCash != null && bCash != null && normalize(aCash) !== normalize(bCash) ||
        aGross != null && bGross != null && normalize(aGross) !== normalize(bGross)) throw new Error('Conflicting archived spread fills');
      if (prior.cash == null && f.cash != null) prior.cash = f.cash;
      if (prior.gross_cash == null && f.gross_cash != null) prior.gross_cash = f.gross_cash;
    } else unique.set(f.id, { ...f });
  }
  const orders = new Map<string, RollFill[]>();
  for (const f of unique.values()) if (f.parent && f.parent !== 'NONE_CLIENT_ORDER_ID' && !f.terminal) {
    orders.set(f.parent, [...(orders.get(f.parent) ?? []), f]);
  }
  const out: OptionVerticalSpread[] = [];
  for (const [parent, fs] of orders) {
    if (fs.some(f => f.effect !== 'open')) continue;
    const buys = fs.filter(f => f.side === 'buy'), sells = fs.filter(f => f.side === 'sell');
    if (!buys.length || !sells.length || new Set(buys.map(f => rollContractKey(f.contract))).size !== 1 ||
      new Set(sells.map(f => rollContractKey(f.contract))).size !== 1) continue;
    const long = leg(buys), short = leg(sells);
    if (long.quantity !== short.quantity || long.contract.underlying !== short.contract.underlying ||
      long.contract.right !== short.contract.right || long.contract.expiry !== short.contract.expiry ||
      long.contract.currency !== short.contract.currency || long.contract.multiplier !== short.contract.multiplier ||
      long.contract.strike === short.contract.strike) continue;
    const dates = fs.map(f => f.at).sort();
    out.push({ id: identity([channel, account, parent, fs.map(f => f.id).sort()]), channel, account_id: account,
      parent, long: long.contract, short: short.contract, quantity: long.quantity, at: dates[0], through: dates.at(-1)!,
      opening_fills: fs.map(f => f.id),
      gross_cash: fs.some(f => f.gross_cash == null && (f.basis !== 'gross' || f.cash == null)) ? null
        : addDecimals(...fs.map(f => f.gross_cash ?? f.cash!)) });
  }
  return out;
}

/** Conservative single-path grouping. Ambiguous, resized, or intervened paths remain separate folders. */
export function groupOptionRelationships(relationships: OptionRelationship[], fills: RollFill[]): RelationshipGroup[] {
  const groups: RelationshipGroup[] = []; const unused = new Map(relationships.map(r => [r.id, r]));
  const canFollow = (a: OptionRelationship, b: OptionRelationship) => a.channel === b.channel && a.account_id === b.account_id &&
    a.side === b.side && a.through < b.at && a.opened_quantity === b.closed_quantity &&
    a.evidence !== 'possible' && b.evidence !== 'possible' && a.evidence !== 'review' && b.evidence !== 'review' &&
    rollContractKey(a.replacement) === rollContractKey(b.old) &&
    !fills.some(f => f.account === a.account_id && f.at > a.through && f.at < b.at &&
      rollContractKey(f.contract) === rollContractKey(a.replacement));
  for (const latest of relationships) {
    if (!unused.has(latest.id)) continue;
    const chain = [latest]; unused.delete(latest.id);
    for (;;) {
      const current = chain.at(-1)!; const previous = [...unused.values()].filter(r => canFollow(r, current));
      if (previous.length !== 1 || relationships.filter(r => canFollow(previous[0], r)).length !== 1) break;
      chain.push(previous[0]); unused.delete(previous[0].id);
    }
    groups.push({ id: identity([latest.channel, latest.account_id, chain.map(r => r.id).sort()]),
      channel: latest.channel, broker_id: latest.broker_id, account_id: latest.account_id,
      underlying: latest.old.underlying, latest: latest.replacement, latest_quantity: latest.opened_quantity,
      last_at: latest.at, relationships: chain, continuity: 'unverified' });
  }
  return groups;
}
