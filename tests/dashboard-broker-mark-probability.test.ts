import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const calculate = runInNewContext(readFileSync('webui/option-probability.js', 'utf8') + '; OptionProbability.brokerMarkItmProbability');
const contract = (right: 'put' | 'call', mark: number, multiplier = 100) => ({
  brokerMark: mark * multiplier,
  option: { right, strike: 100, multiplier },
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

it('uses broker marks rather than newer chain quotes or cost fallback, with multiplier-correct units', () => {
  const position = { ...contract('call', 9.925053717274437), price: 1,
    probabilityQuote: { mark: 1, spot: 150, spotAsOf: '2020-01-01' } };
  expect(calculate(position, 100, 365).iv).toBeCloseTo(0.2, 5);
  expect(calculate(contract('call', 9.925053717274437, 10), 100, 365).iv).toBeCloseTo(0.2, 5);
  expect(calculate({ option: { right:'call', strike:100, multiplier:100 }, price:992.5, pricingMode:'cost' }, 100,365).probability).toBeNull();
});

it('leaves missing quotes, invalid contracts and arbitrage-inconsistent broker marks unscored', () => {
  expect(calculate(contract('put', 6), undefined, 10).probability).toBeNull();
  expect(calculate(contract('put', 6), 100, null).probability).toBeNull();
  expect(calculate(contract('put', 6), Infinity, 10).probability).toBeNull();
  expect(calculate(contract('put', 0), 100, 10).probability).toBeNull();
  for (const multiplier of [0, -1, Infinity]) {
    expect(calculate({brokerMark:600,option:{right:'put',strike:100,multiplier}},100,365).probability).toBeNull();
  }
  expect(calculate(contract('put', 0.01), 50, 365).probability).toBeNull();
  expect(calculate(contract('call', 100), 100,365).probability).toBeNull();
});

it('returns the known expiry result without claiming early-assignment probability', () => {
  expect(calculate(contract('put', 1), 99,0)).toMatchObject({probability:1,iv:null});
  expect(calculate(contract('call', 1), 99,0)).toMatchObject({probability:0,iv:null});
});
