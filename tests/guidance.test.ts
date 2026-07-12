import { describe, it, expect } from 'vitest';
import { renderGuidance } from '../src/guidance.js';

describe('renderGuidance', () => {
  it('returns overview for empty args', () => {
    const text = renderGuidance('');
    expect(text).toContain('Invester');
    expect(text).toContain('/guidance');
    expect(text).toContain('portfolio');
  });

  it('returns portfolio topic', () => {
    const text = renderGuidance('portfolio');
    expect(text).toMatch(/Portfolio/i);
    expect(text).toMatch(/AAPL|holdings|avg cost/i);
  });

  it('aliases research keywords to firecrawl guidance', () => {
    const text = renderGuidance('firecrawl');
    expect(text).toMatch(/Firecrawl|web research/i);
    expect(text).toMatch(/SEC|Yahoo|search/i);
  });

  it('returns analysis subcommand', () => {
    const text = renderGuidance('analysis');
    expect(text).toMatch(/3-axis|Laggard|Buy opportunities/i);
    expect(text).toMatch(/investment-analysis/i);
    expect(text).toMatch(/Stock evaluation|valuation/i);
  });

  it('lists investment-analysis in skills catalog', () => {
    const text = renderGuidance('skills');
    expect(text).toMatch(/investment-analysis/i);
    expect(text).not.toMatch(/financial-analysis/i);
  });

  it('unknown topic falls back with hint', () => {
    const text = renderGuidance('spaceships');
    expect(text).toMatch(/Unknown topic/);
    expect(text).toContain('Topics');
  });
});
