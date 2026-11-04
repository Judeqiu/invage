import {expect,it} from 'vitest';
import {portfolioWire} from '../src/webapp/portfolio-wire.js';
it('round trips every JSON value, signed numbers, keys and repeated nested evidence without truncation',()=>{
  const evidence=Object.fromEntries([['__proto__',{safe:true}],['constructor','ordinary'],['unicode','中文'],['amount',-0.025],['fee',0],['unknown',null]]);
  const input={rows:Array.from({length:2000},(_,i)=>({id:i,evidence,copy:structuredClone(evidence)})),flags:[false,true,null],empty:{},emptyList:[]};
  const encoded=JSON.parse(JSON.stringify(portfolioWire.encode(input)));
  const decoded=portfolioWire.decode(encoded);
  expect(JSON.stringify(decoded)).toBe(JSON.stringify(input));
  expect(JSON.stringify(encoded).length).toBeLessThan(JSON.stringify(input).length/2);
  expect({}).not.toHaveProperty('safe');
});
it('preserves existing unencoded JSON and ordinary JSON serialization semantics',()=>{
  const old={model:{live:{totalValue:123}}};expect(portfolioWire.decode(old)).toBe(old);
  const value={omit:undefined,values:[undefined,NaN,Infinity,-0]};
  expect(JSON.stringify(portfolioWire.decode(portfolioWire.encode(value)))).toBe(JSON.stringify(value));
});
