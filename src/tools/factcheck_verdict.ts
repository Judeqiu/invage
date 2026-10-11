/**
 * submit_factcheck_verdict — typed Factchecker audit result.
 * Fail-fast validation matrix (no silent defaults on omitted fields).
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

const STATUSES = ['PASS', 'FAIL', 'PASS_WITH_CAVEATS'] as const;
type VerdictStatus = (typeof STATUSES)[number];

const TRUST_CLASSES = ['A', 'B', 'C', 'D', 'E'] as const;
const SEVERITIES = ['blocker', 'material', 'minor'] as const;

export type FactcheckFinding = {
  claim: string;
  found: string;
  severity: (typeof SEVERITIES)[number];
  trust_class: (typeof TRUST_CLASSES)[number];
};

export type FactcheckRedo = {
  target: string;
  task: string;
  reason: string;
};

export type FactcheckVerdictInput = {
  status: VerdictStatus;
  claims_checked: number;
  claims_failed: number;
  findings: FactcheckFinding[];
  redo: FactcheckRedo | null;
  caveats: string[];
  user_safe_summary: string;
  redo_count_seen: number;
};

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && Number.isFinite(v);
}

/**
 * Validate verdict args. Throws with a clear message on any matrix violation.
 * Exported for unit tests.
 */
export function validateFactcheckVerdict(raw: unknown): FactcheckVerdictInput {
  if (!isPlainObject(raw)) {
    throw new Error('submit_factcheck_verdict: args must be an object');
  }

  const status = raw.status;
  if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) {
    throw new Error(
      `submit_factcheck_verdict: status must be one of ${STATUSES.join(' | ')} (got ${JSON.stringify(status)})`,
    );
  }

  if (!('claims_checked' in raw)) {
    throw new Error('submit_factcheck_verdict: claims_checked is required (omit not allowed)');
  }
  if (!isNonNegInt(raw.claims_checked)) {
    throw new Error('submit_factcheck_verdict: claims_checked must be an integer ≥ 0');
  }

  if (!('claims_failed' in raw)) {
    throw new Error('submit_factcheck_verdict: claims_failed is required (omit not allowed)');
  }
  if (!isNonNegInt(raw.claims_failed)) {
    throw new Error('submit_factcheck_verdict: claims_failed must be an integer ≥ 0');
  }

  if (!('findings' in raw)) {
    throw new Error('submit_factcheck_verdict: findings is required (pass [] if none)');
  }
  if (!Array.isArray(raw.findings)) {
    throw new Error('submit_factcheck_verdict: findings must be an array');
  }

  const findings: FactcheckFinding[] = [];
  for (let i = 0; i < raw.findings.length; i++) {
    const f = raw.findings[i];
    if (!isPlainObject(f)) {
      throw new Error(`submit_factcheck_verdict: findings[${i}] must be an object`);
    }
    if (!isNonEmptyString(f.claim)) {
      throw new Error(`submit_factcheck_verdict: findings[${i}].claim must be a non-empty string`);
    }
    if (!isNonEmptyString(f.found)) {
      throw new Error(`submit_factcheck_verdict: findings[${i}].found must be a non-empty string`);
    }
    if (typeof f.severity !== 'string' || !(SEVERITIES as readonly string[]).includes(f.severity)) {
      throw new Error(
        `submit_factcheck_verdict: findings[${i}].severity must be one of ${SEVERITIES.join(' | ')}`,
      );
    }
    if (
      typeof f.trust_class !== 'string' ||
      !(TRUST_CLASSES as readonly string[]).includes(f.trust_class)
    ) {
      throw new Error(
        `submit_factcheck_verdict: findings[${i}].trust_class must be one of ${TRUST_CLASSES.join(' | ')}`,
      );
    }
    findings.push({
      claim: f.claim.trim(),
      found: f.found.trim(),
      severity: f.severity as FactcheckFinding['severity'],
      trust_class: f.trust_class as FactcheckFinding['trust_class'],
    });
  }

  if (!('redo' in raw)) {
    throw new Error(
      'submit_factcheck_verdict: redo is required (pass null when no redo; omit not allowed)',
    );
  }

  let redo: FactcheckRedo | null = null;
  if (raw.redo !== null) {
    if (!isPlainObject(raw.redo)) {
      throw new Error('submit_factcheck_verdict: redo must be null or an object');
    }
    if (!isNonEmptyString(raw.redo.target)) {
      throw new Error('submit_factcheck_verdict: redo.target must be a non-empty string');
    }
    if (!isNonEmptyString(raw.redo.task)) {
      throw new Error('submit_factcheck_verdict: redo.task must be a non-empty string');
    }
    if (!isNonEmptyString(raw.redo.reason)) {
      throw new Error('submit_factcheck_verdict: redo.reason must be a non-empty string');
    }
    redo = {
      target: raw.redo.target.trim(),
      task: raw.redo.task.trim(),
      reason: raw.redo.reason.trim(),
    };
  }

  if (!('caveats' in raw)) {
    throw new Error(
      'submit_factcheck_verdict: caveats is required (pass [] when none; omit not allowed)',
    );
  }
  if (!Array.isArray(raw.caveats)) {
    throw new Error('submit_factcheck_verdict: caveats must be an array of strings');
  }
  const caveats: string[] = [];
  for (let i = 0; i < raw.caveats.length; i++) {
    const c = raw.caveats[i];
    if (typeof c !== 'string') {
      throw new Error(`submit_factcheck_verdict: caveats[${i}] must be a string`);
    }
    caveats.push(c);
  }

  if (!isNonEmptyString(raw.user_safe_summary)) {
    throw new Error('submit_factcheck_verdict: user_safe_summary must be a non-empty string');
  }

  if (!('redo_count_seen' in raw)) {
    throw new Error('submit_factcheck_verdict: redo_count_seen is required (integer ≥ 0)');
  }
  if (!isNonNegInt(raw.redo_count_seen)) {
    throw new Error('submit_factcheck_verdict: redo_count_seen must be an integer ≥ 0');
  }

  const claims_checked = raw.claims_checked;
  const claims_failed = raw.claims_failed;

  if (status === 'PASS') {
    if (claims_failed !== 0) {
      throw new Error('submit_factcheck_verdict: PASS requires claims_failed === 0');
    }
    if (redo !== null) {
      throw new Error('submit_factcheck_verdict: PASS requires redo === null');
    }
  } else if (status === 'PASS_WITH_CAVEATS') {
    if (claims_failed !== 0) {
      throw new Error('submit_factcheck_verdict: PASS_WITH_CAVEATS requires claims_failed === 0');
    }
    if (redo !== null) {
      throw new Error('submit_factcheck_verdict: PASS_WITH_CAVEATS requires redo === null');
    }
    if (caveats.length < 1) {
      throw new Error(
        'submit_factcheck_verdict: PASS_WITH_CAVEATS requires caveats.length ≥ 1 (non-empty)',
      );
    }
  } else if (status === 'FAIL') {
    if (claims_failed < 1) {
      throw new Error('submit_factcheck_verdict: FAIL requires claims_failed ≥ 1');
    }
    if (redo === null) {
      throw new Error(
        'submit_factcheck_verdict: FAIL requires non-null redo { target, task, reason }',
      );
    }
  }

  if (claims_failed > claims_checked) {
    throw new Error(
      `submit_factcheck_verdict: claims_failed (${claims_failed}) cannot exceed claims_checked (${claims_checked})`,
    );
  }

  return {
    status: status as VerdictStatus,
    claims_checked,
    claims_failed,
    findings,
    redo,
    caveats,
    user_safe_summary: raw.user_safe_summary.trim(),
    redo_count_seen: raw.redo_count_seen,
  };
}

