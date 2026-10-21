import { readFileSync } from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWebUiManifest } from 'utarus';
import { assertL10nConfig } from '../node_modules/utarus/dist/l10n/validate.js';
import { createInvageChatQuestionStarters } from '../src/webapp/chat-questions.js';
import { localizeEmptyStarters } from '../node_modules/utarus/web/src/lib/empty-hero.js';

process.env.UTARUS_LOADED_BY_HOST = '1';

const { createInvageWebUi, chatEmptyStateFor } = await import('../src/webapp/invage-webui.js');
afterEach(() => vi.unstubAllEnvs());

describe('WebUI chrome localization', () => {
  it('has catalog keys for every Settings section', () => {
    const catalog = JSON.parse(readFileSync('l10n/en.json', 'utf8')) as Record<string, string>;
    for (const section of createInvageWebUi().settingsSections ?? []) {
      expect(catalog[`settings.${section.id}.title`]).toBe(section.title);
      expect(catalog[`settings.${section.id}.description`]).toBe(section.description);
    }
  });

  it('passes the framework WebUI manifest validation', () => {
    const webUi = createInvageWebUi();
    expect(() => buildWebUiManifest({ webUi } as never)).not.toThrow();
  });

  it.each(['full', 'consultant'] as const)('localizes every possible question card for %s', (profile) => {
    vi.stubEnv('INVAGE_PRODUCT_PROFILE', profile);
    // Validate the whole pool, not the four randomly selected manifest cards.
    const starters = createInvageChatQuestionStarters();
    const webUi = { ...createInvageWebUi(), chatEmptyState: { ...chatEmptyStateFor('consultant'), starters } };
    const catalog = JSON.parse(readFileSync('l10n/en.json', 'utf8')) as Record<string, string>;
    if (profile === 'consultant') {
      expect(starters.some(starter => starter.id === 'question_stock_research_report')).toBe(true);
    }
    for (const starter of starters) {
      for (const key of ['label', 'description', 'message'] as const) {
        expect(catalog[`chat.empty.starter.${starter.id}.${key}`]).toBe(starter[key]);
      }
    }
    expect(localizeEmptyStarters(starters, key => {
      if (!catalog[key]) throw new Error(`Unknown catalog key ${JSON.stringify(key)}`);
      return catalog[key];
    })).toEqual(starters);
    expect(() => assertL10nConfig({
      webUi,
      l10n: { languages: ['en'], defaultLanguage: 'en', catalogs: { en: catalog } },
    } as never, 'invage')).not.toThrow();
  });
});
