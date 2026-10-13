import { readAgentConfig, saveAgentConfig, type AgentConfigDefinition } from 'utarus';

export const dashboardConfig: AgentConfigDefinition = {
  id: 'invage-dashboard',
  title: 'Portfolio dashboard',
  description: 'Dashboard metrics and default option positions view.',
  fields: [{
    id: 'show_total_premium', type: 'boolean', label: 'Show total premium beside NAV', default: true,
    description: 'Recorded short-option sales minus closing costs across open and closed positions, before brokerage fees.',
  }, {
    id: 'option_view', type: 'select', label: 'Option positions default view', default: 'open',
    options: [
      { value: 'open', label: 'Open positions table' },
      { value: 'history', label: 'Position history' },
      { value: 'rolls', label: 'Roll relationships' },
    ],
  }],
};

export function readDashboardConfig() {
  // Accept the retired stored value only during migration; Management offers the new views.
  const legacy: AgentConfigDefinition = { ...dashboardConfig, fields: dashboardConfig.fields.map(field =>
    field.id === 'option_view' && field.type === 'select' ? { ...field, options: [...field.options, { value: 'timeline', label: 'Retired Timeline' }] } : field) };
  const config = readAgentConfig(legacy);
  if (config.option_view === 'timeline') {
    config.option_view = 'open';
    saveAgentConfig(dashboardConfig, config);
  }
  return { optionView: config.option_view, showTotalPremium: config.show_total_premium };
}
