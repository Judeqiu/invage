/** Backport Utarus d3cbab0ee's credit-exemption hook without unrelated upgrades.
 * Remove this backport after upgrading to a framework pin containing that hook.
 * Patch source, runtime and declarations; verify every replacement before writing.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../node_modules/utarus/', import.meta.url);
const changes = [];
function replaceOnce(source, before, after, path) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) {
    throw new Error(`Credit exemption backport no longer matches ${path}; review the framework pin.`);
  }
  return source.replace(before, after);
}
for (const [path, indent] of [
  ['src/billing/entitlements.ts', '  '],
  ['dist/billing/entitlements.js', '    '],
]) {
  const file = new URL(path, root);
  let source = readFileSync(file, 'utf8');
  source = replaceOnce(source,
    "import { freePlanId, getPlan, loadPlansCatalog } from './plans.js';",
    "import { freePlanId, getBillingExtension, getPlan, loadPlansCatalog } from './plans.js';", path);
  const anchor = `${indent}const weekly = weeklyCreditWindow(now);`;
  source = replaceOnce(source, anchor,
    `${indent}if (await getBillingExtension()?.creditExempt?.(userId) === true) return undefined;\n${anchor}`, path);
  changes.push([file, source]);
}
for (const path of ['src/billing/types.ts', 'dist/billing/types.d.ts']) {
  const file = new URL(path, root);
  const source = replaceOnce(readFileSync(file, 'utf8'),
    'export interface DomainBillingConfig {',
    'export interface DomainBillingConfig {\n  /** Live credit-only exemption; usage tracking and admin permissions are unchanged. */\n  creditExempt?: (userId: string) => Promise<boolean>;', path);
  changes.push([file, source]);
}
for (const [file, source] of changes) {
  if (readFileSync(file, 'utf8') !== source) writeFileSync(file, source);
}
