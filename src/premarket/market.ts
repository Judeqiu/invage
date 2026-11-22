import type { OptionsResult } from 'yahoo-finance2/modules/options';
import { combinedCredentials, readBrokerAccountModel } from '../brokers/accounts.js';
import { validDate } from '../brokers/option-executions.js';
import { parseBrokerOptionCode } from '../brokers/option-symbol.js';
import { snapshotFromYahooQuote } from '../market/fetch-prices.js';
import type { Holding } from '../market/types.js';
import { yf } from '../market/yf-client.js';
import { readReportMarketData, type MooMooCredentials } from '../moomoo/moomoo-client.js';
import { parseSignAlg } from '../moomoo/moomoo-sign.js';
import type { InvestorState } from '../state/portfolio-state.js';
import type { ListedOption, OptionQuote, StockQuote } from './decisions.js';
import { usSessionDate } from './session.js';

type YahooSeries = OptionsResult['options'][number];
const OCC_STANDARD = 'https://www.theocc.com/clearance-and-settlement/clearing/equity-options-product-specifications';
// Published OCC standard US stock-option terms, applied only to exact regular equity series.
const OCC_STANDARD_SHARES = 100;
// Provider page and request sizes. Each scan continues through every batch.
const CLOUD_CHAIN_EXPIRIES = 20;
const CLOUD_SNAPSHOT_CODES = 400;
const snapshotPath = '/api/v1.0/quote/snapshot';
const bookPath = '/api/v1.0/quote/order-book';
const yahooReference = (symbol: string) => `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/options/`;
const asNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const ymd = (value: Date) => value.toISOString().slice(0, 10);
function reportedDate(value: unknown) {
  const date = typeof value === 'string' ? value.replaceAll('/', '-') : '';
  return validDate(date) ? date : null;
}
export interface CalendarEvent {
  kind: 'earnings' | 'ex-dividend' | 'split';
  date: string;
  source: string;
  detail: string;
}
export interface UnderlyingEvidence {
  stock: StockQuote | null;
  isUsEquity: boolean;
  earnings: CalendarEvent | null;
}
export interface ChainEvidence {
  options: ListedOption[];
  events: CalendarEvent[];
  notices: string[];
}

export async function readStock(symbol: string): Promise<UnderlyingEvidence> {
  const yahooSymbol = symbol.replaceAll('.', '-');
  const quote = await yf.quote(yahooSymbol);
  if (quote.symbol !== yahooSymbol || quote.currency !== 'USD' || quote.exchangeTimezoneName !== 'America/New_York' ||
      (quote.quoteType !== 'EQUITY' && quote.quoteType !== 'ETF')) return { stock: null, isUsEquity: false, earnings: null };
  let stock: StockQuote | null = null;
  try {
    const snap = snapshotFromYahooQuote(yahooSymbol, quote);
    if (snap.asOf !== null) stock = { price: snap.price, currency: snap.currency, asOf: snap.asOf,
      source: yahooReference(yahooSymbol), field: snap.priceField };
  } catch { /* Terms are independent of a priced quote. */ }
  const earnings = quote.isEarningsDateEstimate === false && quote.earningsTimestamp instanceof Date
    ? { kind: 'earnings' as const, date: usSessionDate(quote.earningsTimestamp), source: yahooReference(yahooSymbol),
      detail: `Provider flags this earnings release as confirmed. Reported time ${quote.earningsTimestamp.toISOString()}.` }
    : null;
  return { stock, isUsEquity: true, earnings };
}

/** Option books from Yahoo have collection time and last trade time, but no book timestamp. */
function yahooOptions(symbol: string, series: YahooSeries, collectedAt: string): ListedOption[] {
  const expiry = ymd(series.expirationDate);
  return (['call', 'put'] as const).flatMap(right => (right === 'put' ? series.puts : series.calls).flatMap(row => {
    if (ymd(row.expiration) !== expiry) return [];
    const code = parseBrokerOptionCode(row.contractSymbol);
    const standard = row.contractSize === 'REGULAR' && row.currency === 'USD' && !('skip' in code) &&
      code.root === symbol.replaceAll('.', '') && code.right === right && code.strike === row.strike && code.expiry === expiry;
    return [{ id: row.contractSymbol, underlying: symbol, right, strike: row.strike, expiry,
      currency: row.currency ?? '', premiumMultiplier: standard ? OCC_STANDARD_SHARES : null,
      shares: standard ? OCC_STANDARD_SHARES : null, exercise: standard ? 'american' as const : null,
      shareOnly: standard, source: standard ? OCC_STANDARD : yahooReference(symbol),
      quote: { source: yahooReference(symbol), collectedAt, bookAsOf: null, lastTradeAt: row.lastTradeDate?.toISOString() ?? null,
        bid: asNumber(row.bid), ask: asNumber(row.ask), bidSize: null, askSize: null, volume: asNumber(row.volume),
        openInterest: asNumber(row.openInterest), ivPercent: typeof row.impliedVolatility === 'number' ? row.impliedVolatility * 100 : null,
        delta: null, gamma: null, theta: null, vega: null, rho: null } }];
  }));
}

