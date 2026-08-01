/**
 * URA Data Service API client (eservice.ura.gov.sg).
 *
 * Flow: AccessKey → insertNewToken/v1 → Token → invokeUraDS/v1?service=…
 * Fail-fast if URA_ACCESS_KEY missing or URA returns Status=Error.
 */

const DEFAULT_BASE = 'https://eservice.ura.gov.sg';

export type UraStatusResponse<T> = {
  Status?: string;
  Message?: string;
  Result?: T;
};

export function getUraBaseUrl(): string {
  const base = process.env.URA_BASE_URL?.trim() || DEFAULT_BASE;
  return base.replace(/\/$/, '');
}

export function getUraAccessKey(): string {
  const key = process.env.URA_ACCESS_KEY?.trim();
  if (!key) {
    throw new Error(
      'URA_ACCESS_KEY is not set. Register at https://eservice.ura.gov.sg/maps/api/reg.html ' +
        'and set the Access Key in env. Do not invent URA data.',
    );
  }
  return key;
}

function assertOkStatus(data: UraStatusResponse<unknown>, context: string): void {
  const status = (data.Status || '').trim();
  if (status.toLowerCase() === 'success') return;
  const msg = data.Message?.trim() || JSON.stringify(data);
  throw new Error(`URA ${context} failed (Status=${status || 'unknown'}): ${msg}`);
}

/**
 * Issue a short-lived Token for subsequent invokeUraDS calls.
 */
export async function fetchUraToken(accessKey: string = getUraAccessKey()): Promise<string> {
  const url = `${getUraBaseUrl()}/uraDataService/insertNewToken/v1`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      AccessKey: accessKey,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`URA insertNewToken HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as UraStatusResponse<string>;
  assertOkStatus(data, 'insertNewToken');
  const token = typeof data.Result === 'string' ? data.Result.trim() : '';
  if (!token) {
    throw new Error('URA insertNewToken returned empty Result token.');
  }
  return token;
}

/**
 * Invoke a named URA dataset service.
 */
export async function invokeUraService<T>(
  service: string,
  query: Record<string, string | number | undefined> = {},
  opts?: { accessKey?: string; token?: string },
): Promise<T> {
  const accessKey = opts?.accessKey ?? getUraAccessKey();
  const token = opts?.token ?? (await fetchUraToken(accessKey));
  const url = new URL(`${getUraBaseUrl()}/uraDataService/invokeUraDS/v1`);
  url.searchParams.set('service', service);
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === '') continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      AccessKey: accessKey,
      Token: token,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`URA invokeUraDS service=${service} HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  // Some PMI batches are large / latin1-tainted; decode robustly.
  const buf = Buffer.from(await res.arrayBuffer());
  let text = buf.toString('utf8');
  let data: UraStatusResponse<T>;
  try {
    data = JSON.parse(text) as UraStatusResponse<T>;
  } catch {
    text = buf.toString('latin1');
    data = JSON.parse(text) as UraStatusResponse<T>;
  }
  assertOkStatus(data, `service=${service}`);
  if (data.Result === undefined || data.Result === null) {
    throw new Error(`URA service=${service} returned empty Result.`);
  }
  return data.Result;
}

// ── Car park types ─────────────────────────────────────────────────────

export interface UraCarParkAvailability {
  carparkNo: string;
  lotsAvailable: string | number;
  lotType: string;
  geometries?: Array<{ coordinates?: string }>;
}

export interface UraCarParkDetail {
  ppCode: string;
  ppName: string;
  vehCat?: string;
  parkingSystem?: string;
  parkCapacity?: number | string;
  weekdayRate?: string;
  weekdayMin?: string;
  satdayRate?: string;
  satdayMin?: string;
  sunPHRate?: string;
  sunPHMin?: string;
  startTime?: string;
  endTime?: string;
  geometries?: Array<{ coordinates?: string }>;
}

// ── Private residential types ──────────────────────────────────────────

export interface UraPrivateTx {
  area?: string;
  floorRange?: string;
  noOfUnits?: string;
  contractDate?: string; // MMYY e.g. "0724"
  typeOfSale?: string;
  price?: string;
  propertyType?: string;
  district?: string;
  typeOfArea?: string;
  tenure?: string;
}

export interface UraPrivateProject {
  street?: string;
  project?: string;
  marketSegment?: string;
  transaction?: UraPrivateTx[];
}

