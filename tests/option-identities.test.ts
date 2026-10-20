import { expect, it } from 'vitest';
import { buildOptionIdentityIndex, optionId, executionId } from '../src/brokers/option-identities.js';
import { mergeOptionExecutions } from '../src/brokers/option-executions.js';
import { tradesFixture, optionFill } from './helpers/trades-fixture.js';

it('backfills deterministically without changing evidence, money or books; a second run is identical', () => {
  const state = tradesFixture(), before = structuredClone(state);
  const index = buildOptionIdentityIndex(state);
  expect(state).toEqual(before);
  expect(Object.keys(index.options)).toHaveLength(1);
  expect(Object.keys(index.executions)).toHaveLength(2);
  const ids = Object.values(index.executions).map(e => e.id);
  expect(new Set(ids).size).toBe(2);
  expect(Object.values(index.options)[0]).toMatch(/^[a-f\d]{8}-[a-f\d]{4}-8[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/);
  state.option_identities = index;
  expect(buildOptionIdentityIndex(state)).toEqual(index);
  expect(executionId(state,state.option_executions![0])).toBe(executionId(before,before.option_executions![0]));
  state.option_executions = mergeOptionExecutions(state.option_executions!,state.option_executions!);
  expect(buildOptionIdentityIndex(state)).toEqual(index);
  state.option_executions = []; state.portfolio = {};
  expect(buildOptionIdentityIndex(state)).toEqual(index);
});

it('normalizes decimal/OCC representations and keeps users, accounts, currencies and terms separate', () => {
  const s = tradesFixture(), fill = optionFill(), id = optionId(s,fill);
  expect(optionId(s,{...fill,strike:'0150.000',multiplier:'0100.00',underlying:'AAPL270115P00150000'})).toBe(id);
  for (const patch of [{channel:'tiger'},{account_id:'U2'},{currency:'HKD'},{strike:'151'},{multiplier:'10'},{expiry:'2027-02-19'}]) expect(optionId(s,{...fill,...patch})).not.toBe(id);
  expect(optionId({...s,user:{...s.user,id:'another-owner'}},fill)).not.toBe(id);
  for (const channel of ['ibkr','moomoo','tiger','webull','manual']) expect(executionId(s,{...fill,channel})).not.toBe(optionId(s,{...fill,channel}));
});

it('keeps execution IDs stable when fees settle or earlier records arrive and distinguishes reopened fills', () => {
  const s = tradesFixture(), fill = optionFill();
  const index = buildOptionIdentityIndex(s); s.option_identities = index;
  expect(executionId(s,{...fill,commission:null})).toBe(executionId(s,fill));
  s.option_executions!.push(optionFill({execution_id:'older',executed_at:'2026-01-01T10:00:00'}));
  const next = buildOptionIdentityIndex(s);
  for (const [key,id] of Object.entries(index.options)) expect(next.options[key]).toBe(id);
  for (const [key,id] of Object.entries(index.executions)) expect(next.executions[key]).toEqual(id);
  expect(executionId(s,{...fill,execution_id:'reopened'})).not.toBe(executionId(s,fill));
});

it('rejects corrupt identity indexes and conflicting native execution evidence', () => {
  const s = tradesFixture(); s.option_identities = buildOptionIdentityIndex(s);
  const keys = Object.keys(s.option_identities.executions);
  s.option_identities.executions[keys[1]].id = s.option_identities.executions[keys[0]].id;
  expect(() => buildOptionIdentityIndex(s)).toThrow(/duplicate/);
  delete s.option_identities;
  s.option_executions!.push(optionFill({gross_premium:'1'}));
  expect(() => buildOptionIdentityIndex(s)).toThrow(/conflict/i);
});
