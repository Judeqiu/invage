import {expect,it,vi} from 'vitest';
import type pg from 'pg';
import {SubmissionRepository,validateSubmission,type SubmissionInput} from '../src/signup/submissions.js';
import {validSessionDate} from '../src/signup/catalog.js';

const input:SubmissionInput={reference:'VV-DATES1',packageId:'novice',sessionDate:'2026-11-07',sessionTime:'10:00',name:'Date test',email:'date@example.invalid',phone:'',bankTransactionId:'',consentAccepted:true,proof:{filename:'proof.pdf',contentType:'application/pdf',data:Buffer.from('%PDF-test')}};
function fixture(disabled=false,retry=false) {
  const query=vi.fn(async(sql:string,args?:unknown[])=>{
    if(sql.startsWith('SELECT 1 FROM velovest_signup.disabled_dates'))return {rows:[],rowCount:disabled?1:0};
    if(sql.startsWith('SELECT 1 FROM velovest_signup.submissions'))return {rows:[],rowCount:retry?1:0};
    if(sql.includes('INSERT INTO velovest_signup.submissions'))return {rows:[{id:retry?'retained-id':args![0],reference:input.reference}]};
    return {rows:[],rowCount:0};
  });
  const release=vi.fn(),notify=vi.fn(async()=>{});
  const repository=new SubmissionRepository({connect:async()=>({query,release})} as unknown as pg.Pool,notify);
  return {repository,query,release,notify};
}
it('accepts weekends and rejects impossible calendar dates',()=>{
  expect(validateSubmission(input).sessionDate).toBe('2026-11-07');
  for(const value of ['2026-02-30','2026-13-01','invalid','2026-1-01'])expect(validSessionDate(value)).toBe(false);
});
it('checks the persisted date under a transaction lock and commits before notifying',async()=>{
  const {repository,query,notify,release}=fixture();
  await repository.save(input);
  expect(query.mock.calls[0][0]).toBe('BEGIN');
  expect(query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
  expect(query.mock.calls.at(-1)![0]).toBe('COMMIT');
  expect(notify).toHaveBeenCalledOnce();expect(release).toHaveBeenCalledOnce();
});
it('rejects newly disabled dates without saving evidence or notifying',async()=>{
  const {repository,query,notify,release}=fixture(true);
  await expect(repository.save(input)).rejects.toMatchObject({status:409});
  expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO velovest_signup.submissions'))).toBe(false);
  expect(query.mock.calls.at(-1)![0]).toBe('ROLLBACK');expect(notify).not.toHaveBeenCalled();expect(release).toHaveBeenCalledOnce();
});
it('preserves identical retries after a date is disabled without notifying again',async()=>{
  const {repository,notify}=fixture(true,true);
  await expect(repository.save(input)).resolves.toEqual({reference:input.reference});expect(notify).not.toHaveBeenCalled();
});
it('keeps renewal intake independent of date settings',async()=>{
  const {repository,query}=fixture(true);
  await repository.save({...input,packageId:'renewal'});
  expect(query.mock.calls.some(([sql])=>sql.includes('disabled_dates'))).toBe(false);
});
it('uses the same date lock for toggles and accepts enabling an absent date',async()=>{
  const {repository,query}=fixture();
  await repository.setDateEnabled('2026-11-07',true,'synthetic-manager');
  expect(query.mock.calls[1][0]).toContain('pg_advisory_xact_lock');
  expect(query.mock.calls[2]).toEqual(['DELETE FROM velovest_signup.disabled_dates WHERE session_date=$1',['2026-11-07']]);
  expect(query.mock.calls.at(-1)![0]).toBe('COMMIT');
});
