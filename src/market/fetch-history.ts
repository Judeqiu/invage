import { yf } from './yf-client.js';
import { cacheFingerprint, readDashboardCache, writeDashboardCache } from '../webapp/dashboard-cache.js';

const pending = new Map<string, Promise<Record<string, number>>>();

function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return toDay(new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000));
}

/**
 * Adjusted-close prices for a ticker on specific dates (YYYY-MM-DD).
 *
 * One chart() call spanning min→max requested date; each requested date maps to
 * the adjclose of the nearest trading day on or before it (weekends/holidays).
 * Dates with no prior trading day (before first quote) are omitted.
 */
export async function fetchHistoricalCloses(
  ticker: string,
  dates: string[],
  options: { refresh?: boolean; cache?: boolean } = {},
): Promise<Record<string, number>> {
  const unique = [...new Set(dates)].sort();
  if (unique.length === 0) return {};
  if (!options.cache) return queryHistoricalCloses(ticker, unique);
  const scope = JSON.stringify([ticker, unique]);
  const fingerprint = cacheFingerprint(scope);
  if (!options.refresh) {
    // Adjusted prices can change after corporate actions; revalidate within six hours.
    const cached = readDashboardCache<Record<string, number>>('historical-prices', scope, fingerprint, 6 * 60 * 60 * 1000);
    if (cached) return cached;
  }
  const key = JSON.stringify([process.env.UTARUS_DATA_ROOT, scope]);
  const existing = pending.get(key);
  if (existing) return { ...await existing };
  const task = queryHistoricalCloses(ticker, unique).then(value => {
    // Do not turn an empty provider response into a long-lived cached absence.
    if (Object.keys(value).length) writeDashboardCache('historical-prices', scope, fingerprint, value);
    return value;
  });
  pending.set(key, task);
  try { return { ...await task }; }
  finally { pending.delete(key); }
}

async function queryHistoricalCloses(ticker: string, unique: string[]): Promise<Record<string, number>> {

  const result = await yf.chart(ticker, {
    // Pad the window start so weekend/holiday dates resolve to the prior trading day.
    period1: addDays(unique[0], -7),
    period2: addDays(unique[unique.length - 1], 2),
    interval: '1d',
  });

  const quotes = (result.quotes ?? [])
    .filter((q) => q.date != null && q.adjclose != null)
    .map((q) => ({ day: toDay(q.date), adjclose: q.adjclose as number }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const closes: Record<string, number> = {};
  let i = 0;
  for (const day of unique) {
    while (i < quotes.length && quotes[i].day <= day) i++;
    if (i > 0) closes[day] = Number(quotes[i - 1].adjclose.toFixed(4));
  }
  return closes;
}
