import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ENGINE_VERSION, type RiskAnalysis, type RiskInputs } from './types.js';
import { riskConfigured, riskEnabled } from './context.js';
import { RiskRepository } from './repository.js';

export const riskRepository = new RiskRepository();
export async function runRiskWorker(inputs: RiskInputs): Promise<Omit<RiskAnalysis, 'id'>> {
  const binary = process.env.INVAGE_OPTION_RISK_PYTHON;
  if (!binary) throw new Error('Risk worker unavailable');
  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(binary, [fileURLToPath(new URL('../../services/options-risk/engine.py', import.meta.url))], {
      // No inherited broker/API credentials reach the numerical worker.
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8', PYTHONNOUSERSITE: '1' }, stdio: ['pipe', 'pipe', 'ignore'],
    });
    let output = '', size = 0, settled = false;
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true; clearTimeout(deadline);
      if (error) { child.kill('SIGKILL'); reject(error); } else resolve(value!);
    };
    const deadline = setTimeout(() => finish(new Error('Risk worker deadline exceeded')), 60_000);
    child.on('error', () => finish(new Error('Risk worker unavailable')));
    child.stdin.on('error', () => finish(new Error('Risk worker input failed')));
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) return finish(new Error('Risk worker output limit exceeded'));
      output += chunk.toString();
    });
    child.on('close', code => {
      try {
        if (code !== 0) throw new Error('Risk worker failed');
        const parsed = JSON.parse(output);
        validateWorkerOutput(parsed);
        finish(undefined, parsed);
      } catch { finish(new Error('Invalid risk worker output')); }
    });
    child.stdin.end(JSON.stringify(inputs));
  });
  return { ...(result as unknown as RiskAnalysis), analysisContextId: inputs.analysisContextId,
    portfolioRevision: inputs.portfolioRevision, generatedAt: new Date().toISOString(),
    marketAsOf: inputs.marketAsOf, marketSnapshotId: inputs.marketSnapshotId, metadataVersion: inputs.metadataVersion,
    coverage: (result.coverage as RiskInputs['coverage'] | undefined) ?? inputs.coverage,
    model: { id: 'quantlib-fd-cash-dividend', version: ENGINE_VERSION, measure: 'conditional' } };
}
export function validateWorkerOutput(r: any): void {
  const finiteTree = (v: unknown): boolean => typeof v === 'number' ? Number.isFinite(v) :
    Array.isArray(v) ? v.every(finiteTree) : v && typeof v === 'object' ? Object.values(v).every(finiteTree) : true;
  if (!r || !['ready', 'partial', 'unavailable'].includes(r.status) || !r.capabilities ||
      typeof r.capabilities.stress !== 'boolean' || typeof r.capabilities.greeks !== 'boolean' ||
      r.capabilities.forecast !== false || r.capabilities.actions !== false ||
      !r.scope || !Array.isArray(r.scope.accountIds) || !Array.isArray(r.scope.currencies) || ![1,5,21].includes(r.scope.horizonTradingDays) ||
      !r.metrics || ['stressLoss', 'dollarDelta', 'expectedShortfall'].some(k => !r.metrics[k] ||
        !(r.metrics[k].value === null || typeof r.metrics[k].value === 'number') || typeof r.metrics[k].unit !== 'string') ||
      r.metrics.expectedShortfall.value !== null || !Array.isArray(r.scenarios) || !Array.isArray(r.contributors) || !Array.isArray(r.funding) ||
      !Array.isArray(r.payoffBounds) || !Array.isArray(r.actions) || r.actions.length || !Array.isArray(r.assumptions) || !r.assumptions.every((x: unknown) => typeof x === 'string') || !finiteTree(r)) throw new Error('Malformed worker result');
  if (!r.coverage || ![r.coverage.totalContracts, r.coverage.supportedContracts, r.coverage.totalQuantity, r.coverage.supportedQuantity].every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0) || !Array.isArray(r.coverage.exclusions)) throw new Error('Malformed coverage');
  for (const f of r.funding) if (typeof f.accountId !== 'string' || typeof f.currency !== 'string' || !Array.isArray(f.delivery) ||
    ![f.grossPutFunding, f.callShares, f.availableShares].every(x => typeof x === 'number') || !(f.cash === null || typeof f.cash === 'number') ||
    !(f.fundingGap === null || typeof f.fundingGap === 'number')) throw new Error('Malformed funding');
  for (const b of r.payoffBounds) if (typeof b.accountId !== 'string' || typeof b.currency !== 'string' || typeof b.underlying !== 'string' ||
    typeof b.expiryAt !== 'string' || typeof b.unlimitedLoss !== 'boolean' || typeof b.unlimitedGain !== 'boolean' ||
    !(b.minPnl === null || typeof b.minPnl === 'number') || !(b.maxPnl === null || typeof b.maxPnl === 'number')) throw new Error('Malformed payoff bound');
  for (const s of r.scenarios) if (typeof s.id !== 'string' || ![s.spotShock, s.volatilityPointShock].every(x => typeof x === 'number') ||
    !Array.isArray(s.byCurrency) || s.byCurrency.some((v: any) => typeof v.currency !== 'string' || ![v.optionPnl, v.combinedPnl].every(x => typeof x === 'number'))) throw new Error('Malformed scenario');
  for (const c of r.contributors) if (typeof c.id !== 'string' || typeof c.accountId !== 'string' || typeof c.currency !== 'string' ||
    ![c.dollarDelta, c.vega, c.theta].every(x => typeof x === 'number')) throw new Error('Malformed contributor');
}
let active = false;
export async function drainRiskQueue(): Promise<void> {
  if (active || !riskConfigured()) return;
  active = true;
  try {
    await riskRepository.pruneExpired();
    if (!riskEnabled()) { await riskRepository.cancelQueued(); return; }
    const job = await riskRepository.claim();
    if (!job) return;
    const heartbeat = setInterval(() => { void riskRepository.heartbeat(job.id, job.token).catch(() => {}); }, 5000);
    try {
      const result = { ...await runRiskWorker(job.inputs), id: job.id };
      await riskRepository.finish(job.id, job.token, result);
    } catch { await riskRepository.finish(job.id, job.token, null); }
    finally { clearInterval(heartbeat); }
  } catch { /* A missing migration/database does not interrupt the legacy dashboard. */ }
  finally { active = false; }
}
let queueTimer: ReturnType<typeof setInterval> | undefined;
export function startRiskQueue(): () => void {
  if (queueTimer) return () => {};
  const timer = queueTimer = setInterval(() => { void drainRiskQueue(); }, 2000);
  timer.unref();
  return () => { clearInterval(timer); queueTimer = undefined; };
}