function cloudReader(state: InvestorState) {
  const model = readBrokerAccountModel(state);
  for (const connection of Object.values(model.connections)) {
    const broker = connection.broker_id;
    if (!connection.enabled || (broker !== 'moomoo' && broker !== 'futubull')) continue;
    const saved = combinedCredentials(model, connection);
    if (!saved.app_key || !saved.private_key) continue;
    const credentials: MooMooCredentials = { broker, app_key: saved.app_key, private_key: saved.private_key, sign_alg: parseSignAlg(saved.sign_alg) };
    return {
      broker,
      get: (path: string, params?: Record<string, string>) => readReportMarketData({ path, credentials,
        query: params && new URLSearchParams(params).toString() }),
      post: (path: string, body: Record<string, unknown>) => readReportMarketData({ path, credentials, body }),
    };
  }
  return null;
}

async function corporateEvents(cloud: NonNullable<ReturnType<typeof cloudReader>>, path: string, date: string, notices: string[]) {
  const events: CalendarEvent[] = [];
  for (const kind of ['ex-dividend', 'split'] as const) {
    const endpoint = kind === 'ex-dividend' ? 'dividends' : 'splits';
    try {
      const rows = (await cloud.get(`${path}/corporate-actions/${endpoint}`))[kind === 'ex-dividend' ? 'dividend_list' : 'split_list'];
      if (!Array.isArray(rows)) throw new Error('Calendar response missing');
      for (const row of rows) {
        const effective = reportedDate(kind === 'ex-dividend' ? row.ex_date : row.ex_date_str);
        const announced = reportedDate(kind === 'ex-dividend' ? row.pub_date : row.dir_deci_pub_date_str);
        if (!effective || effective < date || !announced || announced > date) continue;
        const detail = kind === 'ex-dividend' ? [row.dividend_per_share, row.currency].filter(x => x != null).join(' ')
          : typeof row.rate === 'string' ? row.rate : '';
        events.push({ kind, date: effective, source: `${cloud.broker} Cloud ${path}/corporate-actions/${endpoint}`,
          detail: [`Announced ${announced}`, detail].filter(Boolean).join(' · ') });
      }
    } catch { notices.push(`Confirmed ${endpoint} unavailable from ${cloud.broker} Cloud.`); }
  }
  return events;
}

function cloudCodeKey(code: string) {
  const parsed = parseBrokerOptionCode(code.replace(/^US\./, ''));
  return 'skip' in parsed ? null : JSON.stringify(parsed);
}

async function readYahooChain(symbol: string, date: string, heldDates: string[], notices: string[]) {
  const yahooSymbol = symbol.replaceAll('.', '-');
  const options = new Map<string, ListedOption>();
  const yahooDates = new Set(heldDates);
  const source = await yf.options(yahooSymbol).catch(() => null);
  if (source?.quote.symbol === yahooSymbol) {
    for (const expiry of source.expirationDates) if (ymd(expiry) >= date) yahooDates.add(ymd(expiry));
  } else notices.push('Yahoo expiration list unavailable or did not match the underlying.');
  for (const expiry of [...yahooDates].sort()) {
    try {
      const raw = source?.options.some(series => ymd(series.expirationDate) === expiry)
        ? source : await yf.options(yahooSymbol, { date: new Date(expiry) });
      const matches = raw.options.filter(series => ymd(series.expirationDate) === expiry);
      if (raw.quote.symbol !== yahooSymbol || matches.length !== 1) throw new Error('Exact expiry missing');
      for (const option of yahooOptions(symbol, matches[0], new Date().toISOString())) options.set(option.id, option);
    } catch { notices.push(`Yahoo chain unavailable for ${expiry}.`); }
  }

  return options;
}

