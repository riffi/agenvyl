import { describe, expect, it, vi } from 'vitest';
import { buildApp as buildAppBase, type AppOptions } from './buildApp.js';
import { testDatabaseUrl } from '../testDatabase.js';

const buildApp = (options: AppOptions = {}) => buildAppBase({ connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32), ...options });

describe('route validation contracts', () => {
  it('returns a stable envelope for a body type mismatch', async () => {
    const app = await buildApp({
      databaseUrl: testDatabaseUrl('validation'),
      distPath: 'missing-dist',
      fetch: vi.fn<typeof fetch>(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      payload: { title: { unexpected: true } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'validation_error',
      message: 'Request does not match the API schema',
    });
    await app.close();
  });

  it('accepts the four answers allowed by a structured clarification request', async () => {
    const app = await buildApp({
      databaseUrl: testDatabaseUrl('validation_structured_answers'),
      distPath: 'missing-dist',
      fetch: vi.fn<typeof fetch>(),
    });

    const fourAnswers = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`question-${index + 1}`, ['answer']]));
    const accepted = await app.inject({ method:'POST',url:'/api/v1/runs/missing/request',payload:{answers:fourAnswers} });
    const rejected = await app.inject({ method:'POST',url:'/api/v1/runs/missing/request',payload:{answers:{...fourAnswers,'question-5':['answer']}} });

    expect(accepted.statusCode).toBe(404);
    expect(accepted.json()).toMatchObject({ error:'not_found' });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error:'validation_error' });
    await app.close();
  });

  it('accepts only the one-message plan and immutable implementation intents',async()=>{
    const app=await buildApp({databaseUrl:testDatabaseUrl('validation_execution_intent'),distPath:'missing-dist',fetch:vi.fn<typeof fetch>(),planModeEnabled:true});
    const legacy=await app.inject({method:'PATCH',url:'/api/v1/rooms/demo-room/execution-profile',payload:{workflow_mode:'plan'}});
    const missingVersion=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/messages',payload:{text:'@architect implement',execution_intent:{kind:'implement'}}});
    const pollutedPlan=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/messages',payload:{text:'@architect plan',execution_intent:{kind:'plan',approved_plan_version_id:'unexpected'}}});
    const validShape=await app.inject({method:'POST',url:'/api/v1/rooms/demo-room/messages',payload:{text:'@architect implement',execution_intent:{kind:'implement',approved_plan_version_id:'version-1'}}});
    expect(legacy.statusCode).toBe(400);
    expect(missingVersion.statusCode).toBe(400);
    expect(pollutedPlan.statusCode).toBe(400);
    expect(validShape.statusCode).toBe(409);expect(validShape.json()).toMatchObject({error:'approved_plan_changed'});
    await app.close();
  });
});