export interface FlatPrivateSale {
  project: string;
  street: string;
  marketSegment: string;
  area: number | null;
  floorRange: string;
  noOfUnits: number | null;
  contractDateRaw: string;
  /** Approximate YYYY-MM for filtering (day unknown). */
  contractMonth: string | null;
  typeOfSale: string;
  price: number | null;
  propertyType: string;
  district: string;
  typeOfArea: string;
  tenure: string;
}

/** Parse URA contractDate "MMYY" → "YYYY-MM" (assume 20YY for YY>=00). */
export function parseUraContractMonth(raw: string | undefined): string | null {
  if (raw == null || !/^\d{4}$/.test(raw.trim())) return null;
  const mm = raw.trim().slice(0, 2);
  const yy = raw.trim().slice(2, 4);
  const month = Number(mm);
  if (month < 1 || month > 12) return null;
  const year = 2000 + Number(yy);
  return `${year}-${mm}`;
}

export function flattenPrivateProjects(projects: UraPrivateProject[]): FlatPrivateSale[] {
  const out: FlatPrivateSale[] = [];
  for (const p of projects) {
    const project = (p.project || '').trim();
    const street = (p.street || '').trim();
    const marketSegment = (p.marketSegment || '').trim();
    const txs = Array.isArray(p.transaction) ? p.transaction : [];
    for (const t of txs) {
      const priceN =
        t.price != null && String(t.price).trim() !== ''
          ? Number(String(t.price).replace(/,/g, ''))
          : NaN;
      const areaN =
        t.area != null && String(t.area).trim() !== ''
          ? Number(String(t.area).replace(/,/g, ''))
          : NaN;
      const unitsN =
        t.noOfUnits != null && String(t.noOfUnits).trim() !== ''
          ? Number(String(t.noOfUnits).replace(/,/g, ''))
          : NaN;
      out.push({
        project,
        street,
        marketSegment,
        area: Number.isFinite(areaN) ? areaN : null,
        floorRange: (t.floorRange || '').trim(),
        noOfUnits: Number.isFinite(unitsN) ? unitsN : null,
        contractDateRaw: (t.contractDate || '').trim(),
        contractMonth: parseUraContractMonth(t.contractDate),
        typeOfSale: (t.typeOfSale || '').trim(),
        price: Number.isFinite(priceN) ? priceN : null,
        propertyType: (t.propertyType || '').trim(),
        district: (t.district || '').trim(),
        typeOfArea: (t.typeOfArea || '').trim(),
        tenure: (t.tenure || '').trim(),
      });
    }
  }
  return out;
}

/**
 * Pull PMI_Resi_Transaction batches until empty or maxBatches.
 * URA historically returns ~4 batches of project groups.
 */
export async function fetchPrivateResidentialBatches(opts?: {
  maxBatches?: number;
  token?: string;
  accessKey?: string;
}): Promise<UraPrivateProject[]> {
  const maxBatches = opts?.maxBatches ?? 8;
  const accessKey = opts?.accessKey ?? getUraAccessKey();
  const token = opts?.token ?? (await fetchUraToken(accessKey));
  const all: UraPrivateProject[] = [];

  for (let batch = 1; batch <= maxBatches; batch++) {
    const result = await invokeUraService<UraPrivateProject[]>(
      'PMI_Resi_Transaction',
      { batch },
      { accessKey, token },
    );
    if (!Array.isArray(result) || result.length === 0) break;
    all.push(...result);
  }
  return all;
}

export async function fetchCarParkAvailability(opts?: {
  token?: string;
  accessKey?: string;
}): Promise<UraCarParkAvailability[]> {
  const result = await invokeUraService<UraCarParkAvailability[]>(
    'Car_Park_Availability',
    {},
    opts,
  );
  if (!Array.isArray(result)) {
    throw new Error('URA Car_Park_Availability Result is not an array.');
  }
  return result;
}

export async function fetchCarParkDetails(opts?: {
  token?: string;
  accessKey?: string;
}): Promise<UraCarParkDetail[]> {
  const result = await invokeUraService<UraCarParkDetail[]>('Car_Park_Details', {}, opts);
  if (!Array.isArray(result)) {
    throw new Error('URA Car_Park_Details Result is not an array.');
  }
  return result;
}