export function createSubmitFactcheckVerdictTool(): AgentTool {
  return {
    name: 'submit_factcheck_verdict',
    label: 'Submit Factcheck Verdict',
    description:
      'Submit a typed integrity audit verdict for the host orchestrator. ' +
      'Required every Factchecker audit turn before ending. ' +
      'status: PASS | FAIL | PASS_WITH_CAVEATS. ' +
      'PASS: claims_failed=0, redo=null. ' +
      'PASS_WITH_CAVEATS: claims_failed=0, redo=null, caveats non-empty. ' +
      'FAIL: claims_failed≥1, redo={target,task,reason} required. ' +
      'Always pass redo (null when none) and caveats (array, [] when none) — omit fails. ' +
      'Source of truth for the host; optional markdown mirror is not a substitute.',
    parameters: Type.Object({
      status: Type.Union([
        Type.Literal('PASS'),
        Type.Literal('FAIL'),
        Type.Literal('PASS_WITH_CAVEATS'),
      ]),
      claims_checked: Type.Integer({ minimum: 0 }),
      claims_failed: Type.Integer({ minimum: 0 }),
      findings: Type.Array(
        Type.Object({
          claim: Type.String({ minLength: 1 }),
          found: Type.String({ minLength: 1 }),
          severity: Type.Union([
            Type.Literal('blocker'),
            Type.Literal('material'),
            Type.Literal('minor'),
          ]),
          trust_class: Type.Union([
            Type.Literal('A'),
            Type.Literal('B'),
            Type.Literal('C'),
            Type.Literal('D'),
            Type.Literal('E'),
          ]),
        }),
      ),
      redo: Type.Union([
        Type.Null(),
        Type.Object({
          target: Type.String({ minLength: 1 }),
          task: Type.String({ minLength: 1 }),
          reason: Type.String({ minLength: 1 }),
        }),
      ]),
      caveats: Type.Array(Type.String()),
      user_safe_summary: Type.String({ minLength: 1 }),
      redo_count_seen: Type.Integer({ minimum: 0 }),
    }),
    async execute(_toolCallId, args) {
      try {
        const verdict = validateFactcheckVerdict(args);
        const redoLine =
          verdict.redo == null
            ? 'redo: none'
            : `redo → ${verdict.redo.target}: ${verdict.redo.reason}`;
        const text =
          `Factcheck ${verdict.status}: checked=${verdict.claims_checked} failed=${verdict.claims_failed}; ` +
          `${redoLine}; caveats=${verdict.caveats.length}. ${verdict.user_safe_summary}`;
        return ok(text, verdict);
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
