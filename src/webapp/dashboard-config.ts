import { readAgentConfig, type AgentConfigDefinition } from 'utarus';

export const dashboardConfig: AgentConfigDefinition = {
  id: 'invage-dashboard',
  title: 'Portfolio dashboard',
  description: 'Dashboard metrics, option positions view and standalone calculator visibility.',
  fields: [{
    id: 'show_total_premium', type: 'boolean', label: 'Show total premium beside NAV', default: true,
    description: 'Recorded short-option sales minus closing costs across open and closed positions, before brokerage fees.',
  }, {
    id: 'show_realized_pnl', type: 'boolean', label: 'Show earned premium / realized P&L beside NAV', default: true,
    description: 'Cumulative recorded option profit or loss from closed, expired or settled contracts. Excludes open-position premium and stock P&L; fee basis and incomplete history are indicated.',
  }, {
    id: 'show_recorded_pnl_by_month', type: 'boolean', label: 'Show Recorded P&L by Month', default: false,
    description: 'Show monthly profit or loss from recorded completed option trades in the dashboard.',
  }, {
    id: 'show_option_risk_calculator', type: 'boolean', label: 'Show option risk calculator', default: false,
    description: 'Show the standalone calculator in navigation and app routes. Refresh Velovest after changing this setting.',
  }, {
    id: 'show_option_risk_model_view', type: 'boolean', label: 'Show Risk & scenarios view in Section 01', default: false,
    description: 'Adds a second options risk view. The existing expiry and assignment view remains available.',
  }, {
    id: 'risk_estimated_fee_per_contract', type: 'number', label: 'Risk comparison estimated fee per contract (USD)', default: 0.65, min: 0, max: 100,
    description: 'An estimate used in risk comparisons, not a verified broker charge. Applied to each modeled trade leg.',
  }, {
    id: 'risk_estimated_minimum_order_fee', type: 'number', label: 'Risk comparison estimated minimum order fee (USD)', default: 1, min: 0, max: 1000,
  }, {
    id: 'risk_estimated_slippage_bps', type: 'number', label: 'Risk comparison estimated slippage (basis points)', default: 25, min: 0, max: 1000,
    description: 'Additional adverse fill adjustment to the observed bid/ask; 25 basis points is 0.25%.',
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
    riskCostModel: projectRiskCostModel(config),
    showOptionRiskModelView: config.show_option_risk_model_view === true,
    showOptionRiskCalculator: config.show_option_risk_calculator === true,
    showTotalPremium: config.show_total_premium,
    showRealizedPnl: config.show_realized_pnl,
    showRecordedPnlByMonth: config.show_recorded_pnl_by_month,
  };
}

function projectRiskCostModel(config: Record<string, string | number | boolean>): import('../risk/types.js').RiskCostModel {
  return { basis:'estimate',currency:'USD',feePerContract:Number(config.risk_estimated_fee_per_contract),
    minimumOrderFee:Number(config.risk_estimated_minimum_order_fee),slippageBps:Number(config.risk_estimated_slippage_bps),
    reference:'Management-configured generic fee and slippage estimates; not account-specific verified broker charges' };
}
export const readOptionRiskCostModel = () => projectRiskCostModel(readAgentConfig(dashboardConfig));