export function matchListed(holding: Holding, options: ListedOption[]) {
  const o = holding.option!;
  const exact = options.filter(item => item.right === o.right && item.strike === o.strike && item.expiry === o.expiry &&
    item.currency === holding.currency && item.underlying === o.underlying);
  const nativeCode = holding.broker_ref?.native_id?.replace(/^US\./, '').replaceAll(' ', '');
  const native = nativeCode ? parseBrokerOptionCode(nativeCode) : null;
  const matches = native && !('skip' in native) ? exact.filter(item => {
    const id = parseBrokerOptionCode(item.id.replace(/^US\./, ''));
    return !('skip' in id) && id.root === native.root;
  }) : exact;
  if (matches.length !== 1) return null;
  const item = matches[0];
  // Adjusted deliverables and opaque broker IDs may share strike and expiry.
  if (!item.shareOnly) return native && !('skip' in native) ? item : null;
  return item.shares === o.multiplier && o.settlement === 'physical' ? item : null;
}

type CloudReader = NonNullable<ReturnType<typeof cloudReader>>;
type CloudContract = {
  code: string;
  strike_time: string;
  strike_price: number;
  option_type: 'PUT' | 'CALL';
  option_standard_type?: string;
  lot_size?: number;
};

async function readCloudListings(cloud: CloudReader, owner: string, path: string, date: string, heldDates: string[], notices: string[]) {
  const expiries = new Set(heldDates);
  try {
    const listing = await cloud.get(`${path}/option-expiration`);
    if (!Array.isArray(listing.expiration_list)) throw new Error('Cloud option expiries unavailable');
    for (const item of listing.expiration_list) if (validDate(item?.strike_time) && item.strike_time >= date) expiries.add(item.strike_time);
  } catch { notices.push(`Full ${cloud.broker} Cloud expiration list unavailable.`); }

  const contracts = new Map<string, CloudContract>();
  const observed = new Set<string>();
  async function collect(start: string, end: string) {
    const data = await cloud.get(`${path}/option-chain`, { start, end });
    if (!Array.isArray(data.option_chain)) throw new Error('Cloud chain unavailable');
    let incomplete = false;
    for (const row of data.option_chain) {
      if (!row || row.stock_owner !== owner || !validDate(row.strike_time) || row.strike_time < start || row.strike_time > end ||
          typeof row.code !== 'string' || asNumber(row.strike_price) === null ||
          (row.option_type !== 'PUT' && row.option_type !== 'CALL')) {
        incomplete = true;
        continue;
      }
      contracts.set(row.code, row);
      observed.add(row.strike_time);
    }
    if (incomplete) notices.push(`${cloud.broker} Cloud returned incomplete contract rows for ${start} through ${end}.`);
  }

  const dates = [...expiries].sort();
  for (let cursor = 0; cursor < dates.length; cursor += CLOUD_CHAIN_EXPIRIES) {
    const batch = dates.slice(cursor, cursor + CLOUD_CHAIN_EXPIRIES);
    try { await collect(batch[0], batch.at(-1)!); }
    catch { /* Exact expiry reads below isolate a failed range. */ }
    for (const expiry of batch.filter(value => !observed.has(value))) {
      if (batch.length > 1) {
        try { await collect(expiry, expiry); } catch { /* Report missing evidence below. */ }
      }
      if (!observed.has(expiry)) notices.push(`${cloud.broker} Cloud chain unavailable for ${expiry}.`);
    }
  }
  return [...contracts.values()];
}

type CloudSnapshot = { row: Record<string, unknown>; collectedAt: string };
async function readCloudSnapshots(cloud: CloudReader, contracts: CloudContract[]) {
  const result = new Map<string, CloudSnapshot>();
  for (let cursor = 0; cursor < contracts.length; cursor += CLOUD_SNAPSHOT_CODES) {
    const batch = contracts.slice(cursor, cursor + CLOUD_SNAPSHOT_CODES);
    try {
      const { snapshot_list } = await cloud.post(snapshotPath, { code_list: batch.map(row => row.code) });
      if (!Array.isArray(snapshot_list)) continue;
      const collectedAt = new Date().toISOString();
      const expected = new Map(batch.map(row => [row.code, row]));
      for (const row of snapshot_list) {
        const contract = expected.get(row?.code);
        if (contract && row.option_valid === true && row.option_type === contract.option_type &&
            row.option_strike_price === contract.strike_price) {
          result.set(contract.code, { row, collectedAt });
        }
      }
    } catch { /* Keep the listing and any exact fallback quote. */ }
  }
  return result;
}

