import { readAgentConfig, type AgentConfigDefinition } from 'utarus';

export const dashboardConfig: AgentConfigDefinition = {
  id: 'invage-dashboard',
  title: 'Portfolio dashboard',
  description: 'Dashboard metrics and default option positions view.',
  fields: [{
    id: 'show_total_premium', type: 'boolean', label: 'Show total premium beside NAV', default: true,
    description: 'Recorded short-option sales minus closing costs across open and closed positions, before brokerage fees.',
  }, {
    id: 'show_recorded_pnl_by_month', type: 'boolean', label: 'Show Recorded P&L by Month', default: false,
    description: 'Show monthly profit or loss from recorded completed option trades in the dashboard.',
  }, {
    id: 'option_view', type: 'select', label: 'Option positions default view', default: 'open',
    options: [
      { value: 'open', label: 'Open positions table' },
      { value: 'timeline', label: 'Timeline — opens, closes and rolls' },
      { value: 'history', label: 'Position history' },
      { value: 'rolls', label: 'Roll relationships' },
    ],
  }],
};

export function readDashboardConfig() {
  const config = readAgentConfig(dashboardConfig);
  return {
    optionView: config.option_view,
    showTotalPremium: config.show_total_premium,
    showRecordedPnlByMonth: config.show_recorded_pnl_by_month,
  };
}
