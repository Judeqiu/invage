export class FlexProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`IBKR Flex [${code}] ${message}`);
    this.name = 'FlexProtocolError';
  }
}

/** Row-level conflict that must abort the whole Flex parse (not skip the lot). */
export class FlexFatalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlexFatalParseError';
  }
}

export interface FlexOpenPosition {
  accountId: string;
  currency: string;
  assetCategory: string;
  symbol: string;
  listingExchange?: string;
  quantity: number;
  multiplier?: number;
  costBasisPrice?: number;
  costBasisMoney?: number;
  markPrice?: number;
  positionValue?: number;
  strike?: number;
  expiry?: string;
  putCall?: string;
  underlyingSymbol?: string;
  conid?: string;
  raw: Record<string, string>;
}

export interface FlexCashRow {
  currency: string;
  endingCash: number;
}

export interface FlexSkip {
  kind: 'position' | 'cash';
  reason: string;
  symbol?: string;
  assetCategory?: string;
  currency?: string;
}

export function formatFlexSkip(skip: FlexSkip): string {
  const who = skip.symbol ?? skip.currency;
  return who ? `${who}: ${skip.reason}` : skip.reason;
}

export interface FlexStatementDoc {
  accountId: string;
  fromDate: string;
  toDate: string;
  whenGenerated?: string;
  period?: string;
  openPositions: FlexOpenPosition[];
  cash: FlexCashRow[];
  skipped: FlexSkip[];
}

export function parseXmlAttrs(attrChunk: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrChunk)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

export function xmlElementText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return undefined;
  const t = m[1].trim();
  return t.length === 0 ? undefined : t;
}

export function xmlSelfClosingTags(xml: string, tag: string): Record<string, string>[] {
  const re = new RegExp(`<${tag}\\b([^>]*)/?>`, 'gi');
  const rows: Record<string, string>[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    rows.push(parseXmlAttrs(m[1] ?? ''));
  }
  return rows;
}

/** Inner XML of `<Tag>...</Tag>`, or `""` for self-closing. `null` if the wrapper is absent. */
export function extractSectionInner(xml: string, tag: string): string | null {
  const self = xml.match(new RegExp(`<${tag}\\b[^>]*/>`, 'i'));
  if (self) return '';
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return null;
  return m[1];
}

function requireAttr(row: Record<string, string>, key: string, ctx: string): string {
  const s = row[key]?.trim();
  if (!s) throw new Error(`IBKR Flex ${ctx}: missing ${key}`);
  return s;
}

function attrNumber(row: Record<string, string>, key: string): number | undefined {
  const s = row[key]?.trim();
  if (s == null || s.length === 0) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`IBKR Flex: ${key} is not a number (${s})`);
  return n;
}

function ymdFromIbkr(raw: string, field: string): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`IBKR Flex ${field}: expected YYYYMMDD, got "${raw}"`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function throwIfErrorEnvelope(xml: string): void {
  const status = xmlElementText(xml, 'Status');
  const code = xmlElementText(xml, 'ErrorCode');
  if (status === 'Fail' || status === 'Error' || (status === 'Warn' && code)) {
    const msg = xmlElementText(xml, 'ErrorMessage') ?? 'unknown error';
    throw new FlexProtocolError(code ?? '?', msg);
  }
}

export function looksLikeCsv(text: string): boolean {
  const head = text.trimStart().slice(0, 80);
  return (
    head.startsWith('"ClientAccountID"') ||
    head.startsWith('ClientAccountID,') ||
    (head.includes('ClientAccountID') && !head.includes('<'))
  );
}

