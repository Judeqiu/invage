import type { InvestorState } from '../../src/state/portfolio-state.js';
import type { OptionExecution } from '../../src/brokers/option-executions.js';
export const optionFill = (patch: Partial<OptionExecution> = {}): OptionExecution => ({ channel:'ibkr', account_id:'U1',
  execution_id:'open-1', contract_id:'123', executed_at:'2026-09-10T10:00:00', underlying:'AAPL', right:'put',
  strike:'150.00', expiry:'2027-01-15', multiplier:'100', contracts:'2', side:'sell', effect:'open', currency:'USD',
  gross_premium:'600.12345678', commission:'-2.10', ...patch });
export function tradesFixture(): InvestorState {
  return { user:{ id:'8648d3d4-f46f-4979-a9f3-7d76cefa9d15', created_at:'2026-01-01' }, profile:{ display_name:'Trader',contact_email:'t@example.test' }, log:[],
    broker_sources:{ source:{ broker_id:'ibkr', credentials:{} } },
    broker_connections:{ ibkr:{ broker_id:'ibkr', source_id:'source', account_id:'U1', channel:'ibkr', label:'IBKR', enabled:true, config:{} } },
    portfolio:{ 'AAPL-put':{ instrument:'option', units:1, avg_price:300.06172839, currency:'USD', channel:'ibkr',
      option:{ underlying:'AAPL', right:'put', side:'short', strike:150, expiry:'2027-01-15', multiplier:100, settlement:'physical', mark:100 } } },
    option_executions:[optionFill(), optionFill({ execution_id:'close-1', executed_at:'2026-10-01T10:00:00', contracts:'1', side:'buy', effect:'close',gross_premium:'-50.01', commission:'-1.05' })] };
}
