import { describe, it, expect } from 'vitest';
import { renderGuidance, createGuidanceCommand } from '../src/guidance.js';

describe('renderGuidance', () => {
  it('returns overview for empty args', () => {
    const text = renderGuidance('');
    expect(text).toContain('Invester');
    expect(text).toContain('/guidance');
    expect(text).toContain('portfolio');
    expect(text).toMatch(/value|undervalued|advanced/i);
  });

  it('returns portfolio topic', () => {
    const text = renderGuidance('portfolio');
    expect(text).toMatch(/Portfolio/i);
    expect(text).toMatch(/AAPL|holdings|avg cost/i);
    expect(text).toMatch(/guidance value/i);
  });

  it('returns playbook topic and aliases', () => {
    const text = renderGuidance('playbook');
    expect(text).toMatch(/Investment Playbook|methodology/i);
    expect(text).toMatch(/value_investing|conservative|rebalanc/i);
    expect(renderGuidance('strategy')).toMatch(/Playbook/i);
    expect(renderGuidance('risk')).toMatch(/Playbook/i);
  });

  it('aliases research keywords to firecrawl guidance', () => {
    const text = renderGuidance('firecrawl');
    expect(text).toMatch(/Firecrawl|news|research/i);
    expect(text).toMatch(/SEC|Yahoo|search|primary/i);
    expect(text).toMatch(/price-path|PEAD|underreact|theme|AI/i);
  });

  it('aliases news/earnings to research with path analysis', () => {
    const text = renderGuidance('news');
    expect(text).toMatch(/price-path|PEAD|underreact|regime/i);
  });

  it('returns analysis subcommand with full system layers', () => {
    const text = renderGuidance('analysis');
    expect(text).toMatch(/3-axis|Laggard|Buy opportunities/i);
    expect(text).toMatch(/investment-analysis/i);
    expect(text).toMatch(/Stock evaluation|valuation/i);
    expect(text).toMatch(/Undervalued|Part C|VALUE SCREEN/i);
    expect(text).toMatch(/guidance value/i);
  });

  it('returns value topic for advanced undervalued system', () => {
    const text = renderGuidance('value');
    expect(text).toMatch(/undervalued|VALUE SCREEN|trapRisk|cheapness/i);
    expect(text).toMatch(/holdings look undervalued/i);
    expect(text).toMatch(/value trap/i);
    expect(text).toMatch(/portfolio_analyzer|investment-analysis/i);
  });

  it('aliases undervalued/advanced/trap to value guidance', () => {
    for (const alias of ['undervalued', 'advanced', 'trap', 'screen', 'discovery']) {
      const text = renderGuidance(alias);
      expect(text).toMatch(/Advanced analysis|undervalued discovery|VALUE SCREEN/i);
    }
  });

  it('lists investment-analysis and value playbook in skills catalog', () => {
    const text = renderGuidance('skills');
    expect(text).toMatch(/investment-analysis/i);
    expect(text).toMatch(/Part C|VALUE SCREEN|undervalued/i);
    expect(text).toMatch(/playbook-setup/i);
    expect(text).not.toMatch(/financial-analysis/i);
  });

  it('playbook guidance mentions guided wizard', () => {
    const text = renderGuidance('playbook');
    expect(text).toMatch(/playbook-setup|Guided setup|one easy question/i);
    expect(text).toMatch(/Help me set up/i);
  });

  it('chat tips include advanced analysis examples', () => {
    const text = renderGuidance('chat');
    expect(text).toMatch(/undervalued|value screen|value trap/i);
    expect(text).toMatch(/guidance value/i);
    expect(text).toMatch(/AI|market theme|stock market/i);
  });

  it('overview includes market themes as in-scope', () => {
    const text = renderGuidance('');
    expect(text).toMatch(/AI|market theme|stock market/i);
    expect(text).toMatch(/research/i);
  });

  it('unknown topic falls back with hint', () => {
    const text = renderGuidance('spaceships');
    expect(text).toMatch(/Unknown topic/);
    expect(text).toContain('Topics');
  });

  it('createGuidanceCommand advertises value subcommand', () => {
    const cmd = createGuidanceCommand();
    expect(cmd.name).toBe('guidance');
    expect(cmd.usageHint).toMatch(/value/);
    expect(cmd.description).toMatch(/undervalued|value/i);
  });
});
