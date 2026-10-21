import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertInvageChatQuestionCatalog,
  createInvageChatQuestionStarters,
  sampleInvageChatQuestionStarters,
} from '../src/webapp/chat-questions.js';
import { createInvageChromeCatalogs } from '../src/webapp/invage-webui.js';

vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, readFileSync: vi.fn(fs.readFileSync) };
});

const catalog = JSON.parse(readFileSync('l10n/en.json', 'utf8')) as Record<string, string>;
afterEach(() => {
  vi.mocked(readFileSync).mockClear();
  vi.unstubAllEnvs();
});

describe('complete chat question catalog startup guard', () => {
  it.each(['full', 'consultant'] as const)('rejects any missing question field for %s', profile => {
    expect(() => assertInvageChatQuestionCatalog(catalog, profile)).not.toThrow();
    const starters = createInvageChatQuestionStarters(profile);
    expect(new Set(starters.map(starter => starter.id)).size).toBe(starters.length);
    for (const starter of starters) {
      for (const field of ['label', 'description', 'message']) {
        const key = `chat.empty.starter.${starter.id}.${field}`;
        const incomplete = { ...catalog };
        delete incomplete[key];
        expect(() => assertInvageChatQuestionCatalog(incomplete, profile)).toThrow(key);
      }
    }
  });

  it('rejects empty and whitespace-only translations', () => {
    const key = 'chat.empty.starter.question_stock_research_report.label';
    for (const value of ['', ' \n ']) {
      expect(() => assertInvageChatQuestionCatalog({ ...catalog, [key]: value }, 'consultant')).toThrow(key);
    }
  });

  it('checks the selected catalog profile independently of the environment', () => {
    vi.stubEnv('INVAGE_PRODUCT_PROFILE', 'full');
    const incomplete = { ...catalog };
    delete incomplete['chat.empty.starter.question_stock_research_report.label'];
    expect(() => assertInvageChatQuestionCatalog(incomplete, 'full')).not.toThrow();
    expect(() => assertInvageChatQuestionCatalog(incomplete, 'consultant')).toThrow('question_stock_research_report.label');
  });

  it('rejects a missing entry at startup even when its question is outside the manifest selection', () => {
    vi.stubEnv('INVAGE_PRODUCT_PROFILE', 'consultant');
    const sampled = sampleInvageChatQuestionStarters();
    expect(sampled).toHaveLength(4);
    expect(new Set(sampled.map(starter => starter.id)).size).toBe(4);
    const omitted = createInvageChatQuestionStarters().find(starter =>
      !sampled.some(selected => selected.id === starter.id),
    )!;
    const key = `chat.empty.starter.${omitted.id}.label`;
    const incomplete = { ...catalog };
    delete incomplete[key];
    vi.mocked(readFileSync).mockReturnValueOnce(JSON.stringify(incomplete));
    expect(() => createInvageChromeCatalogs()).toThrow(key);
    expect(createInvageChromeCatalogs().en[key]).toBe(catalog[key]);
  });
});
