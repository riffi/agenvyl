import Fastify from 'fastify';
import {afterEach,describe,expect,it} from 'vitest';
import {createMessageBodySchema} from './routeSchemas.js';

describe('createMessageBodySchema',()=>{
  const apps:ReturnType<typeof Fastify>[]=[];
  afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()))});

  async function validate(routing:unknown){
    const app=Fastify();apps.push(app);
    app.post('/',{schema:{body:createMessageBodySchema}},request=>request.body);
    return app.inject({method:'POST',url:'/',payload:{text:'hello',routing}});
  }

  it('preserves one-shot new_request routing through Fastify validation',async()=>{
    const response=await validate({mode:'auto',delivery:'new_request'});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({routing:{mode:'auto',delivery:'new_request'}});
  });

  it('rejects new_request outside auto routing',async()=>{
    expect((await validate({mode:'agent_session',delivery:'new_request'})).statusCode).toBe(400);
    expect((await validate({mode:'room_context',delivery:'new_request'})).statusCode).toBe(400);
  });
});