function parseOpenPosition(row: Record<string, string>): FlexOpenPosition {
  const fromQuantity = attrNumber(row, 'quantity');
  const fromPosition = attrNumber(row, 'position');
  if (fromQuantity != null && fromPosition != null && fromQuantity !== fromPosition) {
    throw new FlexFatalParseError(
      `IBKR Flex OpenPosition ${row.symbol ?? '?'}: quantity and position disagree (${fromQuantity} vs ${fromPosition})`,
    );
  }
  const quantity = fromQuantity ?? fromPosition;
  if (quantity == null) throw new Error('IBKR Flex OpenPosition: missing quantity (or position)');
  const pos: FlexOpenPosition = {
    accountId: requireAttr(row, 'accountId', 'OpenPosition'),
    currency: requireAttr(row, 'currency', 'OpenPosition').toUpperCase(),
    assetCategory: requireAttr(row, 'assetCategory', 'OpenPosition').toUpperCase(),
    symbol: requireAttr(row, 'symbol', 'OpenPosition'),
    quantity,
    raw: { ...row },
  };
  if (row.listingExchange) pos.listingExchange = row.listingExchange;
  const multiplier = attrNumber(row, 'multiplier');
  if (multiplier != null) pos.multiplier = multiplier;
  const costBasisPrice = attrNumber(row, 'costBasisPrice');
  if (costBasisPrice != null) pos.costBasisPrice = costBasisPrice;
  const costBasisMoney = attrNumber(row, 'costBasisMoney');
  if (costBasisMoney != null) pos.costBasisMoney = costBasisMoney;
  const markPrice = attrNumber(row, 'markPrice');
  if (markPrice != null) pos.markPrice = markPrice;
  const positionValue = attrNumber(row, 'positionValue');
  if (positionValue != null) pos.positionValue = positionValue;
  const strike = attrNumber(row, 'strike');
  if (strike != null) pos.strike = strike;
  const expiry = row.expiry?.trim() || row.expiryDate?.trim();
  if (expiry) pos.expiry = expiry;
  if (row.putCall) pos.putCall = row.putCall;
  if (row.underlyingSymbol) pos.underlyingSymbol = row.underlyingSymbol;
  if (row.conid) pos.conid = row.conid;
  return pos;
}

function reportDateMatches(reportDate: string, toDate: string): boolean {
  const ymd = ymdFromIbkr(reportDate, 'EquitySummaryInBase reportDate');
  return ymd === toDate;
}

/**
 * IBKR Cash Report always includes a BASE_SUMMARY row in the account base
 * currency. Per-currency rows are optional in the Flex Query. When they are
 * absent, Equity Summary In Base carries the ISO code (`currency`) and a
 * `cash` figure that must equal CashReport endingCash.
 */
