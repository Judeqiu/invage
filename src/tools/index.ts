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

/** Domain tools only — Utarus framework supplies user/invite/bindrive/firecrawl/write_report. */
export function createInvageTools(): AgentTool[] {
  return [
    ...createPortfolioTools(),
    ...createPlaybookTools(),
    ...createHouseholdTools(),
    ...createProjectionTools(),
    createPropertyIntelTool(),
    createQuoteTool(),
    createPortfolioAnalyzerTool(),
    createSaveReportTool(),
    createSendReportTool(),
    ...createSnapshotTool(),
  ];
}
