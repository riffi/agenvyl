import { describe, expect, it, vi } from 'vitest';
import { createRepositories } from '../../infrastructure/database/createRepositories.js';
import { RoomEventBus } from '../room-events/RoomEventBus.js';
import { RoomEventService } from '../room-events/RoomEventService.js';
import type { RunContext } from '../../types.js';
import { ActiveRunRegistry } from './ActiveRunRegistry.js';
import { RunExecutor } from './RunExecutor.js';
import { testDatabaseUrl } from '../../testDatabase.js';
import type { ConnectorExecutionClient, ConnectorLifecycle } from '../connector/connector.ports.js';
import type { ApprovalChoice,RunEventMapping,RunEventStream,RunGateway,RunRecovery,StartRunInput } from '../harness/harness.ports.js';
import {ConnectorRunAdapter} from '../../integrations/connector/ConnectorRunAdapter.js';
import {connectorContractFixtures,type ConnectorExecutionEvent} from '@agenvyl/connector-contract';

describe('RunExecutor', () => {
  it('tells the model its routed identity and the active room roster', async () => {
    let instructions='';
    const {executor,registry,database}=await fixture(async(input,init)=>{
      if(String(input).endsWith('/v1/runs')){
        instructions=String((JSON.parse(String(init?.body)) as {instructions?:unknown}).instructions??'');
        return new Response(JSON.stringify({run_id:'upstream-identity'}),{status:202});
      }
      return new Response(`data: ${JSON.stringify({event:'run.completed'})}\n\n`,{status:200,headers:{'content-type':'text/event-stream'}});
    });
    registry.add(run('identity-run'));

    executor.start('identity-run','@architect проверь контекст');
    await vi.waitFor(()=>expect(registry.get('identity-run')).toBeUndefined());

    expect(instructions).toContain('Architect (@architect)');
    expect(instructions).toContain('A mention of @architect addresses you');
    expect(instructions).toContain('- @coder — Coder — Реализация');
    expect(instructions).toContain('always use the exact @handle');
    expect(instructions).toContain('Every image in the response must be stored in the room workspace');
    expect(instructions).toContain('Never embed an external image');
    expect(instructions).toContain('never use /tmp');
    expect(instructions).toContain('Do not use sudo');
    await executor.shutdown();
    await database.close();
  });

  it('persists one terminal transition and cleans the active registry', async () => {
    const { executor, events, registry, database } = await fixture(async input => {
      if (String(input).endsWith('/v1/runs')) {
        return new Response(JSON.stringify({ run_id: 'upstream-1' }), { status: 202 });
      }
      return new Response(
        `data: ${JSON.stringify({ event: 'run.completed' })}\n\n` +
          `data: ${JSON.stringify({ event: 'run.completed' })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    });
    registry.add(run('completed-run'));

    executor.start('completed-run', 'hello');
    await vi.waitFor(() => expect(registry.get('completed-run')).toBeUndefined());

    const terminalEvents = (await events.replay('demo-room', 0)).filter(event =>
      event.type === 'run.status' &&
      (event.payload as { runId?: string; status?: string }).runId === 'completed-run' &&
      (event.payload as { status?: string }).status === 'completed',
    );
    expect(terminalEvents).toHaveLength(1);
    await executor.shutdown();
    await database.close();
  });

  it('converts a background transport rejection into a failed terminal state', async () => {
    const { executor, events, registry, database } = await fixture(async () => {
      throw new Error('Hermes offline');
    });
    registry.add(run('failed-run'));

    executor.start('failed-run', 'hello');
    await vi.waitFor(() => expect(registry.get('failed-run')).toBeUndefined());

    expect((await events.replay('demo-room', 0)).some(event => {
      const payload = event.payload as { runId?: string; status?: string; error?: string };
      return event.type === 'run.status' && payload.runId === 'failed-run' &&
        payload.status === 'failed' && payload.error === 'Hermes offline';
    })).toBe(true);
    await executor.shutdown();
    await database.close();
  });

  it('rejects an answer written on behalf of another role', async () => {
    const { executor, events, registry, database } = await fixture(async input => {
      if (String(input).endsWith('/v1/runs')) return new Response(JSON.stringify({ run_id: 'upstream-role-leak' }), { status: 202 });
      return new Response(
        `data: ${JSON.stringify({ event: 'message.delta', delta: '[Ответ агента @coder]\nчужая реплика' })}\n\n` +
          `data: ${JSON.stringify({ event: 'run.completed' })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    });
    registry.add(run('role-leak'));

    executor.start('role-leak', 'hello');
    await vi.waitFor(() => expect(registry.get('role-leak')).toBeUndefined());

    const statuses = (await events.replay('demo-room', 0)).filter(event => event.type === 'run.status').map(event => event.payload as { status: string; error?: string });
    expect(statuses.at(-1)).toMatchObject({ status: 'failed', error: expect.stringContaining('another role') });
    expect((await events.replay('demo-room', 0)).some(event => event.type === 'run.selected')).toBe(false);
    await executor.shutdown();
    await database.close();
  });

  it('rejects external image hotlinks that were not persisted to workspace',async()=>{
    const {executor,events,registry,database}=await fixture(async input=>String(input).endsWith('/v1/runs')?new Response(JSON.stringify({run_id:'upstream-external-image'}),{status:202}):new Response(`data: ${JSON.stringify({event:'message.delta',delta:'Фото: ![NASA](https://example.com/space.jpg)\\n[Источник](https://example.com)'})}\n\ndata: ${JSON.stringify({event:'run.completed'})}\n\n`,{status:200,headers:{'content-type':'text/event-stream'}}));
    registry.add(run('external-image'));executor.start('external-image','show image');await vi.waitFor(()=>expect(registry.get('external-image')).toBeUndefined());
    const terminal=(await events.replay('demo-room',0)).filter(event=>event.type==='run.status').at(-1)?.payload;
    expect(terminal).toMatchObject({status:'failed',errorCode:'external_image_not_persisted',error:expect.stringContaining('workspace')});
    await executor.shutdown();await database.close();
  });

  it('durably rejects an external image on the Connector execution path',async()=>{
    const snapshot={...connectorContractFixtures.execution,cursor:2,pendingRequests:[]},streamed=[connectorEvent(3,'output.text.delta',{text:'![Remote](https://example.com/image.png)'}),connectorEvent(4,'execution.completed',{})],connector=executionClient(snapshot,async function*(){yield*streamed;}),transport=new ConnectorRunAdapter(connector),{executor,registry,database,personas,messages}=await fixture(vi.fn<typeof fetch>(),4,connector,transport),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','show image',[persona]),runId=round.runs[0].id;
    registry.add(run(runId,round.message.id));executor.start(runId,'show image');await vi.waitFor(()=>expect(registry.get(runId)).toBeUndefined());
    expect((await database.sql`SELECT status,error_code,error FROM agent_runs WHERE id=${runId}`)[0]).toMatchObject({status:'failed',error_code:'external_image_not_persisted',error:expect.stringContaining('workspace')});
    await executor.shutdown();await database.close();
  });

  it('starts runs in FIFO order up to the concurrency limit',async()=>{
    let firstStream!:ReadableStreamDefaultController<Uint8Array>;const encoder=new TextEncoder(),created:string[]=[];
    const {executor,registry,database}=await fixture(async input=>{const url=String(input);if(url.endsWith('/v1/runs')){const id=`upstream-${created.length+1}`;created.push(id);return new Response(JSON.stringify({run_id:id}),{status:202});}if(url.includes('upstream-1/events'))return new Response(new ReadableStream({start(controller){firstStream=controller;}}),{status:200});return new Response(`data: ${JSON.stringify({event:'run.completed'})}\n\n`,{status:200});},1);
    registry.add(run('fifo-1'));registry.add(run('fifo-2'));executor.start('fifo-1','one');executor.start('fifo-2','two');
    await vi.waitFor(()=>expect(created).toEqual(['upstream-1']));expect(executor.stats()).toMatchObject({active:1,queued:1,limit:1});
    firstStream.enqueue(encoder.encode(`data: ${JSON.stringify({event:'run.completed'})}\n\n`));firstStream.close();
    await vi.waitFor(()=>expect(created).toEqual(['upstream-1','upstream-2']));await vi.waitFor(()=>expect(registry.get('fifo-2')).toBeUndefined());await executor.shutdown();await database.close();
  });

  it('runs one room turn at a time while keeping agents in the same turn parallel',async()=>{
    const streams=new Map<string,ReadableStreamDefaultController<Uint8Array>>(),created:string[]=[],encoder=new TextEncoder();
    const {executor,registry,database}=await fixture(async(input,init)=>{const url=String(input);if(url.endsWith('/v1/runs')){const body=JSON.parse(String(init?.body)) as {input:string};created.push(body.input);return new Response(JSON.stringify({run_id:`upstream-${body.input}`}),{status:202});}const id=url.match(/upstream-([^/]+)\/events/)?.[1]??'';if(id==='next')return new Response(`data: ${JSON.stringify({event:'run.completed'})}\n\n`,{status:200});return new Response(new ReadableStream({start(controller){streams.set(id,controller);}}),{status:200});},3);
    registry.add(run('turn-one-a','message-one'));registry.add(run('turn-one-b','message-one'));registry.add(run('turn-two','message-two'));
    executor.start('turn-one-a','first');executor.start('turn-one-b','peer');executor.start('turn-two','next');
    await vi.waitFor(()=>{expect(created).toEqual(['first','peer']);expect([...streams.keys()].sort()).toEqual(['first','peer']);});
    for(const id of ['first','peer']){streams.get(id)!.enqueue(encoder.encode(`data: ${JSON.stringify({event:'run.completed'})}\n\n`));streams.get(id)!.close();}
    await vi.waitFor(()=>expect(created).toEqual(['first','peer','next']));await vi.waitFor(()=>expect(registry.get('turn-two')).toBeUndefined());await executor.shutdown();await database.close();
  });

  it('refreshes conversation history when a queued turn actually starts and strips internal manifests',async()=>{
    let history:Array<{role:string;content:string}>=[];const {executor,registry,database}=await fixture(async(input,init)=>{if(String(input).endsWith('/v1/runs')){history=(JSON.parse(String(init?.body)) as {conversation_history:Array<{role:string;content:string}>}).conversation_history;return new Response(JSON.stringify({run_id:'upstream-context'}),{status:202});}return new Response(`data: ${JSON.stringify({event:'run.completed'})}\n\n`,{status:200});});
    const firstMessage=crypto.randomUUID(),firstRun=crypto.randomUUID(),nextMessage=crypto.randomUUID(),nextRun=crypto.randomUUID(),first='2026-07-16T10:00:00.000Z',next='2026-07-16T10:01:00.000Z';
    await database.sql`INSERT INTO room_messages(id,room_id,text,targets,run_ids,created_at) VALUES(${firstMessage},'demo-room','first question',${database.sql.json(['architect'])},${database.sql.json([firstRun])},${first})`;
    await database.sql`INSERT INTO response_slots(id,message_id,persona_id,created_at) VALUES(${firstRun},${firstMessage},'persona-architect',${first})`;
    await database.sql`INSERT INTO agent_runs(id,message_id,room_id,persona_id,persona_version_id,persona_handle,requested_model,harness_instance_id,harness_type,model_id,status,text,response_slot_id,context,created_at,updated_at) VALUES(${firstRun},${firstMessage},'demo-room','persona-architect','persona-architect-v1','architect','sol','local-hermes','hermes','sol','completed',${'prior answer\n\nЗафиксированные inline-изображения ответа:\n- old.png (snapshot: /internal/old)'},${firstRun},${database.sql.json([])},${first},${first})`;
    await database.sql`UPDATE response_slots SET selected_run_id=${firstRun} WHERE id=${firstRun}`;
    await database.sql`INSERT INTO room_messages(id,room_id,text,targets,run_ids,created_at) VALUES(${nextMessage},'demo-room','next question',${database.sql.json(['architect'])},${database.sql.json([nextRun])},${next})`;
    await database.sql`INSERT INTO response_slots(id,message_id,persona_id,created_at) VALUES(${nextRun},${nextMessage},'persona-architect',${next})`;
    await database.sql`INSERT INTO agent_runs(id,message_id,room_id,persona_id,persona_version_id,persona_handle,requested_model,harness_instance_id,harness_type,model_id,status,response_slot_id,context,created_at,updated_at) VALUES(${nextRun},${nextMessage},'demo-room','persona-architect','persona-architect-v1','architect','sol','local-hermes','hermes','sol','queued',${nextRun},${database.sql.json([])},${next},${next})`;
    registry.add(run(nextRun,nextMessage));executor.start(nextRun,'next question');await vi.waitFor(()=>expect(registry.get(nextRun)).toBeUndefined());
    expect(history).toEqual(expect.arrayContaining([expect.objectContaining({role:'assistant',content:'prior answer'})]));expect(history.some(item=>item.content.includes('Зафиксированные inline-изображения ответа'))).toBe(false);await executor.shutdown();await database.close();
  });

  it('recovers legacy persisted non-terminal runs idempotently without a removed direct stop path',async()=>{const {executor,events,database}=await fixture(vi.fn<typeof fetch>());const now=new Date().toISOString(),messageId=crypto.randomUUID(),runId=crypto.randomUUID();await database.sql`INSERT INTO room_messages(id,room_id,text,targets,run_ids,created_at)VALUES(${messageId},'demo-room','orphan',${database.sql.json([])},${database.sql.json([runId])},${now})`;await database.sql`INSERT INTO agent_runs(id,message_id,room_id,persona_id,persona_version_id,persona_handle,requested_model,harness_instance_id,harness_type,model_id,status,upstream_run_id,created_at,updated_at)VALUES(${runId},${messageId},'demo-room','persona-architect','persona-architect-v1','architect','sol','local-hermes','hermes','sol','streaming','upstream-orphan',${now},${now})`;expect(await executor.reconcilePersistedRuns()).toBe(1);expect(await executor.reconcilePersistedRuns()).toBe(0);expect((await database.sql`SELECT status FROM agent_runs WHERE id=${runId}`)[0]?.status).toBe('failed');expect((await events.replay('demo-room',0)).some(event=>event.type==='run.status'&&(event.payload as {runId?:string}).runId===runId)).toBe(true);await executor.shutdown();await database.close();});

  it('fails a persisted Connector run from an older epoch and keeps it retryable',async()=>{
    const inspect=vi.fn<ConnectorLifecycle['inspect']>(),connector:ConnectorLifecycle={health:vi.fn().mockResolvedValue({apiVersion:'v1',connectorEpoch:'epoch-new',status:'ready',startedAt:new Date().toISOString(),instances:{total:1,healthy:1,degraded:0}}),inspect};
    const {executor,events,database,personas,messages,runs}=await fixture(vi.fn<typeof fetch>(),4,connector),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','orphan',[persona]),runId=round.runs[0].id;
    await database.sql`UPDATE agent_runs SET status='streaming',connector_execution_id='execution-old',connector_epoch='epoch-old',connector_cursor=7 WHERE id=${runId}`;

    expect(await executor.reconcilePersistedRuns()).toBe(1);expect(inspect).not.toHaveBeenCalled();
    expect((await database.sql`SELECT status,error FROM agent_runs WHERE id=${runId}`)[0]).toMatchObject({status:'failed',error:expect.stringContaining('restarted')});
    expect((await events.replay('demo-room',0)).find(event=>event.type==='run.status'&&(event.payload as {runId?:string}).runId===runId)?.payload).toMatchObject({status:'failed',errorCode:'connector_restarted'});
    await expect(runs.retry(runId)).resolves.toMatchObject({status:'created'});await executor.shutdown();await database.close();
  });

  it('waits for a temporarily unavailable Connector before recovering persisted execution',async()=>{
    const snapshot={...connectorContractFixtures.execution,executionId:'execution-delayed',status:'completed' as const,cursor:8,earliestReplayableCursor:1,pendingRequests:[]},connector=executionClient(snapshot,async function*(){yield{...connectorEvent(8,'execution.completed',{}),executionId:'execution-delayed'};}),transport=new ConnectorRunAdapter(connector);
    vi.mocked(connector.health).mockRejectedValueOnce(new Error('Connector is restarting')).mockResolvedValue({...connectorContractFixtures.health,connectorEpoch:'epoch-1'});
    const {executor,database,personas,messages}=await fixture(vi.fn<typeof fetch>(),4,connector,transport,undefined,1),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','recover after restart',[persona]),runId=round.runs[0].id;
    await database.sql`UPDATE agent_runs SET status='streaming',connector_execution_id='execution-delayed',connector_epoch='epoch-1',connector_cursor=7 WHERE id=${runId}`;

    expect(await executor.reconcilePersistedRuns()).toBe(0);expect(connector.health).toHaveBeenCalledTimes(2);
    await vi.waitFor(async()=>expect((await database.sql`SELECT status,error_code FROM agent_runs WHERE id=${runId}`)[0]).toEqual({status:'completed',error_code:null}));
    await executor.shutdown();await database.close();
  });

  it('reattaches a same-epoch run and replays only events after the durable cursor',async()=>{
    let streamOptions:unknown;const snapshot={...connectorContractFixtures.execution,executionId:'execution-live',connectorEpoch:'epoch-live',status:'completed' as const,cursor:9,earliestReplayableCursor:1,pendingRequests:[]},streamed=[{...connectorEvent(8,'output.text.delta',{text:'replayed'}),executionId:'execution-live',connectorEpoch:'epoch-live'},{...connectorEvent(9,'execution.completed',{}),executionId:'execution-live',connectorEpoch:'epoch-live'}],connector=executionClient(snapshot,async function*(executionId,options){streamOptions={executionId,...options};yield*streamed;}),transport=new ConnectorRunAdapter(connector);
    const {executor,database,personas,messages}=await fixture(vi.fn<typeof fetch>(),4,connector,transport),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','active',[persona]),runId=round.runs[0].id;
    await database.sql`UPDATE agent_runs SET status='streaming',connector_execution_id='execution-live',connector_epoch='epoch-live',connector_cursor=7 WHERE id=${runId}`;

    expect(await executor.reconcilePersistedRuns()).toBe(0);await vi.waitFor(async()=>expect((await database.sql`SELECT status FROM agent_runs WHERE id=${runId}`)[0]?.status).toBe('completed'));
    expect(streamOptions).toMatchObject({executionId:'execution-live',after:7,connectorEpoch:'epoch-live'});expect((await database.sql`SELECT connector_cursor,text FROM agent_runs WHERE id=${runId}`)[0]).toEqual({connector_cursor:'9',text:'replayed'});
    await executor.shutdown();await database.close();
  });

  it('catches up a terminal snapshot when its event checkpoint was already durable',async()=>{
    const snapshot={...connectorContractFixtures.execution,executionId:'execution-terminal',status:'completed' as const,cursor:7,earliestReplayableCursor:1,pendingRequests:[]},connector=executionClient(snapshot,async function*(){}),transport=new ConnectorRunAdapter(connector),{executor,database,personas,messages}=await fixture(vi.fn<typeof fetch>(),4,connector,transport),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','terminal',[persona]),runId=round.runs[0].id;
    await database.sql`UPDATE agent_runs SET status='streaming',connector_execution_id='execution-terminal',connector_epoch='epoch-1',connector_cursor=7 WHERE id=${runId}`;
    expect(await executor.reconcilePersistedRuns()).toBe(0);await vi.waitFor(async()=>expect((await database.sql`SELECT status FROM agent_runs WHERE id=${runId}`)[0]?.status).toBe('completed'));await executor.shutdown();await database.close();
  });

  it('fails closed when the persisted cursor is outside the replay window',async()=>{
    const snapshot={...connectorContractFixtures.execution,executionId:'execution-window',cursor:12,earliestReplayableCursor:10,pendingRequests:[]},connector=executionClient(snapshot,async function*(){}),transport=new ConnectorRunAdapter(connector),{executor,database,events,personas,messages}=await fixture(vi.fn<typeof fetch>(),4,connector,transport),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','window',[persona]),runId=round.runs[0].id;
    await database.sql`UPDATE agent_runs SET status='streaming',connector_execution_id='execution-window',connector_epoch='epoch-1',connector_cursor=7 WHERE id=${runId}`;
    expect(await executor.reconcilePersistedRuns()).toBe(1);expect(connector.events).not.toHaveBeenCalled();expect((await events.replay('demo-room',0)).at(-1)?.payload).toMatchObject({status:'failed',errorCode:'connector_replay_unavailable'});await executor.shutdown();await database.close();
  });

  it('restores a pending approval and routes approval and cancel after Core restart',async()=>{
    let release!:()=>void;const proceed=new Promise<void>(resolve=>{release=resolve;}),pending={id:'request-recovered',kind:'approval' as const,prompt:'Allow?',choices:['once','deny']},snapshot={...connectorContractFixtures.execution,executionId:'execution-control',status:'waiting_for_user' as const,cursor:7,earliestReplayableCursor:1,pendingRequests:[pending]},connector=executionClient(snapshot,async function*(){await proceed;yield{...connectorEvent(8,'request.resolved',{requestId:pending.id,outcome:'answered'}),executionId:'execution-control'};yield{...connectorEvent(9,'execution.status',{status:'stopping'}),executionId:'execution-control'};yield{...connectorEvent(10,'execution.cancelled',{}),executionId:'execution-control'};}),transport=new ConnectorRunAdapter(connector),{executor,registry,database,personas,messages}=await fixture(vi.fn<typeof fetch>(),4,connector,transport),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','control',[persona]),runId=round.runs[0].id;
    vi.mocked(connector.resolve).mockResolvedValue({execution:{...snapshot,cursor:8,pendingRequests:[]},request:{...pending,resolution:{outcome:'answered',value:'once'}}});vi.mocked(connector.stop).mockResolvedValue({...snapshot,status:'stopping',cursor:10,pendingRequests:[]});await database.sql`UPDATE agent_runs SET status='waiting_approval',connector_execution_id='execution-control',connector_epoch='epoch-1',connector_cursor=7 WHERE id=${runId}`;
    expect(await executor.reconcilePersistedRuns()).toBe(0);await vi.waitFor(()=>expect(registry.get(runId)?.waitingFor).toBe('approval'));await executor.approve(runId,'approved');expect(connector.resolve).toHaveBeenCalledWith('execution-control','request-recovered','once');await expect(executor.cancel(runId)).resolves.toMatchObject({status:'stopping'});expect(connector.stop).toHaveBeenCalledWith('execution-control');release();await vi.waitFor(async()=>expect((await database.sql`SELECT status FROM agent_runs WHERE id=${runId}`)[0]?.status).toBe('cancelled'));await executor.shutdown();await database.close();
  });

  it('restores and resolves a same-epoch clarification through Connector',async()=>{
    let release!:()=>void;const proceed=new Promise<void>(resolve=>{release=resolve;}),pending={id:'question-recovered',kind:'clarification' as const,prompt:'Which format?',choices:['PNG','SVG']},snapshot={...connectorContractFixtures.execution,executionId:'execution-clarification',status:'waiting_for_user' as const,cursor:7,earliestReplayableCursor:1,pendingRequests:[pending]},connector=executionClient(snapshot,async function*(){await proceed;yield{...connectorEvent(8,'request.resolved',{requestId:pending.id,outcome:'answered'}),executionId:'execution-clarification'};yield{...connectorEvent(9,'execution.status',{status:'running'}),executionId:'execution-clarification'};yield{...connectorEvent(10,'execution.completed',{}),executionId:'execution-clarification'};}),transport=new ConnectorRunAdapter(connector),{executor,registry,database,personas,messages}=await fixture(vi.fn<typeof fetch>(),4,connector,transport),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','control',[persona]),runId=round.runs[0].id;
    vi.mocked(connector.resolve).mockResolvedValue({execution:{...snapshot,cursor:8,pendingRequests:[]},request:{...pending,resolution:{outcome:'answered',value:'WebP'}}});await database.sql`UPDATE agent_runs SET status='waiting_clarification',connector_execution_id='execution-clarification',connector_epoch='epoch-1',connector_cursor=7 WHERE id=${runId}`;
    expect(await executor.reconcilePersistedRuns()).toBe(0);await vi.waitFor(()=>expect(registry.get(runId)?.waitingFor).toBe('clarification'));await executor.approve(runId,' WebP ');expect(connector.resolve).toHaveBeenCalledWith('execution-clarification','question-recovered','WebP');release();await vi.waitFor(async()=>expect((await database.sql`SELECT status FROM agent_runs WHERE id=${runId}`)[0]?.status).toBe('completed'));expect(registry.get(runId)).toBeUndefined();await executor.shutdown();await database.close();
  });

  it('leaves an active Connector run recoverable during graceful Core shutdown',async()=>{
    const snapshot={...connectorContractFixtures.execution,cursor:2,pendingRequests:[]},connector=executionClient(snapshot,async function*(_executionId,options){await new Promise<void>((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));}),transport=new ConnectorRunAdapter(connector);vi.mocked(connector.start).mockImplementation(async request=>({...snapshot,executionId:request.executionId}));const{executor,registry,database,personas,messages}=await fixture(vi.fn<typeof fetch>(),4,connector,transport),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','shutdown',[persona]),runId=round.runs[0].id;registry.add(run(runId,round.message.id));executor.start(runId,'shutdown');await vi.waitFor(async()=>expect((await database.sql`SELECT status,connector_cursor FROM agent_runs WHERE id=${runId}`)[0]).toEqual({status:'streaming',connector_cursor:'2'}));expect(await executor.shutdown()).toBe(true);expect((await database.sql`SELECT status FROM agent_runs WHERE id=${runId}`)[0]?.status).toBe('streaming');await database.sql`UPDATE agent_runs SET status='failed' WHERE id=${runId}`;await database.close();
  });

  it('persists Connector identity and every accepted stream checkpoint on the opt-in execution path',async()=>{
    let startRequest:unknown,streamOptions:unknown;
    const snapshot={...connectorContractFixtures.execution,cursor:2,pendingRequests:[]},streamed=[connectorEvent(3,'output.text.delta',{text:'Hello'}),connectorEvent(4,'execution.completed',{})];
    const connector:ConnectorExecutionClient={health:vi.fn().mockResolvedValue(connectorContractFixtures.health),inspect:vi.fn().mockResolvedValue(snapshot),instances:vi.fn().mockResolvedValue(connectorContractFixtures.instances),catalog:vi.fn().mockResolvedValue(connectorContractFixtures.catalog),start:vi.fn(async request=>{startRequest=request;return{...snapshot,executionId:request.executionId};}),stop:vi.fn(),resolve:vi.fn(),events:vi.fn(async function*(executionId,options){streamOptions={executionId,...options};for(const item of streamed)yield{...item,executionId};})};
    const transport=new ConnectorRunAdapter(connector),{executor,registry,database,personas,messages}=await fixture(vi.fn<typeof fetch>(),4,connector,transport),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','hello',[persona]),runId=round.runs[0].id;
    registry.add(run(runId,round.message.id));executor.start(runId,'hello');await vi.waitFor(()=>expect(registry.get(runId)).toBeUndefined());

    expect(startRequest).toMatchObject({executionId:runId,harnessInstanceId:'local-hermes',modelId:'sol',modeId:null,workspace:{roomId:'demo-room',relativePath:'.'},input:{message:'[Human user: User (@user); recipient: @architect]\nhello'}});
    expect(streamOptions).toMatchObject({executionId:runId,after:2,connectorEpoch:'epoch-1'});
    expect((await database.sql`SELECT upstream_run_id,connector_execution_id,connector_epoch,connector_cursor,upstream_metadata,status,text FROM agent_runs WHERE id=${runId}`)[0]).toEqual({upstream_run_id:null,connector_execution_id:runId,connector_epoch:'epoch-1',connector_cursor:'4',upstream_metadata:{harnessType:'hermes'},status:'completed',text:'Hello'});
    await executor.shutdown();await database.close();
  });

  it('fails a Connector run at its durable deadline, stops once and ignores late completion',async()=>{
    let release!:()=>void;const late=new Promise<void>(resolve=>{release=resolve;});
    const snapshot={...connectorContractFixtures.execution,cursor:2,pendingRequests:[]},connector=executionClient(snapshot,async function*(){await late;yield connectorEvent(3,'execution.completed',{});}),transport=new ConnectorRunAdapter(connector);
    vi.mocked(connector.start).mockImplementation(async request=>({...snapshot,executionId:request.executionId}));
    vi.mocked(connector.stop).mockImplementation(async executionId=>{release();return{...snapshot,executionId,status:'stopping'};});
    const{executor,registry,database,personas,messages,events}=await fixture(vi.fn<typeof fetch>(),4,connector,transport,25),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','timeout',[persona]),runId=round.runs[0].id;
    registry.add(run(runId,round.message.id));executor.start(runId,'timeout');
    await vi.waitFor(async()=>expect((await database.sql`SELECT status,error,error_code,execution_deadline_at FROM agent_runs WHERE id=${runId}`)[0]).toMatchObject({status:'failed',error:'Run exceeded the configured execution deadline',error_code:'run_timeout',execution_deadline_at:expect.any(Date)}));
    expect(connector.stop).toHaveBeenCalledTimes(1);expect(connector.stop).toHaveBeenCalledWith(runId);
    const terminal=(await events.replay('demo-room',0)).filter(event=>event.type==='run.status'&&['completed','failed','cancelled'].includes(String((event.payload as {status?:unknown}).status)));
    expect(terminal).toHaveLength(1);expect(terminal[0]?.payload).toMatchObject({runId,status:'failed',errorCode:'run_timeout'});
    await executor.shutdown();await database.close();
  });

  it('enforces an expired persisted deadline before replay after a Core restart',async()=>{
    const snapshot={...connectorContractFixtures.execution,executionId:'execution-expired',cursor:7,pendingRequests:[]},connector=executionClient(snapshot,async function*(){yield connectorEvent(8,'execution.completed',{});}),transport=new ConnectorRunAdapter(connector),{executor,database,personas,messages,events}=await fixture(vi.fn<typeof fetch>(),4,connector,transport,60_000),persona=(await personas.find('persona-architect'))!,round=await messages.createRound('demo-room','expired',[persona]),runId=round.runs[0].id;
    await database.sql`UPDATE agent_runs SET status='streaming',connector_execution_id='execution-expired',connector_epoch='epoch-1',connector_cursor=7,execution_deadline_at=now()-interval '1 second' WHERE id=${runId}`;
    expect(await executor.reconcilePersistedRuns()).toBe(0);
    await vi.waitFor(async()=>expect((await database.sql`SELECT status,error_code FROM agent_runs WHERE id=${runId}`)[0]).toEqual({status:'failed',error_code:'run_timeout'}));
    expect(connector.events).not.toHaveBeenCalled();expect(connector.stop).toHaveBeenCalledTimes(1);
    expect((await events.replay('demo-room',0)).at(-1)?.payload).toMatchObject({runId,status:'failed',errorCode:'run_timeout'});
    await executor.shutdown();await database.close();
  });
});

async function fixture(fetchImplementation: typeof fetch,concurrency=4,connector?:ConnectorLifecycle,execution?:RunGateway&RunEventStream&Partial<RunRecovery>,runTimeoutMs?:number,recoveryHealthDelayMs?:number) {
  const {database,personas,runs,roomEvents,messages}=await createRepositories(testDatabaseUrl('run_executor'));
  const events = new RoomEventService(roomEvents,new RoomEventBus());
  const registry = new ActiveRunRegistry();
  const transport = new FetchRunTransport(fetchImplementation);
  const connectorExecution=execution&&'reattach'in execution?execution as RunGateway&RunEventStream&RunRecovery:undefined;
  const executor = new RunExecutor({ personas,runs,events,runGateway:execution??transport,runEvents:execution??transport,connectorExecution,activeRuns:registry,concurrency,runTimeoutMs,messages,connector,recoveryHealthDelayMs });
  return { executor, events, registry, database,personas,messages,runs };
}

class FetchRunTransport implements RunGateway,RunEventStream{
  constructor(private readonly request:typeof fetch){}
  async createRun(input:StartRunInput){const response=await this.request('http://test.invalid/v1/runs',{method:'POST',body:JSON.stringify({input:input.input,instructions:input.instructions,conversation_history:input.conversationHistory??[],model:input.model,session_id:input.sessionId})});if(!response.ok)throw new Error(`Run creation failed: HTTP ${response.status}`);const body=await response.json() as {run_id:string};return{id:body.run_id};}
  async stop(){return undefined;}
  async approve(_runId:string,_choice:ApprovalChoice){return undefined;}
  async *stream(upstreamRunId:string,localRunId:string,signal:AbortSignal):AsyncIterable<RunEventMapping>{const response=await this.request(`http://test.invalid/v1/runs/${upstreamRunId}/events`,{signal});if(!response.ok||!response.body)throw new Error(`Run events failed: HTTP ${response.status}`);const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';while(true){const{done,value}=await reader.read();buffer+=decoder.decode(value??new Uint8Array(),{stream:!done});const frames=buffer.split('\n\n');buffer=frames.pop()??'';for(const frame of frames){const line=frame.split('\n').find(item=>item.startsWith('data: '));if(!line)continue;const event=JSON.parse(line.slice(6)) as {event:string;delta?:string};if(event.event==='message.delta')yield{events:[{type:'run.delta',payload:{runId:localRunId,text:event.delta??''}}]};if(event.event==='run.completed')yield{events:[],terminal:{status:'completed'}};if(event.event==='run.cancelled')yield{events:[],terminal:{status:'cancelled'}};}if(done)break;}}
}

function connectorEvent<T extends ConnectorExecutionEvent['type']>(cursor:number,type:T,payload:Extract<ConnectorExecutionEvent,{type:T}>['payload']){return{apiVersion:'v1',connectorEpoch:'epoch-1',executionId:'run-1',cursor,occurredAt:'2026-07-17T00:00:00.000Z',type,payload} as Extract<ConnectorExecutionEvent,{type:T}>;}

function executionClient(snapshot:import('@agenvyl/connector-contract').ExecutionSnapshot,events:ConnectorExecutionClient['events']):ConnectorExecutionClient{return{health:vi.fn().mockResolvedValue({...connectorContractFixtures.health,connectorEpoch:snapshot.connectorEpoch}),inspect:vi.fn().mockResolvedValue(snapshot),instances:vi.fn().mockResolvedValue(connectorContractFixtures.instances),catalog:vi.fn().mockResolvedValue(connectorContractFixtures.catalog),start:vi.fn().mockResolvedValue(snapshot),stop:vi.fn().mockResolvedValue(snapshot),resolve:vi.fn(),events:vi.fn(events)};}

function run(id: string,messageId=id): RunContext {
  return {
    id,
    messageId,
    roomId: 'demo-room',
    personaVersionId: 'persona-architect-v1',
    requestedModel: 'sol',
    harnessInstanceId:'local-hermes',harnessType:'hermes',modelId:'sol',modeId:null,
    conversationHistory: [],
    terminal: false,
    refreshContext: true,
  };
}
