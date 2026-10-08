import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

process.env.UTARUS_LOADED_BY_HOST = '1';

const { createInvageWebUi } = await import('../src/webapp/invage-webui.js');

describe('WebUI chrome localization', () => {
  it('has catalog keys for every Settings section', () => {
    const catalog = JSON.parse(readFileSync('l10n/en.json', 'utf8')) as Record<string, string>;
    for (const section of createInvageWebUi().settingsSections ?? []) {
      expect(catalog[`settings.${section.id}.title`]).toBe(section.title);
      expect(catalog[`settings.${section.id}.description`]).toBe(section.description);
    }
  });
});
