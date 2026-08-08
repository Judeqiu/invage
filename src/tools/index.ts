import type { AgentTool } from '@earendil-works/pi-agent-core';
import { createGetPortfolioTool, createPortfolioTools } from './portfolio.js';
import { createGetPlaybookTool, createPlaybookTools } from './playbook.js';
import { createPortfolioAnalyzerTool } from './portfolio_analyzer.js';
import { createSaveReportTool } from './save_report.js';
import { createSendReportTool } from './send_report.js';
import { createSnapshotTool } from './snapshot.js';
import { createQuoteTool } from './quote.js';
import { createHouseholdTools } from './household.js';
import { createProjectionTools } from './projection.js';
import { createPropertyIntelTool } from './property_intel.js';
import { createUraCarparkTool } from './ura_carpark.js';
import { createPaymentPlanTool } from './payment_plan.js';
import { createOpportunityCostTool } from './opportunity_cost.js';

/**
 * Default host (Invester) — orchestration + residual host domains only.
 * No portfolio CRUD, market analysis, quotes, or payment plans — those are peer work.
 * Framework supplies list_local_agents / invoke_local_agent, firecrawl, bindrive, etc.
 */
export function createInvageTools(): AgentTool[] {
  return [
    ...createPlaybookTools(),
    ...createHouseholdTools(),
    ...createProjectionTools(),
    createPropertyIntelTool(),
    createUraCarparkTool(),
  ];
}

/**
 * Bookkeeper local agent — journal / reconcile / read the household books.
 * Portfolio + cash/deposits tools (ledgered mutations), household CRUD,
 * projections for read-side checks, snapshots for audit trail.
 * No market analysis, quotes, playbook, or research tools.
 */
export function createBookkeeperTools(): AgentTool[] {
  return [
    ...createPortfolioTools(),
    ...createHouseholdTools(),
    ...createProjectionTools(),
    ...createSnapshotTool(),
  ];
}

/**
 * Accountant local agent — accurate cash/investment position view + efficient payment plans.
 * Books read/write for plan inputs, live MTM (quote/analyzer), projections, build_payment_plan.
 * No undervalued discovery playbook wizard focus; no property shopping tools.
 */
export function createAccountantTools(): AgentTool[] {
  return [
    ...createPortfolioTools(),
    ...createHouseholdTools(),
    ...createProjectionTools(),
    createPaymentPlanTool(),
    createOpportunityCostTool(),
    createQuoteTool(),
    createPortfolioAnalyzerTool(),
    ...createSnapshotTool(),
  ];
}

/**
 * Investment Expert local agent — portfolio + thesis analysis (read-only books).
 * Live marks, playbook-aware recommendations, optional HTML report.
 * No mutations, household journal, payment plans, or playbook wizard.
 */
export function createInvestmentExpertTools(): AgentTool[] {
  return [
    createGetPortfolioTool(),
    createGetPlaybookTool(),
    createQuoteTool(),
    createPortfolioAnalyzerTool(),
    createSaveReportTool(),
  ];
}
