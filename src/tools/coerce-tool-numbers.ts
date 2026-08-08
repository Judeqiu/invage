/**
 * Pre-validate / normalize LLM tool arguments for numeric fields.
 *
 * Models often paste screenshot numbers with thousand separators ("19,340.22")
 * or unicode minus signs. TypeBox rejects those before execute. Coerce known
 * numeric fields here (fail-fast on garbage — never invent a value).
 */

const UNICODE_MINUS = /[\u2212\u2013\u2014]/g;

/**
 * Coerce a single tool argument to a finite number.
 * Accepts finite numbers and numeric strings with optional commas / currency `$`.
 */
export function coerceToolNumber(value: unknown, field: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${field} must be a finite number (got ${value}).`);
    }
    return value;
  }
  if (typeof value === 'string') {
    let t = value.trim();
    if (t.length === 0) {
      throw new Error(`${field} must be a finite number (got empty string).`);
    }
    // Strip currency adornments and thousand separators; normalize unicode minus.
    t = t
      .replace(UNICODE_MINUS, '-')
      .replace(/[$€£¥]/g, '')
      .replace(/,/g, '')
      .replace(/\s/g, '');
    if (t.length === 0) {
      throw new Error(`${field} must be a finite number (got ${JSON.stringify(value)}).`);
    }
    const n = Number(t);
    if (!Number.isFinite(n)) {
      throw new Error(
        `${field} must be a finite number. Got ${JSON.stringify(value)}. ` +
          `Pass a plain number (e.g. 19340.22). Comma-formatted screenshot values are accepted after stripping.`,
      );
    }
    return n;
  }
  throw new Error(
    `${field} must be a finite number. Got ${typeof value === 'object' ? JSON.stringify(value) : String(value)}.`,
  );
}

/**
 * Return a shallow copy of tool args with the listed fields coerced to numbers
 * when present (undefined/null omitted fields stay omitted).
 */
export function prepareNumericToolArgs(
  args: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (args == null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Tool arguments must be a JSON object.');
  }
  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(out, field)) continue;
    const v = out[field];
    if (v === undefined || v === null) continue;
    out[field] = coerceToolNumber(v, field);
  }
  return out;
}

/** Numeric fields used by holding journal tools. */
export const HOLDING_NUMERIC_FIELDS = [
  'avg_price',
  'units',
  'mark',
  'strike',
  'multiplier',
  'underlying_mark',
] as const;

/** Numeric fields used by set_cash / deposits. */
export const CASH_NUMERIC_FIELDS = ['amount', 'interest'] as const;
