/**
 * Portfolio snapshot types and BinDrive loaders.
 *
 * Snapshots live under data/drive/<slug>/ as:
 *   snapshots.json              — index of snapshot-*.json filenames
 *   snapshot-YYYY-MM-DD.json    — one point-in-time portfolio valuation
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot } from 'utarus';

export interface SnapshotPosition {
  ticker: string;
  avgCost: number;
  units: number;
  price: number;
  cost: number;
  value: number;
  pl: number;
  plPct: number;
  /** equity (default) or option — older snapshots omit this. */
  instrument?: 'equity' | 'option';
  label?: string;
  premiumAbsolute?: number;
  contingentCashObligation?: number;
  contingentShareObligation?: number;
  option?: {
    right: 'call' | 'put';
    side: 'long' | 'short';
    strike: number;
    expiry: string;
    multiplier: number;
    underlying: string;
    settlement: 'physical' | 'cash';
    mark: number;
    underlying_mark?: number;
  };
}

export interface Snapshot {
  date: string;
  totalValue: number;
  totalCost: number;
  totalPL: number;
  totalPLPct: number;
  positions: SnapshotPosition[];
  /** Optional aggregates (newer snapshots). */
  contingentCashObligation?: number;
  optionsPremiumCollected?: number;
  optionsPremiumPaid?: number;
  equityValue?: number;
  equityCost?: number;
}

function driveDir(slug: string): string {
  return join(resolveDataRoot(), 'drive', slug);
}

function assertSnapshot(raw: unknown, filePath: string): Snapshot {
  if (raw == null || typeof raw !== 'object') {
    throw new Error(`Invalid snapshot JSON (not an object): ${filePath}`);
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.date !== 'string' || s.date.length === 0) {
    throw new Error(`Invalid snapshot: missing date in ${filePath}`);
  }
  for (const key of ['totalValue', 'totalCost', 'totalPL', 'totalPLPct'] as const) {
    if (typeof s[key] !== 'number' || Number.isNaN(s[key] as number)) {
      throw new Error(`Invalid snapshot: missing or non-numeric ${key} in ${filePath}`);
    }
  }
  if (!Array.isArray(s.positions)) {
    throw new Error(`Invalid snapshot: positions must be an array in ${filePath}`);
  }
  return raw as Snapshot;
}

/** Returns snapshot filenames from the index, or [] if no index exists. */
export function loadSnapshotIndex(slug: string): string[] {
  const indexPath = join(driveDir(slug), 'snapshots.json');
  if (!existsSync(indexPath)) return [];
  const raw: unknown = JSON.parse(readFileSync(indexPath, 'utf-8'));
  if (!Array.isArray(raw)) {
    throw new Error(`Invalid snapshots index (not an array): ${indexPath}`);
  }
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new Error(`Invalid snapshots index entry (not a string): ${indexPath}`);
    }
  }
  return raw as string[];
}

/**
 * Load all snapshots for a user, ordered by date ascending.
 * Missing index → []. Listed file missing or corrupt → throws.
 */
export function loadSnapshots(slug: string): Snapshot[] {
  const files = loadSnapshotIndex(slug);
  if (files.length === 0) return [];

  const dir = driveDir(slug);
  const snapshots: Snapshot[] = files.map((fileName) => {
    const filePath = join(dir, fileName);
    if (!existsSync(filePath)) {
      throw new Error(`Snapshot listed in index but file missing: ${filePath}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Corrupt snapshot JSON at ${filePath}: ${msg}`);
    }
    return assertSnapshot(parsed, filePath);
  });

  snapshots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return snapshots;
}
