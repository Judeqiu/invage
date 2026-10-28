import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {useTestDatabase,createInvestorFixture} from './helpers/database.js';
await useTestDatabase({books:true});
const {migrateBooks}=await import('../src/books/migrate.js');
const {getPool,withHouseholdTx}=await import('../src/books/db.js');
const {captureBrokerActivity,captureFetchedBrokerActivity}=await import('../src/brokers/activity-store.js');
const {loadInvestor}=await import('../src/state/investor-store.js');
const scope={brokerId:'moomoo',channel:'moomoo-A',accountId:'A'};
const raw={kind:'json' as const,body:Buffer.from('{"acc_id":"A","fills_history":{"rows":[{"deal_id":9007199254740993123,"code":"US.MBLY260821P8000","price":0.1234567890123456789}]}}')};

it('adds immutable, idempotent source observations without changing existing state or financial journals',async()=>{
  await migrateBooks();await migrateBooks();
  const user=randomUUID();
  await createInvestorFixture({user:{id:user,created_at:'2026-10-01',auth_token:randomUUID()},profile:{display_name:'Evidence',contact_email:'evidence@test.local'},log:[],cash:[{currency:'USD',amount:42,channel:'manual',updated_at:'2026-10-01'}]});
  const before=await loadInvestor(user);
  const first=await captureBrokerActivity(user,scope,raw,'archive/one.json');
  const second=await captureBrokerActivity(user,scope,raw,'archive/two.json');
  await captureBrokerActivity(user,scope,raw,'archive/two.json');
  expect(first.documentId).toBe(second.documentId);
  const result=await withHouseholdTx(user,async client=>({
    docs:(await client.query('SELECT body FROM broker_source_documents WHERE household_id=$1',[user])).rows,
    records:(await client.query('SELECT source_id,data,category,instrument FROM broker_source_records WHERE household_id=$1 AND category=$2',[user,'execution'])).rows,
    receipts:(await client.query('SELECT source_ref FROM broker_source_receipts WHERE household_id=$1',[user])).rows,
    journals:(await client.query('SELECT id FROM journal_entries WHERE household_id=$1',[user])).rows,
  }));
  expect(result.docs).toHaveLength(1);expect(result.docs[0].body).toEqual(raw.body);
  expect(result.records).toEqual([{source_id:'9007199254740993123',data:{deal_id:'9007199254740993123',code:'US.MBLY260821P8000',price:'0.1234567890123456789'},category:'execution',instrument:'option'}]);
  expect(result.receipts).toHaveLength(2);expect(result.journals).toEqual([]);
  expect(await loadInvestor(user)).toEqual(before);
  for(const table of ['broker_source_documents','broker_source_records','broker_source_receipts']) {
    await expect(withHouseholdTx(user,c=>c.query(`DELETE FROM ${table} WHERE household_id=$1`,[user]))).rejects.toThrow(/append-only/);
    await expect(withHouseholdTx(user,c=>c.query(`TRUNCATE ${table} CASCADE`))).rejects.toThrow(/append-only/);
  }
});
it('preserves changed source versions, historical attachments, malformed bytes and account mismatches',async()=>{
  const user=randomUUID();
  await captureFetchedBrokerActivity(user,scope,{...raw,historyAttachments:[{kind:'xml',body:Buffer.from('<FlexStatement accountId="A"><Trades><Trade tradeID="old" assetCategory="STK"/></Trades></FlexStatement>')}]},'sync:one');
  const changed={...raw,body:Buffer.from(raw.body.toString().replace('0.1234567890123456789','0.5'))};
  await captureBrokerActivity(user,scope,changed,'sync:two');
  const malformed=await captureBrokerActivity(user,scope,{kind:'json',body:Buffer.from('{broken')},'bad');
  const mismatch=await captureBrokerActivity(user,scope,{kind:'json',body:Buffer.from('{"acc_id":"B","fills_history":{"rows":[{"deal_id":"wrong"}]}}')},'foreign');
  expect(malformed.status).toBe('unparsed');expect(mismatch.status).toBe('account_mismatch');
  await withHouseholdTx(user,async c=>{
    expect((await c.query('SELECT id FROM broker_source_documents WHERE household_id=$1',[user])).rows).toHaveLength(5);
    expect((await c.query('SELECT DISTINCT data->>\'price\' AS price FROM broker_source_records WHERE household_id=$1 AND source_id=$2 ORDER BY price',[user,'9007199254740993123'])).rows).toEqual([{price:'0.1234567890123456789'},{price:'0.5'}]);
    expect((await c.query('SELECT source_id FROM broker_source_records WHERE household_id=$1 AND document_id IN ($2,$3)',[user,malformed.documentId,mismatch.documentId])).rows).toEqual([]);
  });
});
it('enforces tenant isolation and document ownership for a non-superuser database role',async()=>{
  const user=randomUUID(),other=randomUUID(),role=`activity_test_${randomUUID().replaceAll('-','')}`;
  const own=await captureBrokerActivity(user,scope,raw,'own');
  const foreign=await captureBrokerActivity(other,scope,raw,'foreign');
  const pool=getPool();
  await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
  try {
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await pool.query(`GRANT SELECT,INSERT ON broker_source_documents,broker_source_records,broker_source_receipts TO "${role}"`);
    await withHouseholdTx(user,async c=>{
      await c.query(`SET LOCAL ROLE "${role}"`);
      expect((await c.query('SELECT id FROM broker_source_documents')).rows).toEqual([{id:own.documentId}]);
      expect((await c.query('SELECT document_id FROM broker_source_records WHERE document_id=$1',[foreign.documentId])).rows).toEqual([]);
    });
    await expect(withHouseholdTx(user,async c=>{
      await c.query(`SET LOCAL ROLE "${role}"`);
      await c.query('INSERT INTO broker_source_receipts (household_id,document_id,source_ref) VALUES ($1,$2,$3)',[other,foreign.documentId,'cross-tenant']);
    })).rejects.toThrow(/row-level security/);
    await expect(withHouseholdTx(user,async c=>{
      await c.query(`SET LOCAL ROLE "${role}"`);
      await c.query('INSERT INTO broker_source_receipts (household_id,document_id,source_ref) VALUES ($1,$2,$3)',[user,foreign.documentId,'wrong-document']);
    })).rejects.toThrow(/foreign key/);
  } finally {
    await pool.query(`DROP OWNED BY "${role}"`);await pool.query(`DROP ROLE "${role}"`);
  }
});
