/** Design 6 · Compact — pricing matrix, onboarding booking slots and demo checkout helpers. */

export const PACKAGE_IDS = ["novice", "experienced", "renewal"] as const;
export type PackageId = (typeof PACKAGE_IDS)[number];

export function isPackageId(value: unknown): value is PackageId {
  return typeof value === "string" && (PACKAGE_IDS as readonly string[]).includes(value);
}

export type ServiceItem = { id: string; name: string; minutes?: number; prices: Partial<Record<PackageId, number>> };

export const serviceItems: ServiceItem[] = [
  { id: "overview", name: "Overview of Option Trading Business", minutes: 60, prices: { novice: 180 } },
  { id: "basics", name: "Options Basics & Broker Setup", minutes: 60, prices: { novice: 180 } },
  { id: "wheel", name: "Options Wheel Strategy", minutes: 120, prices: { novice: 360, experienced: 360 } },
  { id: "dashboard", name: "Velovest Dashboard Access", prices: { novice: 228, experienced: 228, renewal: 228 } },
  { id: "onboarding", name: "Onboarding & Strategy Appreciation", minutes: 60, prices: { novice: 132, experienced: 132 } },
];

export type PackageInfo = { id: PackageId; name: string; tier: string; summary: string; billing: string; featured?: boolean };

export const packages: Record<PackageId, PackageInfo> = {
  novice: { id: "novice", name: "New to Options", tier: "Novice Tier", billing: "one-time", featured: true, summary: "Start from the foundations: the options business, broker setup, the Wheel strategy and guided onboarding." },
  experienced: { id: "experienced", name: "Advanced Beginner", tier: "Experienced Tier", billing: "one-time", summary: "Already know the basics? Go straight to the Wheel strategy, Dashboard access and guided onboarding." },
  renewal: { id: "renewal", name: "Yearly Renewal", tier: "Ongoing Access", billing: "per year", summary: "Continue your Velovest Dashboard access for another year." },
};

export function packageItems(id: PackageId) {
  return serviceItems.flatMap(item => {
    const price = item.prices[id];
    return price === undefined ? [] : [{ ...item, price }];
  });
}

export function packageTotal(id: PackageId) {
  return packageItems(id).reduce((sum, item) => sum + item.price, 0);
}

export function packageMinutes(id: PackageId) {
  return packageItems(id).reduce((sum, item) => sum + (item.minutes ?? 0), 0);
}

export function formatSGD(amount: number, cents = false) {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
}

/* ---------- Onboarding booking (Singapore time, UTC+8) ---------- */

export const SESSION_MINUTES = 60;
export const VERIFICATION_NOTE = "Normally within 3 working hours.";
export const SLOT_TIMES = ["10:00", "11:00", "14:00", "15:00", "16:00", "17:00"] as const;
export type SlotTime = (typeof SLOT_TIMES)[number];
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isSlotTime(value: unknown): value is SlotTime {
  return typeof value === "string" && (SLOT_TIMES as readonly string[]).includes(value);
}

/** Next `count` weekdays (Mon–Fri) after today in Singapore, as YYYY-MM-DD. */
export function bookableDates(now: Date, count = 10): string[] {
  const sg = new Date(now.getTime() + SGT_OFFSET_MS);
  let day = Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth(), sg.getUTCDate());
  const dates: string[] = [];
  while (dates.length < count) {
    day += DAY_MS;
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
}

/** Deterministic "already booked" slots so the demo calendar looks realistic. */
export function isSlotTaken(date: string, time: SlotTime) {
  let hash = 0;
  for (const char of `${date}${time}`) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash % 4 === 0;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function dateParts(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = WEEKDAYS[d.getUTCDay()] ?? "";
  const month = MONTHS[d.getUTCMonth()] ?? "";
  return { weekday, weekdayShort: weekday.slice(0, 3), day: d.getUTCDate(), month, monthShort: month.slice(0, 3), year: d.getUTCFullYear() };
}

export function formatSessionDate(date: string) {
  const p = dateParts(date);
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

function clock(hour: number, minute: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function formatSlot(time: SlotTime, withEnd = true) {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const start = clock(h, m);
  if (!withEnd) return start;
  const endMinutes = h * 60 + m + SESSION_MINUTES;
  return `${start} – ${clock(Math.floor(endMinutes / 60), endMinutes % 60)} SGT`;
}

/** Calendar invite for the booked onboarding session. */
export function buildIcs({ date, time, reference, packageName }: { date: string; time: SlotTime; reference: string; packageName: string }) {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const start = new Date(Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60000 - SGT_OFFSET_MS);
  const end = new Date(start.getTime() + SESSION_MINUTES * 60000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Velovest//Onboarding//EN", "BEGIN:VEVENT",
    `UID:${reference}@velovest.ai`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:Velovest onboarding session (${packageName})`,
    `DESCRIPTION:Booking reference ${reference}. Access to the Velovest system will be given during this session.`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

export function createReference(random: () => number = Math.random) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return `VV-${Array.from({ length: 6 }, () => chars[Math.floor(random() * chars.length)]).join("")}`;
}
