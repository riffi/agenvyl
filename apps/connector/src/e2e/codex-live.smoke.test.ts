import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {CodexConnectorAdapter} from '../adapters/codex/adapter.js';
import type {AdapterExecutionEvent,AdapterStartExecutionRequest} from '../adapter.js';

const live=process.env.RUN_CODEX_LIVE_SMOKE==='1';
describe.runIf(live)('Codex CLI live smoke',()=>{
  let root='';const adapter=new CodexConnectorAdapter({command:process.env.AGENVYL_CONNECTOR_CODEX_COMMAND});
  beforeAll(async()=>{root=await mkdtemp(join(tmpdir(),'agenvyl-codex-live-'));await mkdir(join(root,'room'));});
  afterAll(async()=>{await adapter.close();await rm(root,{recursive:true,force:true});});
  it('covers catalog, exact text, tool/file change, usage and cancel',async()=>{
    const catalog=await adapter.catalog(),model=catalog.models[0];expect(model).toBeDefined();expect(catalog.controls.permissionProfiles.map(item=>item.id)).toContain('workspace-write');
    const exact=await run('exact','Reply with exactly AGENVYL_CODEX_OK.');expect(exact.text.trim()).toBe('AGENVYL_CODEX_OK');expect(exact.events.some(event=>event.type==='usage.updated')).toBe(true);
    const file=await run('file','Create a UTF-8 file named codex-live.txt containing exactly live-ok, then finish.');expect(await readFile(join(root,'room','codex-live.txt'),'utf8')).toBe('live-ok');expect(file.events.some(event=>event.type==='tool.started')).toBe(true);
    const cancellation=await adapter.start({...request('cancel','Wait and reason for a long time before replying.'),modelId:model!.id});const stream=adapter.events(cancellation)[Symbol.asyncIterator]();await adapter.stop(cancellation);let terminal:AdapterExecutionEvent|undefined;for(let index=0;index<50;index++){const next=await stream.next();if(next.done)break;if(['execution.cancelled','execution.completed','execution.failed'].includes(next.value.type)){terminal=next.value;break;}}expect(terminal?.type).toBe('execution.cancelled');
  },180_000);
  const request=(id:string,message:string):AdapterStartExecutionRequest=>({executionId:id,harnessInstanceId:'local-codex',modelId:'',executionProfile:{workflowMode:'work',reasoningEffort:null,permissionProfileId:'workspace-write',agentVariantId:null,planEnforcement:null},workspace:{roomId:'room',relativePath:'.',absolutePath:join(root,'room')},input:{systemPrompt:'Follow the request precisely.',history:[],message}});
  const run=async(id:string,message:string)=>{const catalog=await adapter.catalog(),model=catalog.models[0];if(!model)throw new Error('Codex has no visible model');const execution=await adapter.start({...request(id,message),modelId:model.id}),events:AdapterExecutionEvent[]=[],iterator=adapter.events(execution)[Symbol.asyncIterator]();while(true){const next=await iterator.next();if(next.done)break;const event=next.value;events.push(event);if(event.type==='request.opened')await adapter.resolveRequest(execution,event.payload.request,event.payload.request.kind==='approval'?{resolution:'once'}:{answers:Object.fromEntries((event.payload.request.questions??[]).map(question=>[question.id,[question.options?.[0]?.label??'yes']]))});}return{text:events.filter((event):event is Extract<AdapterExecutionEvent,{type:'output.text.delta'}>=>event.type==='output.text.delta').map(event=>event.payload.text).join(''),events};};
});
