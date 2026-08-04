import {describe,expect,it,vi} from 'vitest';
import type {AdapterStartExecutionRequest} from '../../adapter.js';
import {CursorConnectorAdapter,assertCursorVersion,cursorPrompt,parseCursorModels,type CursorProcessPort} from './adapter.js';
import type {CursorMessage} from './protocol.js';

describe('CursorConnectorAdapter',()=>{
  it('parses a bounded unique model catalog and validates the calendar version',()=>{
    expect(parseCursorModels('Available models:\n\u001b[32mauto default\u001b[0m\ngpt-5.6-sol GPT 5.6 Sol\nauto default\n')).toEqual([{id:'auto',label:'default'},{id:'gpt-5.6-sol',label:'GPT 5.6 Sol'}]);expect(()=>parseCursorModels('auto Default\nauto Other')).toThrow('ambiguous');
    expect(()=>assertCursorVersion('2026.01.15-old')).toThrow('newer');expect(()=>assertCursorVersion('2026.01.16-ok')).not.toThrow();
  });
  it('streams text and tools without duplicating the terminal result',async()=>{
    const fixture=new FakeCursor(),adapter=new CursorConnectorAdapter({processFactory:options=>{fixture.options=options;fixture.input=options.input;return fixture;}}),execution=await adapter.start(request('plan','plan'));
    fixture.emit({type:'assistant',message:{content:[{type:'text',text:'hello'}]}});fixture.emit({type:'tool_call',subtype:'started',call_id:'t1',tool_call:{readToolCall:{args:{path:'README.md'}}}});fixture.emit({type:'tool_call',subtype:'completed',call_id:'t1',tool_call:{readToolCall:{result:{success:true}}}});fixture.emit({type:'result',subtype:'success',is_error:false,result:'hello'});
    const events=await collect(adapter.events(execution));
    expect(events.map(event=>event.type)).toEqual(['output.text.delta','tool.started','tool.completed','execution.completed']);
    expect(fixture.options?.args).toEqual(expect.arrayContaining(['--mode','plan','--trust']));expect(fixture.options?.args).not.toContain('--force');expect(fixture.options?.args.join(' ')).not.toContain('conversationHistory');expect(fixture.input).toContain('conversationHistory');
  });
  it('requires accept-edits for Work and passes --force after opt-in',async()=>{
    const adapter=new CursorConnectorAdapter({processFactory:()=>new FakeCursor()});
    await expect(adapter.start(request('work','plan'))).rejects.toThrow('accept-edits');
    const fixture=new FakeCursor(),work=new CursorConnectorAdapter({processFactory:options=>{fixture.options=options;return fixture;}});await work.start(request('work','accept-edits'));expect(fixture.options?.args).toContain('--force');
  });
  it('uses the terminal text as fallback and supports cancellation',async()=>{
    const fixture=new FakeCursor(),adapter=new CursorConnectorAdapter({processFactory:()=>fixture}),execution=await adapter.start(request('plan','accept-edits'));fixture.emit({type:'future'});fixture.emit({type:'result',subtype:'success',is_error:false,result:'fallback'});
    expect((await collect(adapter.events(execution))).map(event=>event.type)).toEqual(['output.text.delta','execution.completed']);
    const cancelling=new FakeCursor(),second=new CursorConnectorAdapter({processFactory:()=>cancelling}),active=await second.start({...request('plan','plan'),executionId:'cancel'});await second.stop(active);expect(cancelling.interrupt).toHaveBeenCalled();expect((await collect(second.events(active))).at(-1)?.type).toBe('execution.cancelled');
  });
  it('isolates concurrent processes and normalizes process failures',async()=>{const processes:FakeCursor[]=[],adapter=new CursorConnectorAdapter({processFactory:()=>{const process=new FakeCursor();processes.push(process);return process;}}),first=await adapter.start(requestWithId('one')),second=await adapter.start(requestWithId('two'));expect(processes).toHaveLength(2);processes[0]!.emit({type:'result',subtype:'success',is_error:false,result:'one'});processes[1]!.fail(new Error('token=cursor-secret failed'));expect((await collect(adapter.events(first))).at(-1)?.type).toBe('execution.completed');const failure=(await collect(adapter.events(second))).at(-1);expect(failure?.type).toBe('execution.failed');expect(JSON.stringify(failure)).not.toContain('cursor-secret');});
  it('builds bounded canonical context',()=>expect(cursorPrompt(request('plan','plan'))).toContain('conversationHistory'));
});

class FakeCursor implements CursorProcessPort{
  options?:{args:string[]};input='';private message?:(value:CursorMessage)=>void;private exit?:(error?:Error)=>void;
  start=vi.fn(async()=>undefined);interrupt=vi.fn(async()=>undefined);onMessage(listener:(value:CursorMessage)=>void){this.message=listener;}onExit(listener:(error?:Error)=>void){this.exit=listener;}emit(value:CursorMessage){this.message?.(value);if(value.type==='result')queueMicrotask(()=>this.exit?.());}fail(error:Error){this.exit?.(error);}
}
const request=(workflowMode:'plan'|'work',permissionProfileId:string):AdapterStartExecutionRequest=>({executionId:`${workflowMode}-${permissionProfileId}`,harnessInstanceId:'local-cursor',modelId:'auto',executionProfile:{workflowMode,reasoningEffort:null,permissionProfileId,agentVariantId:null,planEnforcement:workflowMode==='plan'?'native':null},workspace:{roomId:'room',relativePath:'.',absolutePath:'/workspace/room'},input:{systemPrompt:'Be precise.',history:[{role:'user',content:'Earlier'}],message:'Current'}});
const requestWithId=(executionId:string):AdapterStartExecutionRequest=>({...request('plan','plan'),executionId});
const collect=async(iterable:AsyncIterable<import('../../adapter.js').AdapterExecutionEvent>)=>{const values=[];for await(const value of iterable)values.push(value);return values;};
