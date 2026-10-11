import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { buildWebUiManifest } from 'utarus';
import { assertL10nConfig } from '../node_modules/utarus/dist/l10n/validate.js';

process.env.UTARUS_LOADED_BY_HOST = '1';

const { createInvageWebUi, chatEmptyStateFor } = await import('../src/webapp/invage-webui.js');

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

  it('passes startup localization validation for consultant question cards', () => {
    const webUi = { ...createInvageWebUi(), chatEmptyState: chatEmptyStateFor('consultant') };
    const catalog = JSON.parse(readFileSync('l10n/en.json', 'utf8')) as Record<string, string>;
    for (const starter of webUi.chatEmptyState.starters ?? []) {
      for (const key of ['label', 'description', 'message'] as const) {
        expect(catalog[`chat.empty.starter.${starter.id}.${key}`]).toBe(starter[key]);
      }
    }
    expect(() => assertL10nConfig({
      webUi,
      l10n: { languages: ['en'], defaultLanguage: 'en', catalogs: { en: catalog } },
    } as never, 'invage')).not.toThrow();
  });
});
