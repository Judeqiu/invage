import { SaxesParser } from 'saxes';
import { assertOptionLifecycleEvent, type OptionLifecycleEvent } from '../brokers/option-events.js';
import { decimal } from '../brokers/option-executions.js';

function ymd(value: string | undefined, field: string): string {
  const raw = value?.trim() ?? '';
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  throw new Error(`IBKR option event missing or invalid ${field}`);
}

function required(row: Record<string, string>, field: string): string {
  const value = row[field]?.trim();
  if (!value) throw new Error(`IBKR option event missing ${field}`);
  return value;
}

function optionalDecimal(value: string | undefined): string | undefined {
  const raw = value?.trim();
  return raw ? decimal(raw) : undefined;
}

function mapEvent(row: Record<string, string>, accountId: string, channel: string): OptionLifecycleEvent {
  const account = row.accountId?.trim() || accountId;
  if (account !== accountId) throw new Error('IBKR option event account differs from statement account');
  const rawKind = required(row, 'transactionType').toLowerCase().replace(/[\s_-]+/g, '');
  const kinds: Record<string, OptionLifecycleEvent['kind']> = {
    expiration: 'expiration', expired: 'expiration',
    assignment: 'assignment', exercise: 'exercise',
    cashsettlement: 'cash_settlement', cashdelivery: 'cash_settlement',
  };
  const kind = kinds[rawKind];
  if (!kind) throw new Error(`Unsupported IBKR option event transactionType: ${row.transactionType}`);
  const rightRaw = required(row, 'putCall').toUpperCase();
  const right = rightRaw === 'P' || rightRaw === 'PUT' ? 'put' :
    rightRaw === 'C' || rightRaw === 'CALL' ? 'call' : null;
  if (!right) throw new Error(`Unsupported IBKR option event putCall: ${rightRaw}`);
  const quantity = decimal(required(row, 'quantity')).replace(/^-/, '');
  const delivery = (row.deliveryType ?? '').toUpperCase();
  const settlement = kind === 'cash_settlement' || delivery.includes('CASH') ? 'cash' :
    delivery.includes('PHYSICAL') ? 'physical' : 'unknown';
  const event: OptionLifecycleEvent = {
    id: required(row, 'tradeID'), broker_id: 'ibkr', channel, account_id: account,
    underlying: required(row, 'underlyingSymbol').toUpperCase(), right,
    strike: required(row, 'strike'), expiry: ymd(row.expiry, 'expiry'),
    multiplier: required(row, 'multiplier'), date: ymd(row.date ?? row.tradeDate, 'date'),
    kind, settlement, contracts: quantity, currency: required(row, 'currency').toUpperCase(),
    source: 'ibkr_flex',
  };
  if (row.conid?.trim()) event.contract_id = row.conid.trim();
  const proceeds = optionalDecimal(row.proceeds);
  if (proceeds !== undefined) event.proceeds = proceeds;
  const fees = optionalDecimal(row.commTax ?? row.ibCommission);
  if (fees !== undefined) event.fees = fees;
  const realized = optionalDecimal(row.realizedPnl ?? row.fifoPnlRealized);
  if (realized !== undefined) event.broker_realized_pl = realized;
  return assertOptionLifecycleEvent(event);
}

/** The Flex OptionEAE section is optional. Malformed rows become visible coverage gaps. */
export function parseFlexOptionEvents(xml: string, channel = 'ibkr'): {
  events: OptionLifecycleEvent[];
  skipped: Array<{ kind: 'event'; reason: string; symbol?: string }>;
} | undefined {
  const rows: Record<string, string>[] = [];
  const statements: Record<string, string>[] = [];
  let sectionSeen = false;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => { throw new Error('Flex XML must not include a document type'); });
  parser.on('opentag', tag => {
    if (tag.name === 'FlexStatement') statements.push(tag.attributes);
    if (tag.name === 'OptionEAE') {
      sectionSeen = true;
      if (Object.keys(tag.attributes).length) rows.push(tag.attributes);
    }
  });
  parser.write(xml).close();
  if (!sectionSeen) return undefined;
  if (statements.length !== 1 || !statements[0].accountId) throw new Error('Option events require one FlexStatement account');
  const account = statements[0].accountId;
  const events: OptionLifecycleEvent[] = [];
  const skipped: Array<{ kind: 'event'; reason: string; symbol?: string }> = [];
  for (const row of rows) {
    if (row.assetCategory && row.assetCategory !== 'OPT') continue;
    try { events.push(mapEvent(row, account, channel)); }
    catch (error) {
      skipped.push({ kind: 'event', reason: error instanceof Error ? error.message : String(error),
        ...(row.symbol ? { symbol: row.symbol } : {}) });
    }
  }
  return { events, skipped };
}
