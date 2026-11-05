import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalculationTools, calculationEvidence } from '../src/tools/portfolio_diagnostics.js';
import { resolveInvestorFromChannel } from '../src/tools/channel.js';
import { inspectPortfolioProjection, portfolioFingerprint, type PortfolioProjection } from '../src/state/projection-store.js';
import { saveInvestor, loadInvestor, type InvestorSnapshot } from '../src/state/investor-store.js';
import { refreshPortfolioAfterSync } from '../src/state/projection-events.js';
import { buildLivePositions } from '../src/report/dashboard-model.js';
vi.mock('../src/tools/channel.js', async original => ({ ...await original<typeof import('../src/tools/channel.js')>(), resolveInvestorFromChannel: vi.fn() }));
vi.mock('../src/state/investor-store.js', () => ({saveInvestor:vi.fn(),loadInvestor:vi.fn()}));
vi.mock('../src/state/projection-events.js', () => ({refreshPortfolioAfterSync:vi.fn()}));
vi.mock('../src/state/projection-store.js', async original => ({...await original<typeof import('../src/state/projection-store.js')>(),inspectPortfolioProjection:vi.fn()}));
let snapshot: InvestorSnapshot;
let saved: PortfolioProjection;
beforeEach(() => {
  vi.clearAllMocks();
  snapshot = {revision:4,state:{user:{id:'11111111-2222-4333-8444-555555555555',created_at:'2026-01-01',auth_token:'SECRET'},profile:{display_name:'Test',contact_email:''},log:[], portfolio:{'AAA@broker':{units:1,avg_price:-7,currency:'USD',channel:'broker',broker_ref:{listing_exchange:'US'}}}}};
  const live = buildLivePositions(snapshot.state.portfolio!,{AAA:10},undefined,[{channel:'broker',currency:'USD',amount:5}],[],undefined, {reportingCurrency:'USD',fxRates:{}},{resilient:true});
  saved = {version:8,userId:snapshot.state.user.id,calculatedAt:'2026-11-05T11:33:07.490Z',fingerprint:portfolioFingerprint(snapshot.state),dashboard:{model:{live,history:[],periodChange:null,lastSnapshot:null},equityPrices:{AAA:10},warnings:[]}} as unknown as PortfolioProjection;
  vi.mocked(resolveInvestorFromChannel).mockResolvedValue(snapshot);
  vi.mocked(inspectPortfolioProjection).mockReturnValue({entry:saved,sourceMatches:true});
  vi.mocked(loadInvestor).mockImplementation(async () => snapshot);
  vi.mocked(refreshPortfolioAfterSync).mockResolvedValue({status:'ready'});
});
const tool = (name:string,write=true) => createCalculationTools(write).find(t => t.name === name)!;
const execute = async (name:string,args:object) => (await tool(name).execute('test',args)).details as any;

describe('calculation diagnostics and guarded repairs', () => {
  it('exposes saved generation, exact holdings, omissions and failed valuation rather than inventing a cost-sign explanation', async () => {
    saved.dashboard.model!.live.positions = [];
    saved.dashboard.model!.live.issues.push({key:'AAA@broker',code:'valuation_error',severity:'error',message:'Cannot assign to read only property broker_ref'});
    const detail = await execute('inspect_portfolio_calculation',{section:'positions',calculated_at:saved.calculatedAt});
    expect(detail.rows[0]).toMatchObject({key:'AAA@broker',included:false,source_holding:{avg_price:-7}});
    expect(JSON.stringify(detail)).not.toContain('SECRET');
    expect((await execute('inspect_portfolio_calculation',{section:'issues'})).omitted_keys).toEqual(['AAA@broker']);
    expect((await execute('inspect_portfolio_calculation',{calculated_at:'old'})).error).toContain('not retained');
  });
  it('replays through production valuation without quotes/writes and refuses changed source inputs', () => {
    expect(calculationEvidence(snapshot,saved,'replay')).toMatchObject({delta:0,replay_total_value:15});
    snapshot.state.portfolio!['AAA@broker'].units=2;
    expect(() => calculationEvidence(snapshot,saved,'replay')).toThrow(/Source changed/);
    expect(saveInvestor).not.toHaveBeenCalled();
  });
  it('previews signed/zero corrections and applies only the identical revision and evidence; leaves cash intact', async () => {
    const args = {mode:'preview',key:'AAA@broker',expected_revision:4,patch:{avg_price:-9,units:0},evidence:'Verified statement row',reason:'User requested bookkeeping correction'};
    const preview = await execute('correct_holding',args);
    expect(preview.after).toMatchObject({units:0,avg_price:-9});
    expect(saveInvestor).not.toHaveBeenCalled();
    const changed = await execute('correct_holding',{...args,mode:'apply',patch:{avg_price:9},preview_token:preview.preview_token});
    expect(changed.error).toMatch(/differs from preview/);
    const applied = await execute('correct_holding',{...args,mode:'apply',preview_token:preview.preview_token});
    expect(applied).toMatchObject({applied:true,cash_changed:false,after:{units:0,avg_price:-9},calculation_status:'ready'});
    expect(saveInvestor).toHaveBeenCalledOnce();
    expect(snapshot.state.log[0]).toMatchObject({action:'holding_corrected',evidence:args.evidence});
  });
  it('rejects stale repairs and exposes writes only to Bookkeeper', async () => {
    expect(createCalculationTools().map(t=>t.name)).toEqual(['inspect_portfolio_calculation','read_calculation_source']);
    expect((await execute('correct_holding',{mode:'preview',key:'AAA@broker',expected_revision:3,patch:{units:2},evidence:'statement',reason:'correction'})).error).toMatch(/revision changed/);
    const code = await execute('read_calculation_source',{component:'broker_nav'});
    expect(code.source).toContain('broker_net_assets');
    expect((await execute('read_calculation_source',{component:'../../.env'})).error).toMatch(/Unknown/);
  });
  it('reports a failed rebuild without claiming the dashboard was fixed', async () => {
    vi.mocked(refreshPortfolioAfterSync).mockResolvedValue({status:'failed'});
    expect(await execute('rebuild_portfolio_calculations',{expected_revision:4,reason:'repair derived view'})).toMatchObject({status:'failed',after:null});
  });
});
