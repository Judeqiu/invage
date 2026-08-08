/**
 * One-shot repair: marina OCBC channel funds (2026-08-08 reconcile).
 *
 * Removes leftover placeholders OCBCRI/OCBCPM (and OCBCUT if present),
 * books the 7 real unit trusts from OCBC screenshot (account 111-0425598-430).
 * No cash-ledger impact (correction only).
 *
 * Usage (on host with UTARUS_DATA_ROOT set):
 *   UTARUS_DATA_ROOT=/opt/invage/data node scripts/fix-marina-ocbc-funds.mjs
 *   UTARUS_DATA_ROOT=/opt/invage/data node scripts/fix-marina-ocbc-funds.mjs --dry-run
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const dataRoot = process.env.UTARUS_DATA_ROOT;
if (!dataRoot) {
  console.error('UTARUS_DATA_ROOT is required');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');
const path = join(dataRoot, 'users', 'marina.yaml');
if (!existsSync(path)) {
  console.error(`Missing ${path}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const REMOVE = ['OCBCUT@ocbc', 'OCBCRI@ocbc', 'OCBCPM@ocbc'];

/** @type {Array<{key: string, avg_price: number, mark: number, fund_name: string, category: string}>} */
const FUNDS = [
  {
    key: 'EASTSPRING-ASB@ocbc',
    avg_price: 20000.0,
    mark: 19340.22,
    fund_name: 'Eastspring Asia Select Bond VSDM SGD-H (SGD)',
    category: 'OCBC unit trust (SGD)',
  },
  {
    key: 'FTGF-CLRBRDG@ocbc',
    avg_price: 15000.42,
    mark: 15789.92,
    fund_name: 'FTGF ClearBridge Glb Infras Inc A SGD Dist (M) H+ (SGD)',
    category: 'OCBC unit trust (SGD)',
  },
  {
    key: 'PIMCO-BALINC@ocbc',
    avg_price: 9999.97,
    mark: 10273.04,
    fund_name: 'PIMCO GIS Balanced Income & Growth M R SGD-H Inc II (SGD)',
    category: 'OCBC unit trust (SGD)',
  },
  {
    key: 'SCHRODER-ASINC-SGD@ocbc',
    avg_price: 10000.42,
    mark: 10938.13,
    fund_name: 'Schroder Asian Income SGD A Dis (SGD)',
    category: 'OCBC unit trust (SGD)',
  },
  {
    key: 'LION-BOS-ASINC@ocbc',
    avg_price: 20000.29,
    mark: 17952.94,
    fund_name: 'Lion-Bank of Singapore Asian Income USD A Dist (USD)',
    category: 'OCBC unit trust (USD)',
  },
  {
    key: 'PIMCO-INCOME-USD@ocbc',
    avg_price: 20000.07,
    mark: 19593.97,
    fund_name: 'PIMCO GIS Income E USD Dist (USD)',
    category: 'OCBC unit trust (USD)',
  },
  {
    key: 'SCHRODER-ASINC-USDH@ocbc',
    avg_price: 29998.82,
    mark: 28948.25,
    fund_name: 'Schroder Asian Income USD Hedged A Dis (USD)',
    category: 'OCBC unit trust (USD)',
  },
];

const raw = readFileSync(path, 'utf8');
const state = parseYaml(raw);
if (!state || typeof state !== 'object') {
  console.error('Invalid marina.yaml');
  process.exit(1);
}
if (!state.portfolio || typeof state.portfolio !== 'object') {
  state.portfolio = {};
}
if (!Array.isArray(state.log)) {
  state.log = [];
}

const removed = [];
for (const k of REMOVE) {
  if (state.portfolio[k]) {
    const h = state.portfolio[k];
    removed.push(k);
    if (!dryRun) {
      delete state.portfolio[k];
      state.log.push({
        ts: today,
        action: 'holding_removed',
        ticker: k,
        avg_price: h.avg_price,
        units: h.units,
        instrument: h.instrument ?? 'fund',
        channel: h.channel ?? 'ocbc',
        note: 'OCBC screenshot reconcile 2026-08-08: remove placeholder',
      });
    }
  }
}

const added = [];
for (const f of FUNDS) {
  if (state.portfolio[f.key] && !dryRun) {
    console.error(`Refusing to overwrite existing key ${f.key}`);
    process.exit(1);
  }
  const holding = {
    instrument: 'fund',
    avg_price: f.avg_price,
    units: 1,
    category: f.category,
    channel: 'ocbc',
    fund: {
      quote_source: 'manual',
      mark: f.mark,
      name: f.fund_name,
    },
  };
  added.push(f.key);
  if (!dryRun) {
    state.portfolio[f.key] = holding;
    state.log.push({
      ts: today,
      action: 'holding_added',
      ticker: f.key,
      instrument: 'fund',
      avg_price: f.avg_price,
      units: 1,
      category: f.category,
      channel: 'ocbc',
      fund: holding.fund,
      note: 'OCBC screenshot reconcile 2026-08-08: book real fund (adjust_cash=false)',
    });
  }
}

const ocbcKeys = Object.keys(state.portfolio).filter(
  (k) => k.endsWith('@ocbc') || state.portfolio[k]?.channel === 'ocbc',
);

console.log(JSON.stringify({ dryRun, path, removed, added, ocbcKeysAfter: dryRun ? '(dry-run unchanged)' : ocbcKeys }, null, 2));

if (dryRun) {
  console.log('Dry run — no write.');
  process.exit(0);
}

const bak = `${path}.bak-ocbc-reconcile-${today.replace(/-/g, '')}`;
copyFileSync(path, bak);
writeFileSync(path, stringifyYaml(state, { lineWidth: 0 }), 'utf8');
console.log(`Wrote ${path}; backup ${bak}`);
