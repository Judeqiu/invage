import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,utimesSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {portfolioFingerprint} from '../src/state/projection-store.js';
import {freezeReadModel,isFrozenReadModel} from '../src/state/freeze-read-model.js';
import type {InvestorState} from '../src/state/portfolio-state.js';
it('reuses only proven immutable state and revalidates every snapshot file change',()=>{
 const root=mkdtempSync(join(tmpdir(),'frozen-fingerprint-')),previous=process.env.UTARUS_DATA_ROOT;process.env.UTARUS_DATA_ROOT=root;
 try{
  const state:InvestorState={user:{id:'00000000-0000-4000-8000-000000000073',created_at:'2026-01-01'},profile:{display_name:'Owner',contact_email:'owner@example.invalid'},log:[],portfolio:{AAPL:{units:10,avg_price:100,currency:'USD'}}};
  const dir=join(root,'drive',state.user.id);mkdirSync(dir,{recursive:true});
  const file=join(dir,'snapshot-2026-11-03.json');writeFileSync(file,'{}');writeFileSync(join(dir,'snapshots.json'),JSON.stringify(['snapshot-2026-11-03.json']));
  const frozen=freezeReadModel(structuredClone(state)),expected=portfolioFingerprint(state);
  expect(isFrozenReadModel(frozen)).toBe(true);expect(portfolioFingerprint(frozen)).toBe(expected);expect(portfolioFingerprint(frozen)).toBe(expected);
  utimesSync(file,new Date('2026-01-01'),new Date('2026-01-01'));
  expect(portfolioFingerprint(frozen)).not.toBe(expected);expect(portfolioFingerprint(frozen)).toBe(portfolioFingerprint(state));
  const shallow=Object.freeze({...structuredClone(state)});expect(isFrozenReadModel(shallow)).toBe(false);
  const before=portfolioFingerprint(shallow);shallow.portfolio!.AAPL.units=11;expect(portfolioFingerprint(shallow)).not.toBe(before);
 }finally{rmSync(root,{recursive:true,force:true});if(previous===undefined)delete process.env.UTARUS_DATA_ROOT;else process.env.UTARUS_DATA_ROOT=previous;}
});
it('deep-freezes nested objects even when an outer object was already frozen',()=>{
 const value=Object.freeze({nested:{value:1}});freezeReadModel(value);expect(Object.isFrozen(value.nested)).toBe(true);
});
