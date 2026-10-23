import { describe, expect, it } from 'vitest';
import { reconcileExecutionEffects } from '../src/brokers/execution-effects.js';
import { mergeOptionExecutions } from '../src/brokers/option-executions.js';
import { mergeBrokerHistory, optionExecutionsFromHistory, type BrokerHistory } from '../src/brokers/history.js';
import type { OptionObservation } from '../src/brokers/option-history.js';
const scope = { broker_id: 'tiger', channel: 'tiger', account_id: 'A' };
function history(): BrokerHistory {
  return { ...scope, executions: [
    { ...scope, id: 'buy-old', order_id: 'roll', native_symbol: 'OLD', symbol: 'NVDA', instrument: 'option', side: 'buy', effect: 'unknown',
      executed_at: '2026-10-06T09:40:50', clock: 'America/New_York', currency: 'USD', quantity: '1', price: '15.85', multiplier: '100', gross_cash: '-1585', fee_cash: null,
      option: { right: 'call', expiry: '2026-11-20', strike: '235' } },
    { ...scope, id: 'sell-new', order_id: 'roll', native_symbol: 'NEW', symbol: 'NVDA', instrument: 'option', side: 'sell', effect: 'unknown',
      executed_at: '2026-10-06T09:40:50', clock: 'America/New_York', currency: 'USD', quantity: '1', price: '16.65', multiplier: '100', gross_cash: '1665', fee_cash: null,
      option: { right: 'call', expiry: '2027-01-15', strike: '245' } },
  ], orders: [], sync: { version: 1, mode: 'full', from: '2026-10-01T00:00:00Z', through: '2026-10-09T00:00:00Z', status: 'complete', full_history_synced: true, fees: 'unavailable', gaps: [] } };
}
function anchor(at: string, which: 'old' | 'new', units = 1): OptionObservation {
  return { ...scope, id: at, connection_id: 'conn', observed_at: at, as_of: at.slice(0,10), source: 'broker', complete: true, skipped_positions: 0,
    options: [{ key: which, underlying: 'NVDA', right: 'call', side: 'short', strike: which === 'old' ? 235 : 245,
      expiry: which === 'old' ? '2026-11-20' : '2027-01-15', multiplier: 100, settlement: 'physical', units, avg_price: 1, mark: 1, currency: 'USD' }] };
}
const anchors = () => [anchor('2026-10-01T12:00:00Z','old'), anchor('2026-10-08T12:00:00Z','new')];
describe('evidence-based execution effects', () => {
  it('proves both roll legs from reconciled broker positions, without mutating evidence', () => {
    const h = history(), before = structuredClone(h);
    expect(reconcileExecutionEffects(h, anchors()).executions.map(e => e.effect)).toEqual(['close','open']);
    expect(h).toEqual(before);
  });
  it('classifies a crossing fill as mixed, without rewriting its money', () => {
    const h = history(); h.executions = [h.executions[0]];
    Object.assign(h.executions[0], { quantity: '2', gross_cash: '-3170' });
    const a = anchors(); a[1].options = [{...a[0].options[0], side:'long'}];
    expect(reconcileExecutionEffects(h,a).executions[0]).toMatchObject({ effect:'mixed', quantity:'2',gross_cash:'-3170' });
  });
  it.each(['single anchor','mismatched balance','coverage gap','skipped positions','other account','prior books','out of coverage','lifecycle delivery'])('does not fabricate effects with %s', reason => {
    const h = history(), a = anchors();
    if (reason === 'single anchor') a.pop();
    if (reason === 'mismatched balance') { a[0].options[0].units=2; a[1].options[0].units=2; }
    if (reason === 'coverage gap') h.sync.gaps.push({kind:'coverage',reference:null,reason:'Transaction page missing'});
    if (reason === 'skipped positions') a[0].skipped_positions=1;
    if (reason === 'other account') a[0].account_id='B';
    if (reason === 'prior books') a[0].source='prior_books';
    if (reason === 'out of coverage') h.sync.from='2026-10-02T00:00:00Z';
    if (reason === 'lifecycle delivery') h.sync.gaps.push({kind:'coverage',reference:'roll',reason:'Lifecycle delivery retained in raw evidence'});
    expect(reconcileExecutionEffects(h,a).executions.map(e=>e.effect)).toEqual(['unknown','unknown']);
  });
  it('rejects an explicit classification contradicted by the position proof', () => {
    const h=history(); h.executions[0].effect='open';
    expect(()=>reconcileExecutionEffects(h,anchors())).toThrow(/Conflicting execution effects/);
  });
  it('enriches both history and option projections in either direction, retaining money conflict checks', () => {
    const h=history(), resolved=reconcileExecutionEffects(h,anchors());
    for (const [a,b] of [[h,resolved],[resolved,h]]) {
      expect(mergeBrokerHistory(a,b).executions.map(e=>e.effect)).toEqual(['close','open']);
      expect(mergeOptionExecutions(optionExecutionsFromHistory(a),optionExecutionsFromHistory(b)).every(e=>e.effect!=='unknown')).toBe(true);
    }
    const bad=structuredClone(resolved); bad.executions[0].gross_cash='-999';
    expect(()=>mergeBrokerHistory(resolved,bad)).toThrow(/Conflicting/);
    expect(()=>mergeOptionExecutions(optionExecutionsFromHistory(resolved),optionExecutionsFromHistory(bad))).toThrow(/conflict/i);
  });
});
