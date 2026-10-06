/**
 * Invage DomainExtension.webUi — Dashboard tab + chat empty-state guidance.
 *
 * Nav "Dashboard" and Settings → Brokers → iframe routes → static pages under
 * domain-assets that fetch /api/domain/invage/dashboard|watchlist|broker-accounts.
 *
 * chatEmptyState: WebUI-only hero on new / empty conversations
 * (utarus SPA manifest → ChatPage).
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { ChatEmptyState, DomainWebUiExtension } from 'utarus';
import { productDisplayName } from '../product-name.js';
import { type ProductProfileId, readProductProfile } from '../agents/roster.js';
import { readFlexEgressIpv4 } from '../brokers/egress.js';
import { createBrokerConnectionsRouter } from './broker-api.js';
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
    'Use the Dashboard tab for portfolio value and Settings → Brokers to connect read-only IBKR Flex, Tiger, MooMoo, or Webull. Bookkeeper journals the ledger; InvestmentAdvisor researches; AIDeal runs the Aideal sleeve pack; Factchecker audits numbers before the final answer.',
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
    {
      label: 'Aideal sleeve pack',
      message:
        'Run the Aideal sleeve scorecard for today (all sleeves) and tell me what lots are missing category tags.',
    },
  ],
  footer:
    'Tables, code, and BinDrive reports render inline. Select text to quote it into your next message. Educational analysis only — not licensed financial advice.',
} as const;

export function chatEmptyStateFor(profile: ProductProfileId): ChatEmptyState {
  if (profile === 'consultant') {
    return {
      title: `Explore options with ${productDisplayName()}`,
      body: [
        'Explore listed calls and puts, compare risk and payoff, or review the option positions in your connected brokers.',
        'Choose a shortcut below or ask about a ticker and expiry. Chain quotes and IV are checked when available; missing data is called out.',
      ],
      bullets: [
        'Compare a covered call, protective put, or cash-secured put',
        'Check breakeven, max loss, assignment, and liquidity',
        'Review option lots and fills from connected brokers',
      ],
      startersVariant: 'cards',
      startersPlacement: 'above',
      starters: [
        {
          id: 'review_options',
          label: 'Review my options',
          description: 'Open positions and assignment risk',
          message: 'Review my open option positions across connected brokers. Show mark versus cost, expiry, assignment exposure, and any missing data.',
        },
        {
          id: 'explore_chain',
          label: 'Explore a call or put',
          description: 'Premium, breakeven, and liquidity',
          message: 'Show the nearest listed call and put chain for SPY. Pick a concrete contract from sourced data and explain premium, breakeven, time value, liquidity, and risk.',
        },
        {
          id: 'covered_call',
          label: 'Covered call',
          description: 'Income versus upside cap',
          message: 'Help me evaluate a covered call on a stock I own. Check my share position and the available chain, then compare premium, upside cap, and assignment risk.',
        },
        {
          id: 'cash_secured_put',
          label: 'Cash-secured put',
          description: 'Premium and assignment cash',
          message: 'Help me evaluate a cash-secured put on SPY using the nearest expiry. Check a concrete contract, assignment cash required, breakeven, and downside risk.',
        },
        {
          id: 'protective_put',
          label: 'Protective put',
          description: 'Downside protection and cost',
          message: 'Help me compare a protective put for a stock I own using available option contracts. Show protection, premium cost, and expiry tradeoffs.',
        },
      ],
      footer: 'Options analysis is educational. Quotes change; verify the live chain before placing an order.',
    };
  }
  return {
    title: INVAGE_CHAT_EMPTY_STATE.title,
    body: [...INVAGE_CHAT_EMPTY_STATE.body],
    bullets: [...INVAGE_CHAT_EMPTY_STATE.bullets],
    starters: INVAGE_CHAT_EMPTY_STATE.starters.map((s) => ({ ...s })),
    footer: INVAGE_CHAT_EMPTY_STATE.footer,
  };
}

export function createInvageWebUi(): DomainWebUiExtension {
  readFlexEgressIpv4();
  const empty = chatEmptyStateFor(readProductProfile());
  return {
    agentKey: 'invage',
    productName: productDisplayName(),
    defaultPath: '/dashboard',
    chatEmptyState: empty,
    nav: [
      {
        id: 'dashboard',
        label: 'Dashboard',
        path: '/dashboard',
        icon: 'layout-dashboard',
        order: 10,
      },
      {
        id: 'positions',
        label: 'Positions',
        path: '/positions',
        icon: 'table',
        order: 11,
      },
      {
        id: 'book',
        label: 'Book',
        path: '/book',
        icon: 'notebook-pen',
        order: 12,
      },
      {
        id: 'trades',
        label: 'Trades',
        path: '/trades',
        icon: 'list',
        order: 13,
      },
      {
        id: 'insights',
        label: 'Insights',
        path: '/insights',
        icon: 'sparkles',
        order: 14,
      },
    ],
    routes: [
      {
        path: '/dashboard',
        pageKind: 'iframe',
        iframeSrc: '/domain-assets/invage/dashboard/index.html',
        title: 'Portfolio Dashboard',
      },
      {
        path: '/positions',
        pageKind: 'iframe',
        iframeSrc: '/domain-assets/invage/positions/index.html',
        title: 'Positions',
      },
      {
        path: '/book',
        pageKind: 'iframe',
        iframeSrc: '/domain-assets/invage/book/index.html',
        title: 'Book',
      },
      {
        path: '/watchlist',
        pageKind: 'iframe',
        iframeSrc: '/domain-assets/invage/watchlist/index.html',
        title: 'Watch List',
      },
      {
        path: '/trades',
        pageKind: 'iframe',
        iframeSrc: '/domain-assets/invage/trades/index.html',
        title: 'Trades',
      },
      {
        path: '/insights',
        pageKind: 'iframe',
        iframeSrc: '/domain-assets/invage/insights/index.html',
        title: 'Insights',
      },
      // Utarus matchRoute returns the first prefix hit (`path.startsWith(route + '/')`).
      // `/brokers/guide` must be listed before `/brokers` or the guide URL keeps the Brokers iframe.
      {
        path: '/brokers/guide',
        pageKind: 'iframe',
        iframeSrc: '/domain-assets/invage/brokers/retired/index.html',
        title: 'Connect a broker',
      },
      {
        path: '/brokers',
        pageKind: 'iframe',
        iframeSrc: '/domain-assets/invage/brokers/retired/index.html',
        title: 'Brokers',
      },
    ],
    settingsSections: [
      {
        id: 'brokers',
        title: 'Brokers',
        description: 'Connect read-only brokerage channels',
        icon: 'landmark',
        iframeSrc: '/domain-assets/invage/settings/brokers/index.html',
        iframeHeightPx: 760,
      },
    ],
    apiRouters: [
      {
        mountPath: '',
        router: createDashboardApiRouter(),
        auth: 'user',
      },
      {
        mountPath: '',
        router: createBrokerConnectionsRouter(),
        auth: 'user',
      },
    ],
    staticDir: invageWebUiStaticDir(),
  };
}
