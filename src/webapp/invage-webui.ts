/**
 * Invage DomainExtension.webUi — Dashboard tab in the Utarus SPA shell.
 *
 * Nav "Dashboard" → iframe route → static page under domain-assets
 * that fetches live data from /api/domain/invage/dashboard.
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { DomainWebUiExtension } from 'utarus';
import { createDashboardApiRouter } from './dashboard-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to invage/webui (static domain assets). */
export function invageWebUiStaticDir(): string {
  return join(__dirname, '../../webui');
}

export function createInvageWebUi(): DomainWebUiExtension {
  return {
    agentKey: 'invage',
    productName: 'Invester',
    defaultPath: '/',
    nav: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        path: '/dashboard',
        icon: 'layout-dashboard',
        order: 10,
      },
    ],
    routes: [
      {
        path: '/dashboard',
        pageKind: 'iframe',
        iframeSrc: '/domain-assets/invage/dashboard/index.html',
        title: 'Portfolio Dashboard',
      },
    ],
    apiRouters: [
      {
        mountPath: '',
        router: createDashboardApiRouter(),
        auth: 'user',
      },
    ],
    staticDir: invageWebUiStaticDir(),
  };
}
