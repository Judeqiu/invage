import type { AgentTool } from '@earendil-works/pi-agent-core';
import {
  createGetPortfolioTool,
  createListJournalEntriesTool,
  createPortfolioReadTools,
  createPortfolioTools,
} from './portfolio.js';
import { createGetPlaybookTool, createPlaybookTools } from './playbook.js';
import { createPortfolioAnalyzerTool } from './portfolio_analyzer.js';
import { createSaveReportTool } from './save_report.js';
import { createSendReportTool } from './send_report.js';
import {
  createSnapshotReadTools,
  createSnapshotTool,
} from './snapshot.js';
import { createQuoteTool } from './quote.js';
import {
  createHouseholdReadTools,
  createHouseholdTools,
} from './household.js';
import {
  createProjectionReadTools,
  createProjectionTools,
} from './projection.js';
import { createPropertyIntelTool } from './property_intel.js';
import { createUraCarparkTool } from './ura_carpark.js';
import {
  createOptimizePaymentPlanTool,
  createPaymentPlanTool,
} from './payment_plan.js';
import { createOpportunityCostTool } from './opportunity_cost.js';
import { createSubmitFactcheckVerdictTool } from './factcheck_verdict.js';

/**
 * Default host (Invester) — orchestration + residual host domains only.
 *
 * **No books writes.** Portfolio / cash / FD / household ledger mutations are
 * Bookkeeper-only. Host may configure playbook and run read-side projections.
 */
export function createInvageTools(): AgentTool[] {
  return [
    ...createPlaybookTools(),
    ...createHouseholdReadTools(),
    ...createProjectionReadTools(),
  ];
}

/**
 * Bookkeeper — **sole agent allowed to write/update books data**:
 * portfolio, cash, deposits, journals, household ledger, projection assumptions/scenarios, snapshots.
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
 * FinancialPlanner — read books + payment-plan craft. **No ledger mutations.**
 * Journal changes → hand off to @Bookkeeper.
 */
export function createFinancialPlannerTools(): AgentTool[] {
  return [
    ...createPortfolioReadTools(),
    ...createHouseholdReadTools(),
    ...createProjectionReadTools(),
    createOptimizePaymentPlanTool(),
    createPaymentPlanTool(),
    createOpportunityCostTool(),
    createQuoteTool(),
    createPortfolioAnalyzerTool(),
    ...createSnapshotReadTools(),
  ];
}

/**
 * InvestmentAdvisor — portfolio + thesis analysis (read-only books).
 */
export function createInvestmentAdvisorTools(): AgentTool[] {
  return [
    createGetPortfolioTool(),
    createGetPlaybookTool(),
    createQuoteTool(),
    createPortfolioAnalyzerTool(),
    createSaveReportTool(),
  ];
}

/**
 * Real Estate Expert — comps/research + **read** household/portfolio.
 * Property marks / payments / liability journal → @Bookkeeper.
 */
export function createRealEstateExpertTools(): AgentTool[] {
  return [
    createPropertyIntelTool(),
    createUraCarparkTool(),
    ...createHouseholdReadTools(),
    ...createProjectionReadTools(),
    createGetPortfolioTool(),
  ];
}

/**
 * Factchecker — read-only re-check tools + typed verdict submit.
 * No mutations, no optimize_payment_plan, no snapshots, no save_report.
 * Exact set (18): tests assert name equality.
 */
export function createFactcheckerTools(): AgentTool[] {
  return [
    createGetPortfolioTool(),
    createListJournalEntriesTool(),
    ...createHouseholdReadTools(),
    createGetPlaybookTool(),
    ...createProjectionReadTools(),
    createQuoteTool(),
    createPortfolioAnalyzerTool(),
    createPaymentPlanTool(),
    createOpportunityCostTool(),
    createPropertyIntelTool(),
    createUraCarparkTool(),
    createSubmitFactcheckVerdictTool(),
  ];
}

export { createSubmitFactcheckVerdictTool, validateFactcheckVerdict } from './factcheck_verdict.js';
