/**
 * Seed / refresh per-agent KB corpora (utarus ≥ v3.0.0-beta.9).
 *
 * Writes data/kb/agents/<agentId>.yaml from kb-seed/agents/<agentId>.yaml
 * (merge by entry id — seed wins on title/body/tags for known ids; preserves
 * non-seed admin entries).
 *
 *   UTARUS_DATA_ROOT=/opt/invage/data node scripts/seed-agent-kb.mjs
 *   UTARUS_DATA_ROOT=./data node scripts/seed-agent-kb.mjs --dry-run
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const seedDir = join(repoRoot, 'kb-seed', 'agents');
const dataRoot = process.env.UTARUS_DATA_ROOT;
if (!dataRoot) {
  console.error('UTARUS_DATA_ROOT is required');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force'); // overwrite all seed ids even if body changed by admin

const AGENTS = ['bookkeeper', 'accountant', 'investment-expert', 'real-estate-expert'];

function loadSeed(agentId) {
  const p = join(seedDir, `${agentId}.yaml`);
  if (!existsSync(p)) {
    throw new Error(`Missing seed file: ${p}`);
  }
  const file = parseYaml(readFileSync(p, 'utf8'));
  if (!file || file.version !== 1 || file.agent_id !== agentId) {
    throw new Error(`Invalid seed header for ${agentId}`);
  }
  if (!Array.isArray(file.entries) || file.entries.length === 0) {
    throw new Error(`Seed ${agentId} has no entries`);
  }
  return file;
}

function loadOrEmpty(agentId, path) {
  if (!existsSync(path)) {
    return {
      version: 1,
      agent_id: agentId,
      entries: [],
      updated_at: new Date().toISOString(),
    };
  }
  return parseYaml(readFileSync(path, 'utf8'));
}

const outDir = join(dataRoot, 'kb', 'agents');
mkdirSync(outDir, { recursive: true });

for (const agentId of AGENTS) {
  const seed = loadSeed(agentId);
  const dest = join(outDir, `${agentId}.yaml`);
  const current = loadOrEmpty(agentId, dest);
  const byId = new Map((current.entries || []).map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  for (const se of seed.entries) {
    const prev = byId.get(se.id);
    if (!prev) {
      byId.set(se.id, se);
      added++;
      continue;
    }
    // Update if force, or if previous was system-seed provenance
    if (force || prev.provenance === 'system' || prev.source === 'invage-seed') {
      byId.set(se.id, { ...se, created_at: prev.created_at || se.created_at });
      updated++;
    }
  }
  const next = {
    version: 1,
    agent_id: agentId,
    entries: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    updated_at: new Date().toISOString(),
  };
  console.log(
    JSON.stringify({
      agentId,
      dest,
      dryRun,
      seedEntries: seed.entries.length,
      totalAfter: next.entries.length,
      added,
      updated,
    }),
  );
  if (!dryRun) {
    if (existsSync(dest)) {
      copyFileSync(dest, `${dest}.bak-seed-${Date.now()}`);
    }
    writeFileSync(dest, stringifyYaml(next, { lineWidth: 0 }), 'utf8');
  }
}

console.log(dryRun ? 'Dry run complete.' : 'Seed complete.');
