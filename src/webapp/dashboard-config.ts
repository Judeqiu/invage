import { readAgentConfig, type AgentConfigDefinition } from 'utarus';

export const dashboardConfig: AgentConfigDefinition = {
  id: 'invage-dashboard',
  title: 'Portfolio dashboard',
  description: 'Dashboard metrics and default option positions view.',
  fields: [{
    id: 'show_total_premium', type: 'boolean', label: 'Show total premium beside NAV', default: true,
    description: 'Net recorded short-option premium across open and closed positions, after closing costs and fees.',
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
  return { optionView: config.option_view, showTotalPremium: config.show_total_premium };
}
