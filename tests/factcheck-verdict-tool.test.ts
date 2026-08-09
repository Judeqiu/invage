import { describe, expect, it } from 'vitest';
import {
  createSubmitFactcheckVerdictTool,
  validateFactcheckVerdict,
} from '../src/tools/factcheck_verdict.js';

const baseFinding = {
  claim: 'Free cash SGD = 10000',
  found: 'get_portfolio free cash SGD = 10000',
  severity: 'material' as const,
  trust_class: 'A' as const,
};

describe('validateFactcheckVerdict matrix', () => {
  it('accepts PASS with claims_failed=0 and redo null', () => {
    const v = validateFactcheckVerdict({
      status: 'PASS',
      claims_checked: 2,
      claims_failed: 0,
      findings: [baseFinding],
      redo: null,
      caveats: [],
      user_safe_summary: 'All checked claims match tools.',
      redo_count_seen: 0,
    });
    expect(v.status).toBe('PASS');
    expect(v.claims_failed).toBe(0);
    expect(v.redo).toBeNull();
  });

  it('accepts PASS_WITH_CAVEATS with non-empty caveats', () => {
    const v = validateFactcheckVerdict({
      status: 'PASS_WITH_CAVEATS',
      claims_checked: 1,
      claims_failed: 0,
      findings: [],
      redo: null,
      caveats: ['Mark drifted 0.3% within 0.5% band'],
      user_safe_summary: 'Pass with minor market drift.',
      redo_count_seen: 0,
    });
    expect(v.status).toBe('PASS_WITH_CAVEATS');
    expect(v.caveats.length).toBe(1);
  });

  it('accepts FAIL with claims_failed≥1 and redo object', () => {
    const v = validateFactcheckVerdict({
      status: 'FAIL',
      claims_checked: 2,
      claims_failed: 1,
      findings: [
        {
          claim: 'Debt free in 12 months',
          found: 'build_payment_plan months_to_free=24',
          severity: 'blocker',
          trust_class: 'A',
        },
      ],
      redo: {
        target: 'financial-planner',
        task: 'Re-run build_payment_plan; do not invent months_to_free',
        reason: 'months_to_free mismatch',
      },
      caveats: [],
      user_safe_summary: 'Payment plan months do not match tool output.',
      redo_count_seen: 0,
    });
    expect(v.status).toBe('FAIL');
    expect(v.redo?.target).toBe('financial-planner');
  });

  it('rejects PASS with claims_failed > 0', () => {
    expect(() =>
      validateFactcheckVerdict({
        status: 'PASS',
        claims_checked: 1,
        claims_failed: 1,
        findings: [baseFinding],
        redo: null,
        caveats: [],
        user_safe_summary: 'bad',
        redo_count_seen: 0,
      }),
    ).toThrow(/PASS requires claims_failed/);
  });

  it('rejects PASS_WITH_CAVEATS with empty caveats', () => {
    expect(() =>
      validateFactcheckVerdict({
        status: 'PASS_WITH_CAVEATS',
        claims_checked: 1,
        claims_failed: 0,
        findings: [],
        redo: null,
        caveats: [],
        user_safe_summary: 'bad',
        redo_count_seen: 0,
      }),
    ).toThrow(/caveats/);
  });

  it('rejects FAIL without redo', () => {
    expect(() =>
      validateFactcheckVerdict({
        status: 'FAIL',
        claims_checked: 1,
        claims_failed: 1,
        findings: [baseFinding],
        redo: null,
        caveats: [],
        user_safe_summary: 'bad',
        redo_count_seen: 0,
      }),
    ).toThrow(/FAIL requires non-null redo/);
  });

  it('rejects omitted caveats key', () => {
    expect(() =>
      validateFactcheckVerdict({
        status: 'PASS',
        claims_checked: 0,
        claims_failed: 0,
        findings: [],
        redo: null,
        user_safe_summary: 'ok',
        redo_count_seen: 0,
      }),
    ).toThrow(/caveats is required/);
  });

  it('rejects omitted redo key', () => {
    expect(() =>
      validateFactcheckVerdict({
        status: 'PASS',
        claims_checked: 0,
        claims_failed: 0,
        findings: [],
        caveats: [],
        user_safe_summary: 'ok',
        redo_count_seen: 0,
      }),
    ).toThrow(/redo is required/);
  });
});

describe('createSubmitFactcheckVerdictTool', () => {
  it('returns details on valid PASS', async () => {
    const tool = createSubmitFactcheckVerdictTool();
    expect(tool.name).toBe('submit_factcheck_verdict');
    const result = await tool.execute('t1', {
      status: 'PASS',
      claims_checked: 1,
      claims_failed: 0,
      findings: [baseFinding],
      redo: null,
      caveats: [],
      user_safe_summary: 'OK',
      redo_count_seen: 0,
    });
    expect(result.details).toMatchObject({ status: 'PASS', claims_failed: 0 });
    expect(result.content[0]?.type).toBe('text');
  });

  it('returns fail text on invalid matrix', async () => {
    const tool = createSubmitFactcheckVerdictTool();
    const result = await tool.execute('t2', {
      status: 'FAIL',
      claims_checked: 1,
      claims_failed: 0,
      findings: [],
      redo: null,
      caveats: [],
      user_safe_summary: 'bad',
      redo_count_seen: 0,
    });
    expect(result.details).toBeNull();
    expect(result.content[0]?.type).toBe('text');
    if (result.content[0]?.type === 'text') {
      expect(result.content[0].text).toMatch(/FAIL requires claims_failed/);
    }
  });
});
