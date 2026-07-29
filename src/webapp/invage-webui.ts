/**
 * Invage DomainExtension.webUi — Dashboard tab + chat empty-state guidance.
 *
 * Nav "Dashboard" → iframe route → static page under domain-assets
 * that fetches live data from /api/domain/invage/dashboard.
 *
 * chatEmptyState: WebUI-only hero on new / empty conversations
 * (utarus SPA manifest → ChatPage).
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

/**
 * Essential WebUI-only guidance on every new / empty conversation.
 * Covers portfolio analysis + household treasury projections.
 */
export const INVAGE_CHAT_EMPTY_STATE = {
  title: 'Your investment analyst — with household books',
  body: [
    'I analyze portfolios (live marks, playbook, undervalued screens) and can keep household books for cash flow and big decisions like buying a house.',
    'Use the Dashboard tab for portfolio value. For family net worth or 5-year cash flow, set treasury data then ask me to project.',
  ],
  bullets: [
    'Import or add holdings (equity / fund / options) · set free cash and fixed deposits',
    'Configure your Investment Playbook when you want methodology tuned to you',
    'Household: set reporting currency, income/expense lines, property + mortgage',
    'Projections: set return/inflation/FX assumptions → run 5-year cash flow or house scenario',
    'Research: undervalued screens, news → price path, multi-market (US / HK / China)',
  ],
  starters: [
    {
      label: 'Show my portfolio',
      message: 'Show my portfolio, cash, and fixed deposits with a short status summary.',
    },
    {
      label: 'Find undervalued stocks',
      message: 'Find undervalued stocks I should research (use my playbook markets if set).',
    },
    {
      label: 'Household net worth',
      message:
        'Show my household books: reporting currency, free cash, property, liabilities, cash-flow lines, and any projection gaps.',
    },
    {
      label: '5-year cash flow',
      message:
        'Project my household cash flow and net worth for the next 60 months. Tell me what is missing if you cannot run the model yet.',
    },
    {
      label: 'Can we buy a house?',
      message:
        'Help me run a house affordability scenario. First check what household data I already have, then ask only for the missing purchase details.',
    },
  ],
  footer:
    'Tables, code, and BinDrive reports render inline. Select text to quote it into your next message. Educational analysis only — not licensed financial advice.',
} as const;

export function createInvageWebUi(): DomainWebUiExtension {
  return {
    agentKey: 'invage',
    productName: 'Invester',
    defaultPath: '/',
    chatEmptyState: {
      title: INVAGE_CHAT_EMPTY_STATE.title,
      body: [...INVAGE_CHAT_EMPTY_STATE.body],
      bullets: [...INVAGE_CHAT_EMPTY_STATE.bullets],
      starters: INVAGE_CHAT_EMPTY_STATE.starters.map((s) => ({ ...s })),
      footer: INVAGE_CHAT_EMPTY_STATE.footer,
    },
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