function resolveBaseSummaryCash(
  xml: string,
  toDate: string,
  baseSummary: FlexCashRow,
): FlexCashRow {
  const inner = extractSectionInner(xml, 'EquitySummaryInBase');
  if (inner == null) {
    throw new Error(
      'IBKR Flex CashReport is BASE_SUMMARY only (no per-currency rows). Include Currency-level Cash Report in the Flex Query, or include Equity Summary In Base with currency so base cash can be booked.',
    );
  }
  const matches: Array<{ currency: string; cash: number; reportDate: string }> = [];
  for (const row of xmlSelfClosingTags(inner, 'EquitySummaryByReportDateInBase')) {
    const reportDate = row.reportDate?.trim();
    if (!reportDate || !reportDateMatches(reportDate, toDate)) continue;
    const currency = row.currency?.trim().toUpperCase();
    const cash = attrNumber(row, 'cash');
    if (!currency || cash == null) {
      throw new Error(
        `IBKR Flex EquitySummaryInBase reportDate ${reportDate}: missing currency or cash.`,
      );
    }
    if (!/^[A-Z]{3,4}$/.test(currency) || currency === 'BASE_SUMMARY') {
      throw new Error(
        `IBKR Flex EquitySummaryInBase reportDate ${reportDate}: currency must be an ISO code, got "${currency}".`,
      );
    }
    matches.push({ currency, cash, reportDate });
  }
  if (matches.length === 0) {
    throw new Error(
      `IBKR Flex CashReport is BASE_SUMMARY only; EquitySummaryInBase has no row for toDate ${toDate}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `IBKR Flex EquitySummaryInBase has ${matches.length} rows for toDate ${toDate}.`,
    );
  }
  const eq = matches[0];
  if (eq.cash !== baseSummary.endingCash) {
    throw new Error(
      `IBKR Flex BASE_SUMMARY endingCash ${baseSummary.endingCash} disagrees with EquitySummaryInBase cash ${eq.cash} (${eq.currency} on ${eq.reportDate}).`,
    );
  }
  return { currency: eq.currency, endingCash: baseSummary.endingCash };
}

function parseCashRow(row: Record<string, string>): FlexCashRow {
  const currency = requireAttr(row, 'currency', 'CashReport').toUpperCase();
  const ending =
    attrNumber(row, 'endingCash') ??
    attrNumber(row, 'endingSettledCash') ??
    attrNumber(row, 'endingAvailable');
  if (ending == null) {
    throw new Error(
      `IBKR Flex CashReport ${currency}: missing endingCash / endingSettledCash / endingAvailable`,
    );
  }
  return { currency, endingCash: ending };
}

export function parseFlexQueryXml(xml: string | Buffer): FlexStatementDoc {
  const text = Buffer.isBuffer(xml) ? xml.toString('utf8') : xml;
  throwIfErrorEnvelope(text);
  if (looksLikeCsv(text)) {
    throw new Error(
      'IBKR Flex: this query returned CSV. In Client Portal → Performance & Reports → Flex Queries, edit the Activity query and set Format to XML (keep Open Positions and Cash Report). Then Sync now.',
    );
  }
  if (!text.includes('<FlexQueryResponse') && !text.includes('<FlexStatement ')) {
    throw new Error('IBKR Flex: expected FlexQueryResponse XML.');
  }
  const stOpen = text.match(/<FlexStatement\b([^>]*)>/);
  if (!stOpen) throw new Error('IBKR Flex: FlexStatements has no FlexStatement.');
  const stAttrs = parseXmlAttrs(stOpen[1] ?? '');
  const extra = [...text.matchAll(/<FlexStatement\b/g)];
  if (extra.length > 1) {
    throw new Error(
      `IBKR Flex: expected one FlexStatement, got ${extra.length}. Split accounts into separate queries.`,
    );
  }
  const accountId = requireAttr(stAttrs, 'accountId', 'FlexStatement');
  const fromDate = ymdFromIbkr(requireAttr(stAttrs, 'fromDate', 'FlexStatement'), 'fromDate');
  const toDate = ymdFromIbkr(requireAttr(stAttrs, 'toDate', 'FlexStatement'), 'toDate');
  const openInner = extractSectionInner(text, 'OpenPositions');
  if (openInner == null) {
    throw new Error('IBKR Flex: missing OpenPositions section.');
  }
  const cashInner = extractSectionInner(text, 'CashReport');
  if (cashInner == null) {
    throw new Error('IBKR Flex: missing CashReport section.');
  }
  const skipped: FlexSkip[] = [];
  const openPositions: FlexOpenPosition[] = [];
  for (const row of xmlSelfClosingTags(openInner, 'OpenPosition')) {
    try {
      openPositions.push(parseOpenPosition(row));
    } catch (e) {
      if (e instanceof FlexFatalParseError) throw e;
      const reason = e instanceof Error ? e.message : String(e);
      const skip: FlexSkip = {
        kind: 'position',
        reason,
      };
      if (row.symbol) skip.symbol = row.symbol;
      if (row.assetCategory) skip.assetCategory = row.assetCategory;
      skipped.push(skip);
    }
  }
  const cash: FlexCashRow[] = [];
  const seenCcy = new Set<string>();
  let baseSummary: FlexCashRow | undefined;
  for (const row of xmlSelfClosingTags(cashInner, 'CashReportCurrency')) {
    try {
      const parsed = parseCashRow(row);
      if (parsed.currency === 'BASE_SUMMARY') {
        if (baseSummary) {
          throw new FlexFatalParseError('IBKR Flex CashReport has more than one BASE_SUMMARY row.');
        }
        baseSummary = parsed;
        continue;
      }
      if (!/^[A-Z]{3,4}$/.test(parsed.currency)) {
        skipped.push({
          kind: 'cash',
          currency: parsed.currency,
          reason: 'not a 3–4 letter currency code',
        });
        continue;
      }
      if (parsed.endingCash < 0) {
        skipped.push({
          kind: 'cash',
          currency: parsed.currency,
          reason: 'endingCash < 0 is not stored',
        });
        continue;
      }
      if (seenCcy.has(parsed.currency)) {
        skipped.push({
          kind: 'cash',
          currency: parsed.currency,
          reason: 'duplicate currency row',
        });
        continue;
      }
      seenCcy.add(parsed.currency);
      cash.push(parsed);
    } catch (e) {
      if (e instanceof FlexFatalParseError) throw e;
      const skip: FlexSkip = {
        kind: 'cash',
        reason: e instanceof Error ? e.message : String(e),
      };
      if (row.currency) skip.currency = row.currency;
      skipped.push(skip);
    }
  }
  if (cash.length === 0) {
    if (!baseSummary) {
      throw new Error('IBKR Flex CashReport has no currency rows.');
    }
    const resolved = resolveBaseSummaryCash(text, toDate, baseSummary);
    cash.push(resolved);
  }
  const doc: FlexStatementDoc = {
    accountId,
    fromDate,
    toDate,
    openPositions,
    cash,
    skipped,
  };
  if (stAttrs.whenGenerated) doc.whenGenerated = stAttrs.whenGenerated;
  if (stAttrs.period) doc.period = stAttrs.period;
  return doc;
}
