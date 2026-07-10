import type { AgentTool } from '@earendil-works/pi-agent-core';
import { createPortfolioTools } from './portfolio.js';
import { createPortfolioAnalyzerTool } from './portfolio_analyzer.js';
import { createSaveReportTool } from './save_report.js';
import { createSendReportTool } from './send_report.js';
import { createSnapshotTool } from './snapshot.js';

/** Domain tools only — Utarus framework supplies user/invite/bindrive/firecrawl/write_report. */
export function createInvageTools(): AgentTool[] {
  return [
    ...createPortfolioTools(),
    createPortfolioAnalyzerTool(),
    createSaveReportTool(),
    createSendReportTool(),
    ...createSnapshotTool(),
  ];
}
