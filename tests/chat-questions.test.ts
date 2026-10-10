import { describe, expect, it } from 'vitest';
import { createInvageChatQuestionLibrary } from '../src/webapp/chat-questions.js';
import { createInvageWebUi } from '../src/webapp/invage-webui.js';
// Exercise the same validation and preparation used by the framework service.
import { prepareQuestion, sourceCatalog } from '../node_modules/utarus/dist/question-library/spec.js';

describe('Lovable chat question library', () => {
  it('exposes all four groups through the persistent composer library', () => {
    const config = createInvageWebUi().chatQuestionLibrary;
    const catalog = sourceCatalog(config);
    expect(catalog.enabled).toBe(true);
    expect(catalog.mode).toBe('preset');
    expect(catalog.generation.enabled).toBe(false);
    expect(catalog.categories.map((category) => category.label)).toEqual([
      'Setup & strike selection', 'Technical analysis',
      'Assignment, rolls & wheel', 'Psychology & review',
    ]);
    expect(catalog.categories.map((category) =>
      catalog.presets.filter((preset) => preset.categoryId === category.id).length,
    )).toEqual([5, 6, 3, 4]);
  });

  it('requires a ticker for every ticker question and expands it into the draft', () => {
    const catalog = sourceCatalog(createInvageChatQuestionLibrary());
    const tickerQuestions = catalog.presets.filter((preset) => preset.fields?.length);
    expect(tickerQuestions).toHaveLength(14);
    for (const preset of tickerQuestions) {
      expect(() => prepareQuestion(preset, {})).toThrow(/required/i);
      expect(() => prepareQuestion(preset, { ticker: ' ' })).toThrow(/required/i);
      expect(() => prepareQuestion(preset, { ticker: 'X'.repeat(13) })).toThrow();
      expect(prepareQuestion(preset, { ticker: 'TSLA' })).toBe(
        preset.template.replaceAll('{ticker}', 'TSLA'),
      );
    }
    const comparison = catalog.presets.find((preset) => preset.id === 'put_vs_call')!;
    expect(prepareQuestion(comparison, { ticker: 'TSLA' })).toBe(
      'Cash-secured put vs covered call on TSLA — what does my own record show?',
    );
  });

  it('prepares psychology/review questions without requesting a ticker', () => {
    const catalog = sourceCatalog(createInvageChatQuestionLibrary());
    const reviews = catalog.presets.filter((preset) => preset.categoryId === 'psychology_review');
    expect(reviews).toHaveLength(4);
    for (const preset of reviews) {
      expect(preset.fields ?? []).toEqual([]);
      expect(prepareQuestion(preset, {})).toBe(preset.template);
    }
  });
});
