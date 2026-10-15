import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from 'utarus';

// Invalidate persisted results whenever the application or dashboard code changes.
const applicationRoot = new URL('../../', import.meta.url);
function codeDigest(): string {
  const hash = createHash('sha256').update('dashboard-cache-v1');
  const walk = (dir: URL) => {
    for (const file of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const url = new URL(file.name + (file.isDirectory() ? '/' : ''), dir);
      if (file.isDirectory()) walk(url);
      else if (file.isFile()) hash.update(url.pathname).update(readFileSync(url));
    }
  };
  walk(new URL('../', import.meta.url));
  walk(new URL('webui/', applicationRoot));
  hash.update(readFileSync(new URL('package.json', applicationRoot)));
  return hash.digest('hex');
}
const epoch = codeDigest();
export const cacheFingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const dashboardEnvironment = () => [process.env.INVAGE_PRODUCT_PROFILE, process.env.UTARUS_AGENT_NAME];

function location(namespace: string, scope: string) {
  if (!/^[a-z-]+$/.test(namespace)) throw new Error('Invalid dashboard cache namespace');
  const directory = join(resolveDataRoot(), 'cache', 'dashboard', namespace);
  return { directory, file: join(directory, cacheFingerprint(scope) + '.json') };
}

/** Private disposable data, never a source of truth. Invalid/unavailable caches are misses. */
export function readDashboardCache<T>(namespace: string, scope: string, fingerprint: string, maxAgeMs: number): T | null {
  try {
    const { file } = location(namespace, scope);
    if (statSync(file).size > 32 * 1024 * 1024) return null;
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    const age = Date.now() - entry.at;
    return entry.epoch === epoch && entry.fingerprint === fingerprint && Number.isFinite(age) && age >= 0 && age < maxAgeMs
      ? entry.value as T : null;
  } catch { return null; }
}

export function writeDashboardCache(namespace: string, scope: string, fingerprint: string, value: unknown): void {
  let temporary: string | undefined;
  try {
    const { directory, file } = location(namespace, scope);
    const serialized = JSON.stringify({ epoch, fingerprint, at: Date.now(), value });
    if (Buffer.byteLength(serialized) > 32 * 1024 * 1024) return;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    temporary = file + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, serialized, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
    // Bound disk use as tenants and historical date ranges accumulate.
    const files = readdirSync(directory).filter(name => name.endsWith('.json'))
      .map(name => { const stat = statSync(join(directory, name)); return { name, at: stat.mtimeMs, bytes: stat.size }; })
      .sort((a, b) => b.at - a.at);
    let retainedBytes = 0;
    for (const [index, old] of files.entries()) {
      retainedBytes += old.bytes;
      if (index >= 128 || retainedBytes > 128 * 1024 * 1024) unlinkSync(join(directory, old.name));
    }
  } catch { /* Cache failures must not prevent a fresh calculation. */ }
  finally { if (temporary) { try { unlinkSync(temporary); } catch { /* Renamed or not created. */ } } }
}

export function cachedDashboardCalculation<T>(namespace: string, scope: string, input: unknown, calculate: () => T,
  shouldCache: (value: T) => boolean = () => true): T {
  const fingerprint = cacheFingerprint(input);
  const cached = readDashboardCache<T>(namespace, scope, fingerprint, 24 * 60 * 60 * 1000);
  if (cached !== null) return cached;
  const value = calculate();
  if (shouldCache(value)) writeDashboardCache(namespace, scope, fingerprint, value);
  return value;
}
