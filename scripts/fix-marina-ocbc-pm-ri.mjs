/**
 * Book OCBC Precious Metals (PM) + Smart Invest (RI) as real SGD funds.
 *
 * Screenshot (2026-08-08): invested + market value match old OCBCPM/OCBCRI
 * placeholders (currency was mislabeled USD; products are SGD).
 *
 *   UTARUS_DATA_ROOT=/opt/invage/data node scripts/fix-marina-ocbc-pm-ri.mjs
 *   UTARUS_DATA_ROOT=/opt/invage/data node scripts/fix-marina-ocbc-pm-ri.mjs --dry-run
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

/** @type {Array<{key: string, avg_price: number, mark: number, fund_name: string, category: string}>} */
const FUNDS = [
  {
    key: 'OCBCPM@ocbc',
    avg_price: 9983.81,
    mark: 7547.3,
    fund_name: 'OCBC 贵金属 Precious Metals (SGD)',
    category: 'OCBC Smart Invest / Precious Metals (SGD)',
  },
  {
    key: 'OCBCRI@ocbc',
    avg_price: 20086.66,
    mark: 20280.43,
    fund_name: 'OCBC 智能投资 Smart Invest (SGD)',
    category: 'OCBC Smart Invest / Robo (SGD)',
  },
];

const raw = readFileSync(path, 'utf8');
const state = parseYaml(raw);
if (!state?.portfolio) {
  console.error('Invalid marina.yaml (no portfolio)');
  process.exit(1);
}
if (!Array.isArray(state.log)) state.log = [];

const added = [];
const skipped = [];
for (const f of FUNDS) {
  if (state.portfolio[f.key]) {
    skipped.push(f.key);
    continue;
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
      note: 'OCBC PM/RI screenshot reconcile 2026-08-08 (SGD, adjust_cash=false)',
    });
  }
}

const ocbc = Object.keys(state.portfolio).filter(
  (k) => k.endsWith('@ocbc') || state.portfolio[k]?.channel === 'ocbc',
);
console.log(JSON.stringify({ dryRun, path, added, skipped, ocbcKeys: ocbc }, null, 2));

if (dryRun) {
  console.log('Dry run — no write.');
  process.exit(0);
}
if (added.length === 0) {
  console.log('Nothing to add.');
  process.exit(0);
}

const bak = `${path}.bak-ocbc-pm-ri-${today.replace(/-/g, '')}`;
copyFileSync(path, bak);
writeFileSync(path, stringifyYaml(state, { lineWidth: 0 }), 'utf8');
console.log(`Wrote ${path}; backup ${bak}`);
