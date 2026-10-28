import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {useTestDatabase,createInvestorFixture} from './helpers/database.js';
await useTestDatabase({books:true});
const {migrateBooks}=await import('../src/books/migrate.js');
const {withHouseholdTx}=await import('../src/books/db.js');
const {loadInvestor,saveInvestor}=await import('../src/state/investor-store.js');
const {applyBrokerStatement}=await import('../src/brokers/apply-statement.js');
const {mapMooMooBundleToStatement}=await import('../src/moomoo/moomoo-map.js');
const {assertBrokerStatement}=await import('../src/brokers/statement.js');
const {valuePosition}=await import('../src/market/position-value.js');
const {toMinor}=await import('../src/books/money.js');
const code='US.SKHY261120P135000';
function bundle(cost:string,mark='5.092',valid=true):any {
  // Position values and exact contract size observed in David's archived response.
  return {schema:'invage.moomoo.raw.v1',acc_id:'A',fetched_at:'2026-10-28T01:20:59.066Z',
    authorized:{s:'ok'},funds:{s:'ok',d:{us_cash:'-10',currency:'USD',funds_assets:'-1',power:'-20',maintenance_margin:'-30'}},
    positions:{s:'ok',d:[{position_side:'SHORT',code,qty:'-1',currency:'USD',nominal_price:mark,cost_price:cost,cost_price_valid:valid,security_type:'OPTION'}]},
    option_basicinfo:[{code,contract_size:100,stock_type:'DRVT',stock_owner:'US.SKHY'}]};
}
it('preserves negative and zero broker costs/marks/metrics regardless of plausibility or validity flags',()=>{
  for(const cost of ['-7.4400','0','7.44']) for(const mark of ['-5.092','0','5.092']) for(const valid of [true,false]) {
    const statement=assertBrokerStatement(mapMooMooBundleToStatement(bundle(cost,mark,valid),'moomoo'));
    expect(statement.skipped.filter(s=>s.blocking!==false)).toEqual([]);
    expect(statement.lots[0].holding).toMatchObject({avg_price:Number(cost)*100,units:1,option:{side:'short',mark:Number(mark)*100}});
    expect(statement.cash).toEqual([{currency:'USD',amount:-10}]);
    expect(statement.metrics).toMatchObject({fund_assets:-1,buying_power:-20,maintenance_margin:-30});
  }
  const statement=mapMooMooBundleToStatement(bundle('-7.4400'),'moomoo');
  expect(valuePosition(statement.lots[0].ticker,statement.lots[0].holding).pl).toBeCloseTo(-1253.2);
});
it.each([0,-10])('retains reported contract numbers without a positivity assumption: %s',size=>{
  const raw=bundle('-7.44','0');raw.option_basicinfo[0].contract_size=size;
  raw.positions.d[0].strike_price=-1;
  const statement=assertBrokerStatement(mapMooMooBundleToStatement(raw,'moomoo'));
  expect(statement.lots[0].holding.option).toMatchObject({multiplier:size,strike:-1});
  expect(statement.lots[0].holding.option!.mark).toBeCloseTo(0);
});
it('persists signed and zero costs, repeats without duplicate money, and closes zero-cost positions',async()=>{
  await migrateBooks();
  const user=randomUUID();
  await createInvestorFixture({user:{id:user,created_at:'2026-10-01',auth_token:randomUUID()},profile:{display_name:'Signed broker values',contact_email:'signed@test.local'},log:[],broker_connections:{moomoo:{enabled:true,credentials:{}}}});
  const journals=()=>withHouseholdTx(user,async c=>Number((await c.query('SELECT count(*) AS n FROM journal_entries WHERE household_id=$1',[user])).rows[0].n));
  for(const cost of ['-7.4400','0','5.5']) {
    const statement=mapMooMooBundleToStatement(bundle(cost,'0'),'moomoo');
    await applyBrokerStatement(await loadInvestor(user),'moomoo',statement);
    const saved=await loadInvestor(user),key=Object.keys(saved.state.portfolio!)[0];
    expect(saved.state.portfolio![key].avg_price).toBe(Number(cost)*100);
    await withHouseholdTx(user,async c=>{
      const row=(await c.query(`SELECT b.balance_minor::text,b.quantity::text FROM accounts a JOIN account_balances b ON b.account_id=a.id WHERE a.household_id=$1 AND a.kind='position'`,[user])).rows[0];
      expect(BigInt(row.balance_minor)).toBe(-toMinor(Number(cost)*100));expect(Number(row.quantity)).toBe(1);
    });
    const n=await journals();await applyBrokerStatement(await loadInvestor(user),'moomoo',statement);expect(await journals()).toBe(n);
    const again=await loadInvestor(user);again.state.profile.display_name='Metadata changed';await saveInvestor(again);expect(await journals()).toBe(n);
  }
  const zero=mapMooMooBundleToStatement(bundle('0'),'moomoo');await applyBrokerStatement(await loadInvestor(user),'moomoo',zero);
  await applyBrokerStatement(await loadInvestor(user),'moomoo',{...zero,lots:[]});
  await withHouseholdTx(user,async c=>{
    const rows=(await c.query(`SELECT b.balance_minor::text,b.quantity::text FROM accounts a JOIN account_balances b ON b.account_id=a.id WHERE a.household_id=$1 AND a.kind='position'`,[user])).rows;
    expect(rows.every(r=>BigInt(r.balance_minor)===0n&&Number(r.quantity)===0)).toBe(true);
  });
});
it('imports signed broker stock quantities and zero costs through the books, then closes them',async()=>{
  const user=randomUUID();
  await createInvestorFixture({user:{id:user,created_at:'2026-10-01',auth_token:randomUUID()},profile:{display_name:'Short stock',contact_email:'short@test.local'},log:[],broker_connections:{moomoo:{enabled:true,credentials:{}}}});
  const raw=bundle('0');raw.positions.d=[{code:'US.AAPL',qty:'-5',currency:'USD',position_side:'SHORT',cost_price:'0',cost_price_valid:false}];
  const statement=mapMooMooBundleToStatement(raw,'moomoo');
  expect(statement.lots[0].holding).toMatchObject({units:-5,avg_price:0});
  await applyBrokerStatement(await loadInvestor(user),'moomoo',statement);
  await applyBrokerStatement(await loadInvestor(user),'moomoo',statement);
  await applyBrokerStatement(await loadInvestor(user),'moomoo',{...statement,lots:[]});
  expect((await loadInvestor(user)).state.portfolio).toEqual({});
});