function sourceTime(value: unknown): string | null {
  const ms = asNumber(value);
  if (!ms) return null;
  const time = new Date(ms);
  return Number.isFinite(time.getTime()) ? time.toISOString() : null;
}

function snapshotQuote(source: string, { row, collectedAt }: CloudSnapshot): OptionQuote {
  return {
    source, collectedAt, bookAsOf: null, lastTradeAt: null,
    snapshotAsOf: sourceTime(row.update_time), snapshotDate: reportedDate(row.data_date),
    bid: asNumber(row.bid_price), ask: asNumber(row.ask_price), bidSize: asNumber(row.bid_vol), askSize: asNumber(row.ask_vol),
    volume: asNumber(row.volume), openInterest: asNumber(row.option_open_interest), ivPercent: asNumber(row.option_implied_volatility),
    delta: asNumber(row.delta), gamma: asNumber(row.gamma), theta: asNumber(row.theta), vega: asNumber(row.vega), rho: asNumber(row.rho),
    greeksSource: source, greeksCollectedAt: collectedAt,
  };
}

type HeldBook = Pick<OptionQuote, 'source' | 'collectedAt' | 'bookAsOf' | 'bid' | 'ask' | 'bidSize' | 'askSize'>;
async function readHeldBook(cloud: CloudReader, code: string): Promise<HeldBook | null> {
  const result = await cloud.post(bookPath, { code, num: 1 });
  if (!Array.isArray(result) || result.length !== 1 || result[0]?.code !== code || !Array.isArray(result[0].books)) return null;
  const books = result[0].books;
  // A multi-exchange response needs an explicitly aggregated book.
  const aggregated = books.filter((row: { exchange?: string } | null) => row?.exchange === '');
  const book = books.length === 1 ? books[0] : aggregated.length === 1 ? aggregated[0] : null;
  if (!book) return null;
  const precision = asNumber(book.order_volume_precision);
  const volumeScale = precision !== null && Number.isInteger(precision) && precision >= 0 ? 10 ** precision : null;
  const bid = book.bid_flag === 1 && Array.isArray(book.bid_list) ? book.bid_list[0] : undefined;
  const ask = book.ask_flag === 1 && Array.isArray(book.ask_list) ? book.ask_list[0] : undefined;
  const size = (level: { volume?: unknown } | undefined) => {
    const volume = asNumber(level?.volume);
    return volume !== null && volumeScale !== null && Number.isFinite(volumeScale) ? volume / volumeScale : null;
  };
  if (asNumber(bid?.price) === null && asNumber(ask?.price) === null) return null;
  return { source: `${cloud.broker} Cloud ${bookPath}`, collectedAt: new Date().toISOString(),
    bookAsOf: sourceTime(book.exchange_data_time_ms), bid: asNumber(bid?.price), ask: asNumber(ask?.price),
    bidSize: size(bid), askSize: size(ask) };
}

