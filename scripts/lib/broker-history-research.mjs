/** Read-only history collection. No portfolio writes, inferred fills, or completion markers. */
export async function collectPages(request, { rows, cursor, onPage = async () => {}, pause = async () => {}, maxPages = 1000 }) {
  const result = []; const seen = new Set(); let token;
  for (let page = 0; page < maxPages; page++) {
    if (page) await pause();
    const response = await request(token);
    const items = rows(response);
    if (!Array.isArray(items) || items.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('History page has invalid rows');
    await onPage(items, page); result.push(...items);
    const next = cursor(response);
    if (next == null || next === '') return result;
    if (typeof next !== 'string' || seen.has(next)) throw new Error('History pagination did not advance');
    seen.add(next); token = next;
  }
  throw new Error('History page safety limit exceeded; coverage is incomplete');
}
export function assertAccountRows(rows, account, fields, required = false) {
  if (!Array.isArray(rows)) throw new Error('Historical response requires an array');
  for (const row of rows) {
    const found = fields.filter(field => row[field] != null).map(field => String(row[field]));
    if ((required && !found.length) || found.some(value => value !== account)) throw new Error('Historical row account differs from the bound account');
  }
  return rows;
}
export function flexYearWindows(now = new Date(), availableThrough) {
  if (availableThrough !== undefined && (!/^\d{8}$/.test(availableThrough) || new Date(`${availableThrough.slice(0,4)}-${availableThrough.slice(4,6)}-${availableThrough.slice(6,8)}T00:00:00Z`).toISOString().slice(0,10).replaceAll('-','') !== availableThrough)) throw new Error('Invalid available-through date');
  const year = now.getUTCFullYear(); const end = now.toISOString().slice(0, 10).replaceAll('-', '');
  return Array.from({length: 5}, (_, i) => ({ from: `${year - 4 + i}0101`, through: i === 4 ? end : `${year - 4 + i}1231` })).map(w=>({...w,through:availableThrough&&availableThrough<w.through?availableThrough:w.through})).filter(w=>w.through>=w.from);
}
export function summarizeFlex(xml, account, parseAttrs) {
  if (!xml.includes('<FlexQueryResponse')) throw new Error('Historical Flex query must return XML; CSV cannot prove account/date scope');
  const statements = [...xml.matchAll(/<FlexStatement\b([^>]*)>([\s\S]*?)<\/FlexStatement>/g)];
  const matching = statements.filter(m => parseAttrs(m[1]).accountId === account);
  if (!matching.length) throw new Error('Historical Flex response contains no statement for the bound account');
  const trades = []; const periods = []; const sections = new Set();
  for (const m of matching) {
    const header = parseAttrs(m[1]); periods.push({from:header.fromDate, through:header.toDate});
    for (const section of ['Trades','TradeConfirms','CashTransactions','CorporateActions','OptionEAE']) if (new RegExp(`<${section}\\b`).test(m[2])) sections.add(section);
    for (const row of m[2].matchAll(/<(Trade|TradeConfirm)\b([^>]*?)(?:\/?>)/g)) {
      const attrs = parseAttrs(row[2]);
      assertAccountRows([attrs], account, ['accountId']);
      // Aggregated reports cannot be counted as distinct executions.
      if (attrs.levelOfDetail !== 'EXECUTION' || !attrs.tradeID && !attrs.transactionID && !attrs.execID) continue;
      trades.push(attrs);
    }
  }
  const ids = new Set(trades.map(row => `${row.transactionID ?? row.tradeID ?? row.execID}:${row.assetCategory}:${row.conid ?? row.symbol}`));
  return { periods, sections:[...sections], executionRows:ids.size, rawExecutionRows:trades.length,
    securities:trades.filter(t=>t.assetCategory !== 'OPT').length, options:trades.filter(t=>t.assetCategory === 'OPT').length,
    foreignStatements:statements.length-matching.length };
}
