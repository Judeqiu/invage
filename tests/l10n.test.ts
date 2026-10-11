import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { invageExtension } from '../src/extension.js';
import { buildFrameworkAgentList } from '../src/agents/framework-agents.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const HOST_CHROME_KEYS = [
  'nav.dashboard',
  'nav.positions',
  'nav.watchlist',
  'nav.trades',
  'nav.insights',
  'nav.brokers',
  'settings.brokers.title',
  'settings.brokers.description',
  'page.dashboard',
  'page.positions',
  'page.watchlist',
  'page.trades',
  'page.insights',
  'page.brokers',
  'chat.empty.title',
  'chat.empty.body',
  'chat.empty.footer',
];

describe('utarus ≥ beta.49 l10n', () => {
  it('host registers English catalog overlay for every domain chrome key', () => {
    expect(invageExtension.l10n.defaultLanguage).toBe('en');
    expect(invageExtension.l10n.languages).toEqual(['en']);
    const catalog = JSON.parse(
      readFileSync(join(root, 'l10n/en.json'), 'utf8'),
    ) as Record<string, string>;
    for (const key of HOST_CHROME_KEYS) {
      expect(catalog[key], key).toMatch(/\S/);
    }
  });

  it('every framework agent has l10n so createFramework can boot', () => {
    for (const agent of buildFrameworkAgentList('full')) {
      expect(agent.extension.l10n.defaultLanguage).toBe('en');
      expect(agent.extension.l10n.languages).toEqual(['en']);
    }
  });
});
