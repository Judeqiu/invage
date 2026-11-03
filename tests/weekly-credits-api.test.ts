import express from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({usage:vi.fn(),cap:vi.fn()}));
vi.mock('utarus',()=>({loadUsage:mocks.usage,getEffectiveCap:mocks.cap}));
import {createCreditsRouter} from '../src/webapp/credits-api.js';
const app=express();
app.use((req,_res,next)=>{if(req.headers['x-user']) (req as any).user={type:req.headers['x-user']==='admin'?'admin':'user',userId:req.headers['x-user']};next();});
app.use('/credits',createCreditsRouter());
beforeEach(()=>{vi.clearAllMocks();mocks.cap.mockResolvedValue(1000);mocks.usage.mockResolvedValue({period_credits:1000,credit_window:{startsAt:'2026-11-01T16:00:00.000Z',resetsAt:'2026-11-08T16:00:00.000Z'}});});
it('requires a session and reads only its owner despite target query parameters',async()=>{
  await request(app).get('/credits').expect(401);
  const result=await request(app).get('/credits?userId=other&slug=other').set('x-user','owner').expect(200);
  expect(mocks.usage).toHaveBeenCalledWith('owner');expect(mocks.cap).toHaveBeenCalledWith('owner','credits');
  expect(result.headers['cache-control']).toBe('private, no-store');
  expect(result.body).toMatchObject({limit:1000,used:1000,remaining:0,blocked:true,timeZone:'Asia/Singapore',resetsAt:'2026-11-08T16:00:00.000Z'});
});
it('shows actual overspend without hiding it and zero remaining',async()=>{
  mocks.usage.mockResolvedValueOnce({period_credits:1012,credit_window:{startsAt:'start',resetsAt:'end'}});
  expect((await request(app).get('/credits').set('x-user','owner')).body).toMatchObject({used:1012,remaining:0,blocked:true});
});
it('reports admin exemption and unavailable evidence explicitly',async()=>{
  expect((await request(app).get('/credits').set('x-user','admin')).body).toEqual({unlimited:true});
  expect(mocks.usage).not.toHaveBeenCalled();
  mocks.cap.mockResolvedValueOnce(undefined);
  expect((await request(app).get('/credits').set('x-user','registered-admin')).body).toEqual({unlimited:true});
  expect(mocks.usage).not.toHaveBeenCalled();
  mocks.usage.mockRejectedValueOnce(Error('private database information'));
  const failed=await request(app).get('/credits').set('x-user','owner').expect(503);
  expect(failed.text).not.toContain('private database');
  mocks.usage.mockResolvedValueOnce({period_credits:100});
  await request(app).get('/credits').set('x-user','owner').expect(503);
});