function cloudOption(symbol: string, row: CloudContract, snapshot: CloudSnapshot | undefined,
  yahoo: ListedOption | undefined, listingSource: string, snapshotSource: string): ListedOption {
  const extra = snapshot?.row;
  const providerQuote = snapshot ? snapshotQuote(snapshotSource, snapshot) : undefined;
  const shares = asNumber(row.lot_size);
  const reportedSize = asNumber(extra?.option_contract_size);
  const reportedMultiplier = extra?.option_contract_multiplier;
  const multiplier = typeof reportedMultiplier === 'string' && reportedMultiplier.trim()
    ? asNumber(Number(reportedMultiplier)) : asNumber(reportedMultiplier);
  const exercise = extra?.option_area_type === 'AMERICAN' ? 'american' : extra?.option_area_type === 'EUROPEAN' ? 'european' : null;
  const standard = row.option_standard_type === 'STANDARD';
  const exactYahoo = standard && yahoo?.shareOnly &&
    (shares === null || shares === yahoo.shares) && (reportedSize === null || reportedSize === yahoo.shares) ? yahoo : undefined;

  const delivery = shares ?? exactYahoo?.shares ?? null;
  const shareOnly = standard && delivery !== null && delivery > 0 && delivery === (reportedSize ?? exactYahoo?.shares);
  const sources = [listingSource, snapshot && snapshotSource,
    exactYahoo && (shares === null || reportedSize === null || multiplier === null || exercise === null) && exactYahoo.source].filter(Boolean);
  const emptyQuote: OptionQuote = { source: listingSource, collectedAt: new Date().toISOString(), bookAsOf: null, lastTradeAt: null,
    bid: null, ask: null, bidSize: null, askSize: null, volume: null, openInterest: null,
    ivPercent: null, delta: null, gamma: null, theta: null, vega: null, rho: null };
  const savedQuote = yahoo?.quote;
  const quote = providerQuote && savedQuote && providerQuote.bid === null && providerQuote.ask === null
    ? { ...providerQuote, source: savedQuote.source, collectedAt: savedQuote.collectedAt,
      lastTradeAt: savedQuote.lastTradeAt, bid: savedQuote.bid, ask: savedQuote.ask,
      bidSize: savedQuote.bidSize, askSize: savedQuote.askSize }
    : providerQuote ?? savedQuote ?? emptyQuote;

  return { id: row.code, underlying: symbol, right: row.option_type === 'PUT' ? 'put' : 'call',
    strike: row.strike_price, expiry: row.strike_time, currency: 'USD', shares: shareOnly ? delivery : null,
    premiumMultiplier: multiplier ?? exactYahoo?.premiumMultiplier ?? null, exercise: exercise ?? exactYahoo?.exercise ?? null,
    shareOnly, source: sources.join(' and '), quote };
}

export async function readChain(state: InvestorState, symbol: string, date: string, held: Holding[],
  stock: UnderlyingEvidence): Promise<ChainEvidence> {
  const notices: string[] = [];
  const events = stock.earnings && stock.earnings.date >= date ? [stock.earnings] : [];
  if (!events.length) notices.push('No confirmed upcoming earnings date was available.');
  notices.push('Issuer and OCC notices may contain additional corporate actions beyond the dividend and split feeds.');
  const heldDates = [...new Set(held.map(holding => holding.option!.expiry))];
  const yahooNotices: string[] = [];
  const yahooTask = readYahooChain(symbol, date, heldDates, yahooNotices);
  const cloud = cloudReader(state);
  if (!cloud) {
    const options = await yahooTask;
    notices.push(...yahooNotices, 'Connected broker option terms, Greeks, quote sizes and announced company-action feeds are unavailable.');
    return { options: [...options.values()], events, notices };
  }
  const owner = `US.${symbol}`, path = `/api/v1.0/quote/${owner}`;
  const actions = corporateEvents(cloud, path, date, notices);
  const contracts = await readCloudListings(cloud, owner, path, date, heldDates, notices);
  const [options, snapshots] = await Promise.all([yahooTask, readCloudSnapshots(cloud, contracts)]);
  notices.push(...yahooNotices);
  const missingSnapshots = new Set(contracts.filter(row => !snapshots.has(row.code)).map(row => row.strike_time));
  for (const expiry of missingSnapshots) notices.push(`Some ${cloud.broker} Cloud quotes are unavailable for ${expiry}.`);
  const yahooByCode = new Map([...options.values()].map(option => [cloudCodeKey(option.id), option]));
  const cloudSource = `${cloud.broker} Cloud ${snapshotPath}`;
  const listingSource = `${cloud.broker} Cloud ${path}/option-chain`;
  for (const row of contracts) {
    const code = cloudCodeKey(row.code);
    const yahoo = code ? yahooByCode.get(code) : undefined;
    if (yahoo) options.delete(yahoo.id);
    options.set(row.code, cloudOption(symbol, row, snapshots.get(row.code), yahoo, listingSource, cloudSource));
  }
  const listed = [...options.values()];
  const cloudCodes = new Set(contracts.map(row => row.code));
  const heldContracts = new Set(held.flatMap(holding => {
    const match = matchListed(holding, listed);
    return match && cloudCodes.has(match.id) ? [match] : [];
  }));
  await Promise.all([...heldContracts].map(async option => {
    const book = await readHeldBook(cloud, option.id).catch(() => null);
    if (book) option.quote = { ...option.quote, ...book, lastTradeAt: null };
    else notices.push(`${cloud.broker} Cloud order book unavailable for ${option.id}.`);
  }));
  events.push(...await actions);
  return { options: listed, events, notices: [...new Set(notices)] };
}
