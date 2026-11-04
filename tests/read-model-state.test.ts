import { expect,it,vi } from 'vitest';
import {createReadModelStateLoader} from '../src/state/read-model-state.js';
import type {InvestorSnapshot} from '../src/state/investor-store.js';
const id='00000000-0000-4000-8000-000000000051';
function setup() {
  let revision=1,deleted=false,shared=false,namespace='one';
  const identity=vi.fn(async()=>({revision,state:{user:deleted?{deleted_at:'2026-11-04'}:{}}}));
  const load=vi.fn(async()=>({revision,state:{user:{id},portfolio:{A:{units:revision}}}} as unknown as InvestorSnapshot));
  return {read:createReadModelStateLoader({identity,load,shared:()=>shared,namespace:()=>namespace}),load,identity,
    revise:()=>{revision++;},remove:()=>{deleted=true;},share:()=>{shared=true;},namespace:()=>{namespace='two';}};
}
it('checks current identity each time while reusing only the matching immutable revision',async()=>{
  const s=setup();const first=await s.read(id);
  expect(await s.read(id)).toBe(first);expect(s.identity).toHaveBeenCalledTimes(2);expect(s.load).toHaveBeenCalledOnce();
  expect(Object.isFrozen(first.state.portfolio!.A)).toBe(true);
  s.revise();expect((await s.read(id)).revision).toBe(2);expect(s.load).toHaveBeenCalledTimes(2);
  s.remove();await expect(s.read(id)).rejects.toThrow('unavailable');
});
it('keeps different data roots and users separate and bypasses local revision caching for shared profiles',async()=>{
  const s=setup();await s.read(id);s.namespace();await s.read(id);expect(s.load).toHaveBeenCalledTimes(2);
  s.share();await s.read(id);await s.read(id);expect(s.load).toHaveBeenCalledTimes(4);
});
it('coalesces overlapping full reads and retries after a load failure',async()=>{
  const s=setup();await Promise.all([s.read(id),s.read(id)]);expect(s.load).toHaveBeenCalledOnce();
  s.revise();s.load.mockRejectedValueOnce(new Error('temporary'));await expect(s.read(id)).rejects.toThrow('temporary');
  expect((await s.read(id)).revision).toBe(2);
});
