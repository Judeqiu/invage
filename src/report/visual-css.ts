/**
 * Shared report visual system.
 * Source of truth is webui/report.css (iframes). This module inlines it for
 * frozen HTML and derives an email-safe hex-only sheet.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Converted sRGB from webui/report.css oklch tokens (L as 0–1). */
export const HEX_TOKENS = {
  background: '#f7fafe',
  foreground: '#171f30',
  ink: '#060e23',
  card: '#ffffff',
  muted: '#ebf1fa',
  mutedForeground: '#626c81',
  border: '#d8e0ed',
  brand: '#5b50f8',
  brand2: '#00b4ca',
  success: '#00a852',
  warning: '#eb9500',
  danger: '#ea0030',
} as const;

export const REPORT_CSS_PATH = join(__dirname, '../../webui/report.css');

export const REPORT_CSS = readFileSync(REPORT_CSS_PATH, 'utf-8');

export const EMAIL_HTML_LIMIT = 80_000;
export const EMAIL_HTML_WARN = 60_000;

export function frozenDriveOverride(maxWidthPx: 800 | 900): string {
  return `/* FROZEN_DRIVE_OVERRIDE */
.page { max-width: ${maxWidthPx}px; }
table.report { min-width: 0; }
`;
}

/** Hex-only sheet for Gmail. Drops oklch, color-mix, sticky, hover, keyframes. */
export function toEmailCss(source: string): string {
  if (!source.includes(HEX_TOKENS.background)) {
    throw new Error('webui/report.css is missing the hex cascade (expected #f7fafe).');
  }
  if (!source.includes('oklch(0.985 0.006 250)')) {
    throw new Error('webui/report.css is missing live oklch tokens.');
  }
  const t = HEX_TOKENS;
  return `:root {
  --background: ${t.background};
  --foreground: ${t.foreground};
  --ink: ${t.ink};
  --card: ${t.card};
  --muted: ${t.muted};
  --muted-foreground: ${t.mutedForeground};
  --border: ${t.border};
  --brand: ${t.brand};
  --brand-2: ${t.brand2};
  --success: ${t.success};
  --warning: ${t.warning};
  --danger: ${t.danger};
}
body {
  margin: 0;
  padding: 0;
  background: ${t.background};
  color: ${t.foreground};
  font-family: Georgia, system-ui, sans-serif;
}
table { border-collapse: collapse; width: 100%; }
`;
}

export const REPORT_CSS_EMAIL = toEmailCss(REPORT_CSS);
