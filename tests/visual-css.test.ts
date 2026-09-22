import { describe, expect, it } from 'vitest';
import { HEX_TOKENS, REPORT_CSS, REPORT_CSS_EMAIL, toEmailCss } from '../src/report/visual-css.js';

describe('visual CSS lockstep', () => {
  it('hex snapshot matches converted oklch', () => {
    expect(HEX_TOKENS.background).toBe('#f7fafe');
    expect(HEX_TOKENS.foreground).toBe('#171f30');
    expect(HEX_TOKENS.ink).toBe('#060e23');
    expect(HEX_TOKENS.brand).toBe('#5b50f8');
    expect(HEX_TOKENS.brand2).toBe('#00b4ca');
    expect(HEX_TOKENS.success).toBe('#00a852');
    expect(HEX_TOKENS.danger).toBe('#ea0030');
  });

  it('iframe CSS has hex-then-oklch cascade', () => {
    expect(REPORT_CSS).toContain('#f7fafe');
    expect(REPORT_CSS).toContain('oklch(0.985 0.006 250)');
    expect(REPORT_CSS).toContain('#5b50f8');
    expect(REPORT_CSS).toContain('oklch(0.55 0.24 278)');
  });

  it('email CSS is hex-only', () => {
    const email = toEmailCss(REPORT_CSS);
    expect(email).toContain('#f7fafe');
    expect(email).not.toContain('oklch(');
    expect(email).not.toContain('color-mix');
    expect(REPORT_CSS_EMAIL).toBe(email);
  });
});
