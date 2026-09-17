import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';
import {prepare} from '../../scripts/migration/velovest-v4.mjs';
const at='2026-09-16T00:12:39.000Z';
test('Velovest absent usage is explicitly initialized; existing usage and all custom fields stay intact',()=>{
 const root=mkdtempSync(join(tmpdir(),'velovest-source-'));for(const d of ['users','usage','ops'])mkdirSync(join(root,d));
 const user={user:{slug:'owner',id:'stable-id'},portfolio:{ABC:{units:7}},treasury:{custom:'preserve'}};
 writeFileSync(join(root,'users/owner.yaml'),YAML.stringify(user));
 writeFileSync(join(root,'users/owner.yaml.bak-20260822-demo'),YAML.stringify({...user,portfolio:{old:'backup'}}));
 const initial=prepare(root,at);assert.equal(initial.manifest.files.filter(f=>f.disposition==='retained').length,1);assert.deepEqual(initial.users,[user]);assert.equal(initial.initializedUsageAccounts,1);assert.equal(initial.usage[0].created_at,at);assert.equal(initial.usage[0].lifetime_credits,0);
 const existing={...initial.usage[0],lifetime_credits:99,custom_counter:42};writeFileSync(join(root,'usage/owner.yaml'),YAML.stringify(existing));
 assert.deepEqual(prepare(root,at).usage,[existing]);assert.equal(prepare(root,at).initializedUsageAccounts,0);
 writeFileSync(join(root,'orgs.yaml'),'{}');assert.throws(()=>prepare(root,at),/Unsupported/);
});
