/** Product-owned history is outside the framework's storage migration families. */
import { existsSync, readFileSync, readdirSync, renameSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
const value = key => process.argv[process.argv.indexOf(key) + 1];
if (!process.argv.includes('--mapping') || !process.argv.includes('--data-root')) throw new Error('Supply --mapping and --data-root');
const mapping = JSON.parse(readFileSync(value('--mapping'), 'utf8'));
const root = join(value('--data-root'), 'broker-sync-history');
const apply = process.argv.includes('--apply');
const plans = [];
if (existsSync(root)) for (const alias of readdirSync(root)) {
  const source = join(root, alias);
  if (!lstatSync(source).isDirectory() || lstatSync(source).isSymbolicLink()) throw new Error('Unexpected history entry');
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(alias)) continue;
  const id = mapping[alias];
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error(`Unknown owner ${alias}`);
  const target = join(root, id);
  if (existsSync(target) || plans.some(plan => plan.target === target)) throw new Error('History destination collision');
  plans.push({ source, target });
}
console.log(JSON.stringify({ apply, moves: plans }));
if (apply) for (const plan of plans) renameSync(plan.source, plan.target);
