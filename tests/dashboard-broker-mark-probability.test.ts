import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const calculate = runInNewContext(readFileSync('webui/option-probability.js', 'utf8') + '; OptionProbability.currentSpotItmProbability');
const contract = (right: 'put' | 'call', mark: number, multiplier = 100) => ({
  brokerMark: mark * multiplier,
  option: { right, strike: 100, multiplier, expiry: '2027-10-29' },
  probabilityQuote: { mark: mark * multiplier, spot: 100,
    optionAsOf: '2026-10-29T19:59:00Z', spotAsOf: '2026-10-29T20:00:00Z' },
});

it('recovers known Black–Scholes IV and probability with r=4%, q=0 and DTE/365', () => {
  // Independent analytic values at S=K=100, sigma=20%, T=1 and r=4%.
  for (const [right, mark, probability] of [
    ['call', 9.925053717274437, 0.539827837277029],
    ['put', 6.003997632506753, 0.460172162722971],
  ] as const) {
    const result = calculate(contract(right, mark), 100, 365);
    expect(result.iv).toBeCloseTo(0.2, 5);
    expect(result.probability).toBeCloseTo(probability, 5);
  }
});

it('uses paired prices for IV, without changing or using broker valuation marks', () => {
  const position = { ...contract('call', 9.925053717274437), brokerMark: 1, price: 1 };
  const original = structuredClone(position);
  expect(calculate(position, 100, 365).iv).toBeCloseTo(0.2, 5);
  expect(position).toEqual(original);
  expect(calculate(contract('call', 9.925053717274437, 10), 100, 365).iv).toBeCloseTo(0.2, 5);
  expect(calculate({ option: { right:'call', strike:100, multiplier:100 }, brokerMark:992.5 }, 100,365).probability).toBeNull();
});

it('reproduces the INTC $75 December put after hours with the existing Act now threshold', () => {
  const position = { brokerMark: 136.5,
    option: { right: 'put', strike: 75, multiplier: 100, expiry: '2026-12-18' },
    probabilityQuote: { mark:155, spot:92.07, optionAsOf:'2026-10-29T19:59:02Z', spotAsOf:'2026-10-29T20:00:01Z' } };
  const regular = calculate(position,92.07,50), afterHours = calculate(position,70.3415,50);
  expect(afterHours.iv).toBeCloseTo(0.5824372561, 7);
  expect(afterHours.iv).toBe(regular.iv);
  expect(afterHours.probability).toBeCloseTo(0.6479676172, 7);
  expect(afterHours.probability).toBeGreaterThan(.6);
  expect(regular.probability).toBeLessThan(.3);
});

it('uses current DTE while holding calibration IV, for calls and puts in any session', () => {
  for (const right of ['call','put'] as const) {
    const p=contract(right,right==='put'?6.003997632506753:9.925053717274437);
    const base=calculate(p,100,365), moved=calculate(p,right==='put'?90:110,364);
    expect(moved.iv).toBe(base.iv);
    expect(moved.probability).toBeGreaterThan(base.probability);
  }
});

it('leaves invalid evidence unscored without manufacturing a percentage', () => {
  expect(calculate(contract('put', 6), undefined, 10).probability).toBeNull();
  expect(calculate(contract('put', 6), 100, null).probability).toBeNull();
  expect(calculate(contract('put', 6), Infinity, 10).probability).toBeNull();
  expect(calculate(contract('put', 0), 100, 10).probability).toBeNull();
  for (const multiplier of [0, -1, Infinity]) {
    expect(calculate({...contract('put',6),option:{right:'put',strike:100,multiplier}},100,365).probability).toBeNull();
  }
  const p=contract('put',.01);p.probabilityQuote.spot=50;
  expect(calculate(p,50,365).probability).toBeNull();
  p.probabilityQuote.optionAsOf='2026-10-29T19:00:00Z';
  expect(calculate(p,50,365).probability).toBeNull();
});

it('returns the known expiry result without claiming early-assignment probability', () => {
  expect(calculate(contract('put',1),99,0)).toMatchObject({probability:1,iv:null});
  expect(calculate(contract('call',1),99,0)).toMatchObject({probability:0,iv:null});
});

it('keeps existing scored thresholds and assigns missing evidence to Caution', () => {
  const level=runInNewContext(readFileSync('webui/option-probability.js','utf8')+'; OptionProbability.riskLevel');
  expect(level(null)).toBe('warning');
  expect(level(.44999)).toBe('ok');
  expect(level(.45)).toBe('warning');
  expect(level(.6)).toBe('warning');
  expect(level(.60001)).toBe('danger');
});

it('uses same-contract Yahoo IV for the actual INTC contracts without matched prices', () => {
  for(const [strike,expiry,iv,days,expected] of [
    [67.5,'2027-01-15',.5512740185546876,77,.4601727940254284],
    [85,'2027-03-19',.5356491748046875,140,.7476134152097487],
  ] as const){
    const p={option:{strike,expiry,right:'put',multiplier:100},brokerMark:119,
      providerIv:{source:'yahoo',iv,fetchedAt:'2026-10-30T01:00:00Z',asOf:null,optionAsOf:'2026-10-29T19:37:15Z'}};
    const before=structuredClone(p),result=calculate(p,70.8854,days);
    expect(result.probability).toBeCloseTo(expected,8);
    expect(result).toMatchObject({iv,ivSource:'yahoo',ivAsOf:null,ivFetchedAt:p.providerIv.fetchedAt});
    expect(p).toEqual(before);
  }
});
it('prefers matched IV and uses provider IV when a matched price fails calibration', () => {
  const p={...contract('put',6.003997632506753),providerIv:{source:'yahoo',iv:.55,fetchedAt:'2026-10-30T01:00:00Z',asOf:null}};
  expect(calculate(p,90,364)).toMatchObject({ivSource:'matched_prices'});
  expect(calculate(p,90,364).iv).toBeCloseTo(.2,5);
  p.probabilityQuote.mark=100000;
  expect(calculate(p,90,364)).toMatchObject({iv:.55,ivSource:'yahoo'});
});
it('keeps invalid or missing provider IV under Caution without an invented probability', () => {
  for(const iv of [undefined,NaN,Infinity,0,-1]){
    const p={option:{right:'put',strike:75,multiplier:100,expiry:'2026-12-18'},providerIv:{source:'yahoo',iv,fetchedAt:'2026-10-30T01:00:00Z'}};
    expect(calculate(p,70.8854,49).probability).toBeNull();
  }
});
