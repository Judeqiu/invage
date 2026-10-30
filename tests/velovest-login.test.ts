import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInvageWebUi } from '../src/webapp/invage-webui.js';
import { clearLoginPageRegistration, getLoginPageConfig, getLoginShell, registerLoginPageFromExtension } from '../node_modules/utarus/dist/webapp/login-page.js';
import { createLoginStaticRouter } from '../node_modules/utarus/dist/webapp/login-static.js';

afterEach(() => {
  clearLoginPageRegistration();
  vi.unstubAllEnvs();
});

describe('Velovest login shell', () => {
  it('serves the Academy shell at the existing login URL with native authentication assets', async () => {
    vi.stubEnv('INVAGE_PRODUCT_PROFILE', 'consultant');
    registerLoginPageFromExtension({ webUi: createInvageWebUi() } as never);
    expect(getLoginPageConfig()?.formChrome).toBe(false);
    expect(getLoginShell()?.absolutePath).toMatch(/webui\/login\/shell.html$/);
    const app = express().use(createLoginStaticRouter());
    const page = await request(app).get('/login?return=%2Fpositions');
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.text).toContain('Continue with context.');
    expect(page.text).toContain('id="utarus-login-root"');
    expect(page.text).toContain('src="/login/embed.js"');
    expect(page.text).not.toContain('<form');
    const embed = await request(app).get('/login/embed.js');
    expect(embed.status).toBe(200);
    expect(embed.text).toContain('/api/onboard/login');
    expect(embed.text).toContain('safePostLoginPath');
    expect((await request(app).get('/login/')).text).toBe(page.text);
  });

  it('leaves the other product profile on its existing framework login', () => {
    vi.stubEnv('INVAGE_PRODUCT_PROFILE', 'full');
    registerLoginPageFromExtension({ webUi: createInvageWebUi() } as never);
    expect(getLoginShell()).toBeUndefined();
    expect(getLoginPageConfig()).toBeUndefined();
  });
});
