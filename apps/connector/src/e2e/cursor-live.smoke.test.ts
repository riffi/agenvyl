import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {CursorConnectorAdapter} from '../adapters/cursor/adapter.js';
import type {AdapterExecutionEvent,AdapterStartExecutionRequest} from '../adapter.js';

describe.runIf(process.env.RUN_CURSOR_LIVE_SMOKE==='1')('Cursor CLI live smoke',()=>{
  let root='';const adapter=new CursorConnectorAdapter({command:process.env.AGENVYL_CONNECTOR_CURSOR_COMMAND});beforeAll(async()=>{root=await mkdtemp(join(tmpdir(),'agenvyl-cursor-live-'));await mkdir(join(root,'room'));});afterAll(async()=>rm(root,{recursive:true,force:true}));
  it('covers Plan text, Work editing, tools, and cancellation',async()=>{const model=(await adapter.catalog()).models[0];expect(model).toBeTruthy();const plan=await run(request('plan','Include the exact marker AGENVYL_CURSOR_OK in your response.',model!.id,'plan','plan'));expect(plan.text).toContain('AGENVYL_CURSOR_OK');const work=await run(request('work','Create cursor-live.txt containing exactly live-ok, then finish.',model!.id,'work','accept-edits'));expect((await readFile(join(root,'room','cursor-live.txt'),'utf8')).trim()).toBe('live-ok');expect(work.events.some(event=>event.type==='tool.started')).toBe(true);const execution=await adapter.start(request('cancel','Work until interrupted.',model!.id,'plan','plan'));await adapter.stop(execution);expect((await collect(adapter.events(execution))).at(-1)?.type).toBe('execution.cancelled');},240_000);
  const request=(id:string,message:string,modelId:string,workflowMode:'plan'|'work',permissionProfileId:string):AdapterStartExecutionRequest=>({executionId:id,harnessInstanceId:'local-cursor',modelId,executionProfile:{workflowMode,reasoningEffort:null,permissionProfileId,agentVariantId:null,planEnforcement:workflowMode==='plan'?'native':null},workspace:{roomId:'room',relativePath:'.',absolutePath:join(root,'room')},input:{systemPrompt:'Follow the request precisely.',history:[],message}});
  const run=async(input:AdapterStartExecutionRequest)=>{const execution=await adapter.start(input),events=await collect(adapter.events(execution));return{text:events.filter((event):event is Extract<AdapterExecutionEvent,{type:'output.text.delta'}>=>event.type==='output.text.delta').map(event=>event.payload.text).join(''),events};};
});
const collect=async(iterable:AsyncIterable<AdapterExecutionEvent>)=>{const events=[];for await(const event of iterable)events.push(event);return events;};
