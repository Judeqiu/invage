import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeYaml, normalizeUsage, inventory } from '../../scripts/migration/import-invage-v4.mjs';

test('source decoding rejects duplicate keys and precision loss', () => {
  assert.throws(() => decodeYaml(Buffer.from('a: 1\na: 2\n')), /Invalid/);
  assert.throws(() => decodeYaml(Buffer.from('a: 9007199254740993\n')), /precision/);
});
test('v1 conversion preserves domain-independent historical telemetry and dates', () => {
  const original = {version:1, user_slug:'test-user', period:'2026-07', created_at:'2026-07-01T00:00:00Z', updated_at:'2026-07-02T00:00:00Z',
    period_llm:{total_tokens:2000,cache_read:1000}, lifetime_llm:{total_tokens:10000,cache_read:0},
    period_tools:{get_quote:2},lifetime_tools:{get_quote:3},period_video:{calls:2,cost_usd:1.25},lifetime_video:{calls:5,cost_usd:3.5}};
  const copy=structuredClone(original);
  const result=normalizeUsage(original);
  assert.deepEqual(original,copy);
  for(const key of Object.keys(original).filter(key=>key!=='version'))assert.deepEqual(result[key],original[key]);
  assert.equal(result.version,3);
  assert.ok(result.period_credits>=20);
  assert.ok(result.lifetime_credits>=30);
  assert.deepEqual(normalizeUsage(result),result);
  assert.throws(()=>normalizeUsage({...original,period_credits:50}),/Ambiguous/);
});
test('every retained file is hashed and unsupported families stop import', () => {
  const root=mkdtempSync(join(tmpdir(),'invage-migration-test-'));
  mkdirSync(join(root,'drive'));
  writeFileSync(join(root,'drive','report.html'),'original report');
  const before=inventory(root);
  writeFileSync(join(root,'drive','report.html'),'changed report');
  assert.notEqual(inventory(root)[0].sha256,before[0].sha256);
  mkdirSync(join(root,'notes'));
  writeFileSync(join(root,'notes','new-note.yaml'),'title: new');
  assert.throws(()=>inventory(root),/Unsupported source family/);
});
test('symlinked source files fail closed',()=>{
 const root=mkdtempSync(join(tmpdir(),'invage-migration-link-'));
 symlinkSync('/etc/hosts',join(root,'invites.yaml'));
 assert.throws(()=>inventory(root),/symlink/);
});
