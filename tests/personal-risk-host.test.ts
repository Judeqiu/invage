import {expect,it} from 'vitest';
import request from 'supertest';
import {bindDatabaseRuntime} from 'utarus/database';
import type {DatabaseRuntime} from 'utarus/database';
import type {Framework} from 'utarus';
import {startInvageWebApp} from '../src/webapp/server.js';
import {createInvageWebUi} from '../src/webapp/invage-webui.js';

it('serves the wrapped app, retains manifest authentication, and drains its HTTP transport',async()=>{
  const framework={extension:{webUi:createInvageWebUi()},agents:[],runInteractive:async (operation:()=>unknown)=>operation(),widgetStateStore:{},widgetRegistry:{},getAgentEntry:()=>({extension:{}})} as unknown as Framework;
  const release=bindDatabaseRuntime({users:{},webAuth:{},registration:{},usage:{},billing:{},trialReset:{},invites:{},adminCodes:{},close:async()=>{}} as DatabaseRuntime);
  const web=await startInvageWebApp(framework,0);
  try {
    await request(web.app).get('/health').expect(200);
    await request(web.app).get('/api/webui/manifest').expect(401);
    await request(web.app).get('/api/domain/invage/experience-settings').expect(401);
    await request(web.app).get('/api/domain/invage/account-risk').expect(401);
  }finally{await web.stop();await expect(web.closed).resolves.toBeUndefined();release();}
});
