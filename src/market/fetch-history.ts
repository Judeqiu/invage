import { yf } from './yf-client.js';

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
): Promise<Record<string, number>> {
  const unique = [...new Set(dates)].sort();
  if (unique.length === 0) return {};

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
