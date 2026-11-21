import { validDate } from '../brokers/option-executions.js';

const DAY_MS = 86_400_000;
const EXPIRY_WINDOW_DAYS = 28;
const SCAN_HOUR_SINGAPORE = 20;
const toClock = (timezone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const singaporeClock = toClock('Asia/Singapore');
const usClock = toClock('America/New_York');
export const calendarReference = 'https://www.cboe.com/us/options/holidays/csv/';

function clock(value: Date, format: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(format.formatToParts(value).map(part => [part.type, part.value]));
  return { date: [parts.year, parts.month, parts.day].join('-'), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const usSessionDate = (value: Date) => clock(value, usClock).date;
export const expiryWindowEnd = (date: string) => new Date(Date.parse(date) + EXPIRY_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);

/** Starts at the Singapore wall clock time. Catch up while the U.S. session is still premarket. */
export function dueSession(now: Date) {
  const singapore = clock(now, singaporeClock), us = clock(now, usClock);
  if (singapore.date !== us.date || singapore.minutes < SCAN_HOUR_SINGAPORE * 60 || us.minutes >= 9 * 60 + 30) return null;
  const weekday = new Date(us.date).getUTCDay();
  return weekday === 0 || weekday === 6 ? null : { date: us.date, windowEnd: expiryWindowEnd(us.date) };
}

export function calendarFromCsv(csv: string) {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.indexOf('Holiday Name,Date,Regular Trading Hours,Global Trading Hours');
  if (header < 0) throw new Error('Cboe trading calendar schema changed');
  const years = new Set<string>(), closed = new Set<string>();
  for (const line of lines.slice(header + 1)) {
    // Identify typed date/session columns. Holiday names are display text only.
    const [, date, session] = line.match(/^(?:"(?:[^"]|"")*"|[^,]*),(\d{4}-\d{2}-\d{2}),([^,]+),/) ?? [];
    if (!date || !validDate(date) || (session !== 'None' && !/^\d{2}:\d{2}:\d{2} - \d{2}:\d{2}:\d{2}$/.test(session))) {
      throw new Error('Invalid Cboe calendar record');
    }
    years.add(date.slice(0, 4));
    if (session === 'None') closed.add(date);
  }
  return { years, closed };
}

export async function readTradingDay(date: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const response = await fetchImpl(calendarReference);
  if (!response.ok) throw new Error('Cboe trading calendar unavailable');
  const { years, closed } = calendarFromCsv(await response.text());
  if (!years.has(date.slice(0, 4))) throw new Error('Cboe calendar has no dates for the session year');
  return !closed.has(date);
}
