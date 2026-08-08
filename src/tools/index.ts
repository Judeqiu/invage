import type { AgentTool } from '@earendil-works/pi-agent-core';
import { createPortfolioTools } from './portfolio.js';
import { createPlaybookTools } from './playbook.js';
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

/** Domain tools only — Utarus framework supplies user/invite/bindrive/firecrawl/write_report. */
export function createInvageTools(): AgentTool[] {
  return [
    ...createPortfolioTools(),
    ...createPlaybookTools(),
    ...createHouseholdTools(),
    ...createProjectionTools(),
    createPaymentPlanTool(),
    createOpportunityCostTool(),
    createPropertyIntelTool(),
    createUraCarparkTool(),
    createQuoteTool(),
    createPortfolioAnalyzerTool(),
    createSaveReportTool(),
    createSendReportTool(),
    ...createSnapshotTool(),
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
