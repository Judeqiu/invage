/**
 * Household treasury extensions on InvestorState (family books).
 *
 * Optional top-level YAML blocks:
 *   treasury, properties, liabilities, cash_flows,
 *   projection_assumptions, scenarios
 *
 * Missing blocks mean empty/unknown — never invent zeros for decisions.
 */

import { assertPaymentMatchesAnnuity } from '../treasury/amortize.js';
import type { InvestorState } from './portfolio-state.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3,4}$/;
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export type LiabilityKind = 'mortgage' | 'loan';
export type CashFlowKind = 'income' | 'expense';
export type CashFlowFrequency = 'monthly' | 'annual';
export type PaymentFrequency = 'monthly';

export interface TreasurySettings {
  reporting_currency: string;
  updated_at: string;
}

/**
 * Cash applied toward purchase of a property (OTP, booking, S&P, PPS milestone).
 * Amount is always in the parent property's currency.
 * Omit the whole payments array when purchase payments are unknown — never invent 0.
 */
export interface PropertyPayment {
  date: string;
  amount: number;
  label?: string;
}

export interface PropertyAsset {
  id: string;
  value: number;
  currency: string;
  updated_at: string;
  label?: string;
  mortgage_id?: string;
  /**
   * Purchase-payment ledger (OTP / booking / S&P / progressive milestones).
   * Source of truth for “how much have I paid toward this unit.”
   * Omit when unknown. Empty array means known-zero payments recorded.
   * Does not change property mark (value); cash reduction is a separate journal entry.
   */
  payments?: PropertyPayment[];
}

export interface Liability {
  id: string;
  kind: LiabilityKind;
  principal: number;
  annual_rate_pct: number;
  currency: string;
  start_date: string;
  term_months: number;
  payment_amount: number;
  payment_frequency: PaymentFrequency;
  updated_at: string;
  property_id?: string;
  label?: string;
}

export interface CashFlowLine {
  id: string;
  kind: CashFlowKind;
  amount: number;
  currency: string;
  frequency: CashFlowFrequency;
  start_date: string;
  updated_at: string;
  end_date?: string;
  label?: string;
  category?: string;
}

export interface ProjectionAssumptions {
  portfolio_return_annual_pct: number;
  inflation_annual_pct: number;
  updated_at: string;
  /** Optional; when omitted in stored form, projection treats as 0 after explicit set of required fields. */
  property_appreciation_annual_pct?: number;
  /** Units of reporting currency per 1 unit of foreign currency. */
  fx?: Record<string, number>;
  /** Optional min free-cash buffer for TIGHT vs AFFORDABLE (reporting ccy). */
  cash_buffer?: number;
}

export type ScenarioEventType =
  | 'buy_property'
  | 'add_expense'
  | 'add_income'
  | 'one_off';

export interface BuyPropertyEvent {
  type: 'buy_property';
  date: string;
  property_value: number;
  currency: string;
  down_payment: number;
  label?: string;
  mortgage?: {
    annual_rate_pct: number;
    term_months: number;
    payment_amount?: number;
  };
}

export interface AddCashFlowEvent {
  type: 'add_expense' | 'add_income';
  date: string;
  amount: number;
  currency: string;
  frequency: CashFlowFrequency;
  label?: string;
  category?: string;
}

export interface OneOffEvent {
  type: 'one_off';
  date: string;
  /** Signed: negative = cash out. */
  amount: number;
  currency: string;
  label?: string;
}

export type ScenarioEvent = BuyPropertyEvent | AddCashFlowEvent | OneOffEvent;

export interface SavedScenario {
  id: string;
  label: string;
  updated_at: string;
  events: ScenarioEvent[];
  assumption_overrides?: Partial<
    Pick<
      ProjectionAssumptions,
      | 'portfolio_return_annual_pct'
      | 'inflation_annual_pct'
      | 'property_appreciation_annual_pct'
      | 'fx'
      | 'cash_buffer'
    >
  >;
}

export interface HouseholdInvestorState extends InvestorState {
  treasury?: TreasurySettings;
  properties?: PropertyAsset[];
  liabilities?: Liability[];
  cash_flows?: CashFlowLine[];
  projection_assumptions?: ProjectionAssumptions;
  scenarios?: SavedScenario[];
}

// ── shared validation helpers ──────────────────────────────────────────

function assertDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new Error(`${field} must be YYYY-MM-DD.`);
  }
  return value;
}

function assertCurrency(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required (e.g. USD, SGD) — no silent default.`);
  }
  const currency = value.trim().toUpperCase();
  if (!CURRENCY_RE.test(currency)) {
    throw new Error(`${field} must be a 3–4 letter code (got "${value}").`);
  }
  return currency;
}

function assertId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required (non-empty string).`);
  }
  const id = value.trim();
  if (!ID_RE.test(id)) {
    throw new Error(
      `${field} must be alphanumeric/underscore/hyphen, 1–64 chars (got "${id}").`,
    );
  }
  return id;
}

function assertNonNegNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }
  if (value < 0) {
    throw new Error(`${field} must be ≥ 0.`);
  }
  return value;
}

function assertPositiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer.`);
  }
  if (value < 1) {
    throw new Error(`${field} must be ≥ 1.`);
  }
  return value;
}

function optionalLabel(raw: unknown, field: string): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') {
    throw new Error(`${field} must be a string when provided.`);
  }
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

// ── treasury ───────────────────────────────────────────────────────────

export function assertTreasurySettings(raw: unknown): TreasurySettings {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('treasury must be an object with reporting_currency, updated_at.');
  }
  const t = raw as Record<string, unknown>;
  return {
    reporting_currency: assertCurrency(t.reporting_currency, 'treasury.reporting_currency'),
    updated_at: assertDate(t.updated_at, 'treasury.updated_at'),
  };
}

export function getTreasury(state: HouseholdInvestorState): TreasurySettings | null {
  if (state.treasury == null) return null;
  return assertTreasurySettings(state.treasury);
}

export function setTreasury(state: HouseholdInvestorState, treasury: TreasurySettings): void {
  state.treasury = assertTreasurySettings(treasury);
}

// ── properties ─────────────────────────────────────────────────────────

export function assertPropertyPayment(raw: unknown, fieldPrefix = 'payment'): PropertyPayment {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `${fieldPrefix} must be an object with date, amount (optional label).`,
    );
  }
  const pay = raw as Record<string, unknown>;
  const result: PropertyPayment = {
    date: assertDate(pay.date, `${fieldPrefix}.date`),
    amount: assertNonNegNumber(pay.amount, `${fieldPrefix}.amount`),
  };
  const label = optionalLabel(pay.label, `${fieldPrefix}.label`);
  if (label != null) result.label = label;
  return result;
}

export function normalizePropertyPayments(
  raw: unknown,
  fieldPrefix = 'property.payments',
): PropertyPayment[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`${fieldPrefix} must be an array when provided.`);
  }
  return raw.map((item, i) => assertPropertyPayment(item, `${fieldPrefix}[${i}]`));
}

/** Sum of recorded purchase payments, or null when payments field is omitted (unknown). */
export function propertyPaidToDate(property: PropertyAsset): number | null {
  if (property.payments == null) return null;
  let sum = 0;
  for (const pay of property.payments) {
    sum += pay.amount;
  }
  return sum;
}

export function assertProperty(raw: unknown): PropertyAsset {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'property must be an object with id, value, currency, updated_at.',
    );
  }
  const p = raw as Record<string, unknown>;
  const result: PropertyAsset = {
    id: assertId(p.id, 'property.id'),
    value: assertNonNegNumber(p.value, 'property.value'),
    currency: assertCurrency(p.currency, 'property.currency'),
    updated_at: assertDate(p.updated_at, 'property.updated_at'),
  };
  const label = optionalLabel(p.label, 'property.label');
  if (label != null) result.label = label;
  if (p.mortgage_id != null) {
    result.mortgage_id = assertId(p.mortgage_id, 'property.mortgage_id');
  }
  if (Object.prototype.hasOwnProperty.call(p, 'payments')) {
    if (p.payments == null) {
      throw new Error(
        'property.payments must be an array when provided (omit the field if unknown; do not store null).',
      );
    }
    result.payments = normalizePropertyPayments(p.payments);
  }
  return result;
}

/**
 * Append a purchase payment to a property. Mutates state via upsertProperty.
 * Does not touch free cash — pair with set_cash / record_property_payment(cash_channel=…).
 */
export function appendPropertyPayment(
  state: HouseholdInvestorState,
  propertyId: string,
  payment: PropertyPayment,
  updatedAt: string,
): PropertyAsset {
  const key = assertId(propertyId, 'property.id');
  const pay = assertPropertyPayment(payment);
  const updated = assertDate(updatedAt, 'property.updated_at');
  const existing = getProperties(state).find((x) => x.id === key);
  if (existing == null) {
    throw new Error(`Property id "${key}" not found.`);
  }
  const next: PropertyAsset = {
    ...existing,
    updated_at: updated,
    payments: [...(existing.payments ?? []), pay],
  };
  upsertProperty(state, next);
  return getProperties(state).find((x) => x.id === key)!;
}

export function normalizeProperties(raw: unknown): PropertyAsset[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('properties must be an array (or omit when none).');
  }
  const list = raw.map((item, i) => {
    try {
      return assertProperty(item);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`properties[${i}]: ${msg}`);
    }
  });
  const seen = new Set<string>();
  for (const p of list) {
    if (seen.has(p.id)) {
      throw new Error(`Duplicate property id "${p.id}".`);
    }
    seen.add(p.id);
  }
  return list;
}

export function getProperties(state: HouseholdInvestorState): PropertyAsset[] {
  return normalizeProperties(state.properties ?? null);
}

export function setProperties(state: HouseholdInvestorState, properties: PropertyAsset[]): void {
  const validated = normalizeProperties(properties);
  if (validated.length === 0) delete state.properties;
  else state.properties = validated;
}

export function upsertProperty(state: HouseholdInvestorState, property: PropertyAsset): void {
  const entry = assertProperty(property);
  const rest = getProperties(state).filter((p) => p.id !== entry.id);
  setProperties(state, [...rest, entry]);
}

export function removeProperty(state: HouseholdInvestorState, id: string): PropertyAsset {
  const key = assertId(id, 'property.id');
  const all = getProperties(state);
  const found = all.find((p) => p.id === key);
  if (found == null) throw new Error(`Property id "${key}" not found.`);
  // Fail if a mortgage still points at this property
  const liabilities = getLiabilities(state);
  const linked = liabilities.find(
    (l) => l.kind === 'mortgage' && l.property_id === key,
  );
  if (linked != null) {
    throw new Error(
      `Cannot remove property "${key}": liability "${linked.id}" still references it. Remove or re-link the mortgage first.`,
    );
  }
  setProperties(
    state,
    all.filter((p) => p.id !== key),
  );
  return found;
}

// ── liabilities ────────────────────────────────────────────────────────

export function assertLiability(raw: unknown): Liability {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'liability must be an object with id, kind, principal, annual_rate_pct, currency, start_date, term_months, payment_amount, payment_frequency, updated_at.',
    );
  }
  const L = raw as Record<string, unknown>;
  const kind = L.kind;
  if (kind !== 'mortgage' && kind !== 'loan') {
    throw new Error('liability.kind must be "mortgage" or "loan".');
  }
  const payment_frequency = L.payment_frequency;
  if (payment_frequency !== 'monthly') {
    throw new Error('liability.payment_frequency must be "monthly" in v1.');
  }
  const result: Liability = {
    id: assertId(L.id, 'liability.id'),
    kind,
    principal: assertNonNegNumber(L.principal, 'liability.principal'),
    annual_rate_pct: assertNonNegNumber(L.annual_rate_pct, 'liability.annual_rate_pct'),
    currency: assertCurrency(L.currency, 'liability.currency'),
    start_date: assertDate(L.start_date, 'liability.start_date'),
    term_months: assertPositiveInt(L.term_months, 'liability.term_months'),
    payment_amount: assertNonNegNumber(L.payment_amount, 'liability.payment_amount'),
    payment_frequency,
    updated_at: assertDate(L.updated_at, 'liability.updated_at'),
  };
  const label = optionalLabel(L.label, 'liability.label');
  if (label != null) result.label = label;
  if (kind === 'mortgage') {
    if (L.property_id == null) {
      throw new Error('liability.property_id is required when kind=mortgage.');
    }
    result.property_id = assertId(L.property_id, 'liability.property_id');
  } else if (L.property_id != null) {
    result.property_id = assertId(L.property_id, 'liability.property_id');
  }
  return result;
}

export function normalizeLiabilities(raw: unknown): Liability[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('liabilities must be an array (or omit when none).');
  }
  const list = raw.map((item, i) => {
    try {
      return assertLiability(item);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`liabilities[${i}]: ${msg}`);
    }
  });
  const seen = new Set<string>();
  for (const L of list) {
    if (seen.has(L.id)) throw new Error(`Duplicate liability id "${L.id}".`);
    seen.add(L.id);
  }
  return list;
}

export function getLiabilities(state: HouseholdInvestorState): Liability[] {
  return normalizeLiabilities(state.liabilities ?? null);
}

export function setLiabilities(state: HouseholdInvestorState, liabilities: Liability[]): void {
  const validated = normalizeLiabilities(liabilities);
  if (validated.length === 0) delete state.liabilities;
  else state.liabilities = validated;
}

/**
 * Upsert liability. When kind=mortgage, property_id must exist.
 * Optionally validates payment vs annuity (caller may pass skipPaymentCheck).
 */
export function upsertLiability(
  state: HouseholdInvestorState,
  liability: Liability,
  opts?: { skipPaymentCheck?: boolean; paymentTolerance?: number },
): void {
  const entry = assertLiability(liability);
  if (entry.kind === 'mortgage' || entry.property_id != null) {
    if (entry.property_id == null) {
      throw new Error('mortgage requires property_id.');
    }
    const props = getProperties(state);
    if (!props.some((p) => p.id === entry.property_id)) {
      throw new Error(
        `property_id "${entry.property_id}" not found. Add the property first.`,
      );
    }
  }
  if (!opts?.skipPaymentCheck && entry.principal > 0 && entry.term_months > 0) {
    assertPaymentMatchesAnnuity(
      entry.principal,
      entry.annual_rate_pct,
      entry.term_months,
      entry.payment_amount,
      opts?.paymentTolerance,
    );
  }
  const rest = getLiabilities(state).filter((l) => l.id !== entry.id);
  setLiabilities(state, [...rest, entry]);
  // Keep property.mortgage_id in sync for mortgages
  if (entry.kind === 'mortgage' && entry.property_id != null) {
    const props = getProperties(state).map((p) => {
      if (p.id !== entry.property_id) return p;
      return { ...p, mortgage_id: entry.id };
    });
    setProperties(state, props);
  }
}

export function removeLiability(state: HouseholdInvestorState, id: string): Liability {
  const key = assertId(id, 'liability.id');
  const all = getLiabilities(state);
  const found = all.find((l) => l.id === key);
  if (found == null) throw new Error(`Liability id "${key}" not found.`);
  setLiabilities(
    state,
    all.filter((l) => l.id !== key),
  );
  // Clear property.mortgage_id if pointing here
  const props = getProperties(state).map((p) => {
    if (p.mortgage_id !== key) return p;
    const next = { ...p };
    delete next.mortgage_id;
    return next;
  });
  setProperties(state, props);
  return found;
}

// ── cash flows ─────────────────────────────────────────────────────────

export function assertCashFlowLine(raw: unknown): CashFlowLine {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'cash_flow must be an object with id, kind, amount, currency, frequency, start_date, updated_at.',
    );
  }
  const c = raw as Record<string, unknown>;
  if (c.kind !== 'income' && c.kind !== 'expense') {
    throw new Error('cash_flow.kind must be "income" or "expense".');
  }
  if (c.frequency !== 'monthly' && c.frequency !== 'annual') {
    throw new Error('cash_flow.frequency must be "monthly" or "annual".');
  }
  const start_date = assertDate(c.start_date, 'cash_flow.start_date');
  const result: CashFlowLine = {
    id: assertId(c.id, 'cash_flow.id'),
    kind: c.kind,
    amount: assertNonNegNumber(c.amount, 'cash_flow.amount'),
    currency: assertCurrency(c.currency, 'cash_flow.currency'),
    frequency: c.frequency,
    start_date,
    updated_at: assertDate(c.updated_at, 'cash_flow.updated_at'),
  };
  if (c.end_date != null) {
    const end_date = assertDate(c.end_date, 'cash_flow.end_date');
    if (end_date < start_date) {
      throw new Error(
        `cash_flow.end_date (${end_date}) must be ≥ start_date (${start_date}).`,
      );
    }
    result.end_date = end_date;
  }
  const label = optionalLabel(c.label, 'cash_flow.label');
  if (label != null) result.label = label;
  const category = optionalLabel(c.category, 'cash_flow.category');
  if (category != null) result.category = category;
  return result;
}

export function normalizeCashFlows(raw: unknown): CashFlowLine[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('cash_flows must be an array (or omit when none).');
  }
  const list = raw.map((item, i) => {
    try {
      return assertCashFlowLine(item);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`cash_flows[${i}]: ${msg}`);
    }
  });
  const seen = new Set<string>();
  for (const c of list) {
    if (seen.has(c.id)) throw new Error(`Duplicate cash_flow id "${c.id}".`);
    seen.add(c.id);
  }
  return list;
}

export function getCashFlows(state: HouseholdInvestorState): CashFlowLine[] {
  return normalizeCashFlows(state.cash_flows ?? null);
}

export function setCashFlows(state: HouseholdInvestorState, lines: CashFlowLine[]): void {
  const validated = normalizeCashFlows(lines);
  if (validated.length === 0) delete state.cash_flows;
  else state.cash_flows = validated;
}

export function upsertCashFlow(state: HouseholdInvestorState, line: CashFlowLine): void {
  const entry = assertCashFlowLine(line);
  const rest = getCashFlows(state).filter((c) => c.id !== entry.id);
  setCashFlows(state, [...rest, entry]);
}

export function removeCashFlow(state: HouseholdInvestorState, id: string): CashFlowLine {
  const key = assertId(id, 'cash_flow.id');
  const all = getCashFlows(state);
  const found = all.find((c) => c.id === key);
  if (found == null) throw new Error(`Cash flow id "${key}" not found.`);
  setCashFlows(
    state,
    all.filter((c) => c.id !== key),
  );
  return found;
}

// ── projection assumptions ─────────────────────────────────────────────

export function assertProjectionAssumptions(raw: unknown): ProjectionAssumptions {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'projection_assumptions must be an object with portfolio_return_annual_pct, inflation_annual_pct, updated_at.',
    );
  }
  const a = raw as Record<string, unknown>;
  if (typeof a.portfolio_return_annual_pct !== 'number' || !Number.isFinite(a.portfolio_return_annual_pct)) {
    throw new Error('projection_assumptions.portfolio_return_annual_pct must be a finite number.');
  }
  if (typeof a.inflation_annual_pct !== 'number' || !Number.isFinite(a.inflation_annual_pct)) {
    throw new Error('projection_assumptions.inflation_annual_pct must be a finite number.');
  }
  const result: ProjectionAssumptions = {
    portfolio_return_annual_pct: a.portfolio_return_annual_pct,
    inflation_annual_pct: a.inflation_annual_pct,
    updated_at: assertDate(a.updated_at, 'projection_assumptions.updated_at'),
  };
  if (a.property_appreciation_annual_pct != null) {
    if (
      typeof a.property_appreciation_annual_pct !== 'number' ||
      !Number.isFinite(a.property_appreciation_annual_pct)
    ) {
      throw new Error(
        'projection_assumptions.property_appreciation_annual_pct must be a finite number when set.',
      );
    }
    result.property_appreciation_annual_pct = a.property_appreciation_annual_pct;
  }
  if (a.cash_buffer != null) {
    result.cash_buffer = assertNonNegNumber(a.cash_buffer, 'projection_assumptions.cash_buffer');
  }
  if (a.fx != null) {
    if (typeof a.fx !== 'object' || Array.isArray(a.fx)) {
      throw new Error('projection_assumptions.fx must be a map of currency → rate.');
    }
    const fx: Record<string, number> = {};
    for (const [k, v] of Object.entries(a.fx as Record<string, unknown>)) {
      const ccy = assertCurrency(k, `projection_assumptions.fx key`);
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        throw new Error(
          `projection_assumptions.fx.${ccy} must be a positive finite number (units of reporting ccy per 1 ${ccy}).`,
        );
      }
      fx[ccy] = v;
    }
    result.fx = fx;
  }
  return result;
}

export function getProjectionAssumptions(
  state: HouseholdInvestorState,
): ProjectionAssumptions | null {
  if (state.projection_assumptions == null) return null;
  return assertProjectionAssumptions(state.projection_assumptions);
}

export function setProjectionAssumptions(
  state: HouseholdInvestorState,
  assumptions: ProjectionAssumptions,
): void {
  state.projection_assumptions = assertProjectionAssumptions(assumptions);
}

// ── scenarios ──────────────────────────────────────────────────────────

function assertScenarioEvent(raw: unknown, index: number): ScenarioEvent {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`events[${index}] must be an object.`);
  }
  const e = raw as Record<string, unknown>;
  const type = e.type;
  const date = assertDate(e.date, `events[${index}].date`);

  if (type === 'buy_property') {
    const event: BuyPropertyEvent = {
      type: 'buy_property',
      date,
      property_value: assertNonNegNumber(e.property_value, `events[${index}].property_value`),
      currency: assertCurrency(e.currency, `events[${index}].currency`),
      down_payment: assertNonNegNumber(e.down_payment, `events[${index}].down_payment`),
    };
    if (event.down_payment > event.property_value) {
      throw new Error(
        `events[${index}]: down_payment cannot exceed property_value.`,
      );
    }
    const label = optionalLabel(e.label, `events[${index}].label`);
    if (label != null) event.label = label;
    if (e.mortgage != null) {
      if (typeof e.mortgage !== 'object' || Array.isArray(e.mortgage)) {
        throw new Error(`events[${index}].mortgage must be an object.`);
      }
      const m = e.mortgage as Record<string, unknown>;
      const mortgage: BuyPropertyEvent['mortgage'] = {
        annual_rate_pct: assertNonNegNumber(
          m.annual_rate_pct,
          `events[${index}].mortgage.annual_rate_pct`,
        ),
        term_months: assertPositiveInt(m.term_months, `events[${index}].mortgage.term_months`),
      };
      if (m.payment_amount != null) {
        mortgage.payment_amount = assertNonNegNumber(
          m.payment_amount,
          `events[${index}].mortgage.payment_amount`,
        );
      }
      event.mortgage = mortgage;
    }
    return event;
  }

  if (type === 'add_expense' || type === 'add_income') {
    if (e.frequency !== 'monthly' && e.frequency !== 'annual') {
      throw new Error(`events[${index}].frequency must be "monthly" or "annual".`);
    }
    const event: AddCashFlowEvent = {
      type,
      date,
      amount: assertNonNegNumber(e.amount, `events[${index}].amount`),
      currency: assertCurrency(e.currency, `events[${index}].currency`),
      frequency: e.frequency,
    };
    const label = optionalLabel(e.label, `events[${index}].label`);
    if (label != null) event.label = label;
    const category = optionalLabel(e.category, `events[${index}].category`);
    if (category != null) event.category = category;
    return event;
  }

  if (type === 'one_off') {
    if (typeof e.amount !== 'number' || !Number.isFinite(e.amount)) {
      throw new Error(`events[${index}].amount must be a finite number (signed).`);
    }
    const event: OneOffEvent = {
      type: 'one_off',
      date,
      amount: e.amount,
      currency: assertCurrency(e.currency, `events[${index}].currency`),
    };
    const label = optionalLabel(e.label, `events[${index}].label`);
    if (label != null) event.label = label;
    return event;
  }

  throw new Error(
    `events[${index}].type must be buy_property | add_expense | add_income | one_off (got "${String(type)}").`,
  );
}

export function assertSavedScenario(raw: unknown): SavedScenario {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('scenario must be an object with id, label, updated_at, events.');
  }
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.events)) {
    throw new Error('scenario.events must be an array.');
  }
  const label = optionalLabel(s.label, 'scenario.label');
  if (label == null) {
    throw new Error('scenario.label is required.');
  }
  const events = s.events.map((ev, i) => assertScenarioEvent(ev, i));
  const result: SavedScenario = {
    id: assertId(s.id, 'scenario.id'),
    label,
    updated_at: assertDate(s.updated_at, 'scenario.updated_at'),
    events,
  };
  if (s.assumption_overrides != null) {
    if (typeof s.assumption_overrides !== 'object' || Array.isArray(s.assumption_overrides)) {
      throw new Error('scenario.assumption_overrides must be an object.');
    }
    const o = s.assumption_overrides as Record<string, unknown>;
    const overrides: NonNullable<SavedScenario['assumption_overrides']> = {};
    if (o.portfolio_return_annual_pct != null) {
      if (typeof o.portfolio_return_annual_pct !== 'number' || !Number.isFinite(o.portfolio_return_annual_pct)) {
        throw new Error('assumption_overrides.portfolio_return_annual_pct must be finite.');
      }
      overrides.portfolio_return_annual_pct = o.portfolio_return_annual_pct;
    }
    if (o.inflation_annual_pct != null) {
      if (typeof o.inflation_annual_pct !== 'number' || !Number.isFinite(o.inflation_annual_pct)) {
        throw new Error('assumption_overrides.inflation_annual_pct must be finite.');
      }
      overrides.inflation_annual_pct = o.inflation_annual_pct;
    }
    if (o.property_appreciation_annual_pct != null) {
      if (
        typeof o.property_appreciation_annual_pct !== 'number' ||
        !Number.isFinite(o.property_appreciation_annual_pct)
      ) {
        throw new Error('assumption_overrides.property_appreciation_annual_pct must be finite.');
      }
      overrides.property_appreciation_annual_pct = o.property_appreciation_annual_pct;
    }
    if (o.cash_buffer != null) {
      overrides.cash_buffer = assertNonNegNumber(o.cash_buffer, 'assumption_overrides.cash_buffer');
    }
    if (o.fx != null) {
      if (typeof o.fx !== 'object' || Array.isArray(o.fx)) {
        throw new Error('assumption_overrides.fx must be a map.');
      }
      const fx: Record<string, number> = {};
      for (const [k, v] of Object.entries(o.fx as Record<string, unknown>)) {
        const ccy = assertCurrency(k, 'assumption_overrides.fx key');
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
          throw new Error(`assumption_overrides.fx.${ccy} must be a positive finite number.`);
        }
        fx[ccy] = v;
      }
      overrides.fx = fx;
    }
    result.assumption_overrides = overrides;
  }
  return result;
}

export function normalizeScenarios(raw: unknown): SavedScenario[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('scenarios must be an array (or omit when none).');
  }
  const list = raw.map((item, i) => {
    try {
      return assertSavedScenario(item);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`scenarios[${i}]: ${msg}`);
    }
  });
  const seen = new Set<string>();
  for (const s of list) {
    if (seen.has(s.id)) throw new Error(`Duplicate scenario id "${s.id}".`);
    seen.add(s.id);
  }
  return list;
}

export function getScenarios(state: HouseholdInvestorState): SavedScenario[] {
  return normalizeScenarios(state.scenarios ?? null);
}

export function setScenarios(state: HouseholdInvestorState, scenarios: SavedScenario[]): void {
  const validated = normalizeScenarios(scenarios);
  if (validated.length === 0) delete state.scenarios;
  else state.scenarios = validated;
}

export function upsertScenario(state: HouseholdInvestorState, scenario: SavedScenario): void {
  const entry = assertSavedScenario(scenario);
  const rest = getScenarios(state).filter((s) => s.id !== entry.id);
  setScenarios(state, [...rest, entry]);
}

export function removeScenario(state: HouseholdInvestorState, id: string): SavedScenario {
  const key = assertId(id, 'scenario.id');
  const all = getScenarios(state);
  const found = all.find((s) => s.id === key);
  if (found == null) throw new Error(`Scenario id "${key}" not found.`);
  setScenarios(
    state,
    all.filter((s) => s.id !== key),
  );
  return found;
}

export function findScenarioById(
  scenarios: SavedScenario[],
  id: string,
): SavedScenario | null {
  const key = assertId(id, 'scenario.id');
  return scenarios.find((s) => s.id === key) ?? null;
}

/** Auto id helpers */
export function generateHouseholdId(prefix: string, existing: Array<{ id: string }>): string {
  const base = prefix.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const taken = new Set(existing.map((x) => x.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * Configuration gaps for enrichMessage / get_household.
 * Does not invent completeness.
 */
export function householdGaps(state: HouseholdInvestorState): string[] {
  const gaps: string[] = [];
  const treasury = state.treasury != null ? getTreasury(state) : null;
  if (treasury == null) gaps.push('treasury.reporting_currency not set');
  if (getProjectionAssumptions(state) == null) {
    gaps.push('projection_assumptions not set');
  }
  if (getCashFlows(state).length === 0) gaps.push('no cash_flow lines');
  return gaps;
}
