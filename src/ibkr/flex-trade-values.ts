import type { OptionExecution } from '../brokers/option-executions.js';

/** Position effect is metadata, not a prerequisite for retaining execution cash. */
export function flexTradeEffect(value?: string): OptionExecution['effect'] {
  const codes = new Set((value ?? '').trim().toUpperCase().split(';').map(code => code.trim()).filter(Boolean));
  if ([...codes].every(code => code === 'O' || code === 'C')) {
    if (codes.size === 2) return 'mixed';
    if (codes.has('O')) return 'open';
    if (codes.has('C')) return 'close';
  }
  return 'unknown';
}

export function flexTradeIsOption(row: Record<string, string>): boolean {
  return row.assetCategory?.trim().toUpperCase() === 'OPT' ||
    !row.assetCategory?.trim() && ['P', 'C', 'PUT', 'CALL'].includes(row.putCall?.trim().toUpperCase());
}

export function flexTradeRight(value?: string): 'put' | 'call' | null {
  const right = value?.trim().toUpperCase();
  return right === 'P' || right === 'PUT' ? 'put' : right === 'C' || right === 'CALL' ? 'call' : null;
}

export function flexTradeTimestamp(value: string): string {
  return value.trim().replace(/^(\d{4})-?(\d{2})-?(\d{2})[;T](\d{2}):?(\d{2}):?(\d{2})$/, '$1-$2-$3T$4:$5:$6');
}
