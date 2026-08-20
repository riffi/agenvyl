import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {AdapterExecutionEvent,AdapterStartExecutionRequest} from '../../adapter.js';
import { AntigravityConnectorAdapter, antigravityPrompt, shouldDetachAntigravityProcess, windowsCommandLineLength } from './adapter.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe('AntigravityConnectorAdapter', () => {
  it('keeps AGY in the hidden parent console on Windows and creates a process group on POSIX', () => {
    expect(shouldDetachAntigravityProcess('win32')).toBe(false);
    expect(shouldDetachAntigravityProcess('linux')).toBe(true);
    expect(shouldDetachAntigravityProcess('darwin')).toBe(true);
  });

  it('discovers exact models and exposes per-agent permission profiles', async () => {
    const fixture = await fakeAgy();
    const adapter = fixture.adapter({ env: { FAKE_AGY_VERSION: '1.1.8', FAKE_AGY_MODELS: 'gemini-3.6-flash-high\tGemini 3.6 Flash (High)\nClaude Sonnet 4.6 (Thinking)\ngemini-3.6-flash-high\tGemini 3.6 Flash (High)\n' } });
    await expect(adapter.catalog()).resolves.toEqual({
      models: [
        { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
        { id: 'Claude Sonnet 4.6 (Thinking)', label: 'Claude Sonnet 4.6 (Thinking)' },
      ],
      controls:{nativeWorkflowModes:['plan','work'],permissionProfiles:[{id:'plan',label:'Plan only'},{id:'accept-edits',label:'Accept edits'}],agentVariants:[]},
    });
    const old = fixture.adapter({ env: { FAKE_AGY_VERSION: '1.1.7' } });
    await expect(old.catalog()).rejects.toThrow('1.1.8 or newer');
  });

  it('serializes version and model probes and shares concurrent catalog requests',async()=>{
    const fixture=await fakeAgy();
    const adapter=fixture.adapter({env:{FAKE_AGY_LOCK:join(fixture.directory,'agy.lock'),FAKE_AGY_MODELS:'gemini\n'}});
    const [first,second]=await Promise.all([adapter.catalog(),adapter.catalog()]);
    expect(first).toBe(second);
    expect(first.models).toEqual([{id:'gemini',label:'gemini'}]);
    await expect(adapter.catalog()).resolves.toBe(first);
  });

  it('runs one fresh process with exact routing, cwd, auto-update guard and deterministic flattened context', async () => {
    const fixture = await fakeAgy();
    const capturePath = join(fixture.directory, 'capture.json');
    const adapter = fixture.adapter({ env: { FAKE_AGY_CAPTURE: capturePath, FAKE_AGY_OUTPUT: 'Final answer\n',FAKE_AGY_CONVERSATION_ID:'conversation-1' }, printTimeoutMs: 42_000 });
    expect(adapter.capabilities).toEqual(['model_catalog','execution_profiles','text_streaming','reasoning','tools','usage']);
    expect(adapter.postTurnContinuation).toEqual({mode:'native_session',durability:'connector_restart',retention:'provider_managed'});
    const request = execution(fixture.directory);
    const handle = await adapter.start(request);
    expect(handle).toEqual({ upstreamId: request.executionId });
    await expect(collect(adapter.events(handle))).resolves.toEqual([
      { type: 'output.text.delta', payload: { text: 'Final answer' } },
      { type: 'execution.completed', payload: {continuation:{handle:expect.any(String)}} },
    ]);
    const capture = JSON.parse(await readFile(capturePath, 'utf8')) as { args: string[]; cwd: string; disableAutoUpdate?: string };
    expect(capture.cwd).toBe(fixture.directory);
    expect(capture.disableAutoUpdate).toBe('true');
    expect(capture.args.slice(0, 10)).toEqual(['--dangerously-skip-permissions', '--mode', 'accept-edits', '--model', 'Gemini 3.5 Flash (High)', '--print-timeout', '42000ms','--output-format','stream-json', '--print']);
    expect(capture.args[10]).toBe(antigravityPrompt(request));
    expect(JSON.parse(capture.args[10]!.split('\n')[1]!)).toMatchObject({ systemInstruction: 'Act as coder.', conversationHistory: [{ role: 'user', content: 'Earlier' }], currentUserMessage: 'Implement it.' });
  });

  it('resumes the exact AGY conversation across Connector instances',async()=>{
    const fixture=await fakeAgy(),capturePath=join(fixture.directory,'continuation-capture.ndjson'),environment={FAKE_AGY_CAPTURE:capturePath,FAKE_AGY_CAPTURE_APPEND:'true',FAKE_AGY_CONVERSATION_ID:'conversation-native-1',USERPROFILE:fixture.directory};
    const sourceAdapter=fixture.adapter({env:environment}),sourceRequest=execution(fixture.directory),source=await sourceAdapter.start(sourceRequest),handle=continuationHandle(await collect(sourceAdapter.events(source)));
    const resumedAdapter=fixture.adapter({env:environment}),continued={...execution(fixture.directory),executionId:'run-agy-continued',input:{systemPrompt:'Act as coder.',history:[],message:'Continue natively.'},continuation:{handle}};
    const resumed=await resumedAdapter.startContinuation(continued,handle);
    await expect(collect(resumedAdapter.events(resumed))).resolves.toEqual([{type:'output.text.delta',payload:{text:'ok'}},{type:'execution.completed',payload:{continuation:{handle:expect.any(String)}}}]);
    const captures=(await readFile(capturePath,'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line) as{args:string[]});
    expect(captures).toHaveLength(2);
    expect(captures[1]!.args).toContain('--conversation');
    expect(captures[1]!.args[captures[1]!.args.indexOf('--conversation')+1]).toBe('conversation-native-1');
    expect(captures[1]!.args.at(-2)).toBe('--print');
    expect(captures[1]!.args.at(-1)).toBe('Continue natively.');
    await expect(resumedAdapter.releaseContinuation(handle,{instanceId:'local-antigravity'})).resolves.toBe('provider_retained');
    await expect(resumedAdapter.releaseContinuation(handle,{instanceId:'other-antigravity'})).rejects.toMatchObject({code:'continuation_incompatible'});
    await expect(resumedAdapter.releaseContinuation('broken',{instanceId:'local-antigravity'})).rejects.toMatchObject({code:'continuation_unavailable'});
    const changedScope=fixture.adapter({env:{...environment,USERPROFILE:join(fixture.directory,'other-profile')}});
    await expect(changedScope.releaseContinuation(handle,{instanceId:'local-antigravity'})).rejects.toMatchObject({code:'continuation_incompatible'});
    await expect(resumedAdapter.startContinuation({...continued,executionId:'incompatible',modelId:'other-model'},handle)).rejects.toMatchObject({code:'continuation_incompatible'});
    await expect(resumedAdapter.startContinuation({...continued,executionId:'plan-incompatible',executionProfile:{...continued.executionProfile,workflowMode:'plan',planEnforcement:'native'}},handle)).rejects.toMatchObject({code:'continuation_incompatible'});
  });

  it('forces Plan workflow to read-only even for an Accept edits persona',async()=>{
    const fixture=await fakeAgy(),capturePath=join(fixture.directory,'plan-capture.json');
    const adapter=fixture.adapter({env:{FAKE_AGY_CAPTURE:capturePath}});
    const request={...execution(fixture.directory),executionProfile:{...execution(fixture.directory).executionProfile,workflowMode:'plan' as const}};
    const handle=await adapter.start(request);await collect(adapter.events(handle));
    const capture=JSON.parse(await readFile(capturePath,'utf8')) as {args:string[]};
    expect(capture.args.slice(0,3)).toEqual(['--dangerously-skip-permissions','--mode','plan']);
  });

  it('streams assistant text, tool lifecycle and terminal usage before completion',async()=>{
    const fixture=await fakeAgy();
    const messages=[
      {event:'init',conversation_id:'conversation-stream'},
      {event:'step_update',step_update:{step_index:2,state:'ACTIVE',step_type:'agent_response',text_delta:'Working '}},
      {event:'step_update',step_update:{step_index:3,state:'ACTIVE',step_type:'tool',tool_name:'run_command',tool_info:{name:'run_command',parameters:{CommandLine:'npm test'}}}},
      {event:'step_update',step_update:{step_index:3,state:'DONE',step_type:'tool',tool_name:'run_command',tool_info:{name:'run_command',parameters:{CommandLine:'npm test'},output:'passed'}}},
      {event:'step_update',step_update:{step_index:4,state:'DONE',step_type:'agent_response',text_delta:'done'}},
      {event:'result',result:{conversation_id:'conversation-stream',status:'SUCCESS',response:'Working done',usage:{input_tokens:20,output_tokens:4,total_tokens:24,thinking_tokens:2,cache_read_tokens:8}}},
    ];
    const adapter=fixture.adapter({env:{FAKE_AGY_RAW_OUTPUT:messages.map(value=>JSON.stringify(value)).join('\n')}}),handle=await adapter.start(execution(fixture.directory));
    await expect(collect(adapter.events(handle))).resolves.toEqual([
      {type:'output.text.delta',payload:{text:'Working '}},
      {type:'tool.started',payload:{toolId:'agy-step-3',name:'run_command',safeSummary:'run_command running',safeInput:'{"CommandLine":"npm test"}'}},
      {type:'tool.completed',payload:{toolId:'agy-step-3',name:'run_command',safeSummary:'run_command completed',safeInput:'{"CommandLine":"npm test"}'}},
      {type:'output.text.delta',payload:{text:'done'}},
      {type:'usage.updated',payload:{usage:{inputTokens:20,outputTokens:4,totalTokens:24,reasoningTokens:2,cacheReadTokens:8}}},
      {type:'execution.completed',payload:{continuation:{handle:expect.any(String)}}},
    ]);
  });

  it('routes tagged communication thoughts to reasoning without duplicating the terminal response',async()=>{
    const fixture=await fakeAgy(),raw='<communication_thought>Checking tests</communication_thought>Public update.\nFinal answer.';
    const messages=[
      {event:'step_update',step_update:{step_index:2,state:'ACTIVE',step_type:'agent_response',text_delta:'<communication_'}},
      {event:'step_update',step_update:{step_index:2,state:'DONE',step_type:'agent_response',text_delta:'thought>Checking tests</communication_thought>Public update.\n'}},
      {event:'result',result:{conversation_id:'conversation-reasoning',status:'SUCCESS',response:raw,usage:{input_tokens:12,output_tokens:4,thinking_tokens:3}}},
    ];
    const adapter=fixture.adapter({env:{FAKE_AGY_RAW_OUTPUT:messages.map(value=>JSON.stringify(value)).join('\n')}}),handle=await adapter.start(execution(fixture.directory));
    await expect(collect(adapter.events(handle))).resolves.toEqual([
      {type:'output.reasoning.delta',payload:{text:'Checking tests'}},
      {type:'output.text.delta',payload:{text:'Public update.\n'}},
      {type:'output.text.delta',payload:{text:'Final answer.'}},
      {type:'usage.updated',payload:{usage:{inputTokens:12,outputTokens:4,reasoningTokens:3}}},
      {type:'execution.completed',payload:{continuation:{handle:expect.any(String)}}},
    ]);
  });

  it('fails closed for unsupported modes, oversized prompts, empty output and non-zero exits', async () => {
    const fixture = await fakeAgy();
    const adapter = fixture.adapter({ env: {}, maxPromptBytes: 300 });
    await expect(adapter.start({...execution(fixture.directory),executionId:'invalid-mode',executionProfile:{...execution(fixture.directory).executionProfile,permissionProfileId:'unknown'}})).rejects.toThrow('permission profile is invalid');
    await expect(adapter.start({ ...execution(fixture.directory), executionId: 'large', input: { systemPrompt: '', history: [], message: 'x'.repeat(400) } })).rejects.toThrow('argv boundary');

    const empty = fixture.adapter({ env: { FAKE_AGY_OUTPUT: '' } });
    const emptyHandle = await empty.start({ ...execution(fixture.directory), executionId: 'empty' });
    await expect(collect(empty.events(emptyHandle))).resolves.toEqual([{ type: 'execution.failed', payload: { error: { code: 'agy_empty_output', message: expect.any(String) } } }]);

    const invalid = fixture.adapter({ env: { FAKE_AGY_RAW_OUTPUT: 'not-json' } });
    const invalidHandle=await invalid.start({...execution(fixture.directory),executionId:'invalid-output'});
    await expect(collect(invalid.events(invalidHandle))).resolves.toEqual([{type:'execution.failed',payload:{error:{code:'agy_invalid_output',message:expect.any(String)}}}]);

    const failed = fixture.adapter({ env: { FAKE_AGY_EXIT: '7', FAKE_AGY_STDERR: 'token=secret-value failed' } });
    const failedHandle = await failed.start({ ...execution(fixture.directory), executionId: 'failed' });
    await expect(collect(failed.events(failedHandle))).resolves.toEqual([{ type: 'execution.failed', payload: { error: { code: 'agy_execution_failed', message: 'token=[REDACTED] failed' } } }]);
  });

  it('completes with a warning when AGY recovers from its artifact-only write tool error',async()=>{
    const fixture=await fakeAgy(),response='Final answer';
    const messages=[
      {event:'step_update',step_update:{step_index:196,state:'DONE',step_type:'agent_response',text_delta:response}},
      {event:'result',result:{conversation_id:'conversation-recovered',status:'ERROR',response,error:'declaring permissions: cortex tool write_to_file: invalid tool call error (invalid_args) C:\\workspace\\test.js is not a valid artifact path; artifacts must be in C:\\brain'}},
    ];
    const stderr='declaring permissions: cortex tool write_to_file: convert tool call for permissions: model output error: invalid tool call error (invalid_args) C:\\workspace\\test.js is not a valid artifact path; artifacts must be in C:\\brain';
    const adapter=fixture.adapter({env:{FAKE_AGY_EXIT:'1',FAKE_AGY_STDERR:stderr,FAKE_AGY_RAW_OUTPUT:messages.map(value=>JSON.stringify(value)).join('\n')}}),handle=await adapter.start({...execution(fixture.directory),executionId:'recovered-artifact-write'});

    await expect(collect(adapter.events(handle))).resolves.toEqual([
      {type:'output.text.delta',payload:{text:response}},
      {type:'execution.completed',payload:{continuation:{handle:expect.any(String)},warning:{code:'agy_recovered_artifact_write',message:'Antigravity rejected an intermediate write_to_file call outside its artifact directory, then continued and produced the final response.'}}},
    ]);
  });

  it('completes with a warning when AGY continues after a structured tool failure',async()=>{
    const fixture=await fakeAgy(),response='The search tool was unavailable, so I inspected the files directly. Final answer.';
    const messages=[
      {event:'step_update',step_update:{step_index:3,state:'ACTIVE',step_type:'tool',tool_name:'grep_search'}},
      {event:'step_update',step_update:{step_index:3,state:'ERROR',step_type:'tool',tool_name:'grep_search'}},
      {event:'step_update',step_update:{step_index:4,state:'DONE',step_type:'agent_response',text_delta:response}},
      {event:'result',result:{conversation_id:'conversation-recovered-tool',status:'ERROR',response,error:'exec: "grep": executable file not found in %PATH%'}},
    ];
    const adapter=fixture.adapter({env:{FAKE_AGY_EXIT:'1',FAKE_AGY_STDERR:'exec: "grep": executable file not found in %PATH%',FAKE_AGY_RAW_OUTPUT:messages.map(value=>JSON.stringify(value)).join('\n')}}),handle=await adapter.start({...execution(fixture.directory),executionId:'recovered-tool-failure'});

    await expect(collect(adapter.events(handle))).resolves.toEqual([
      {type:'tool.started',payload:{toolId:'agy-step-3',name:'grep_search',safeSummary:'grep_search running'}},
      {type:'tool.failed',payload:{toolId:'agy-step-3',name:'grep_search',safeSummary:'grep_search failed'}},
      {type:'output.text.delta',payload:{text:response}},
      {type:'execution.completed',payload:{continuation:{handle:expect.any(String)},warning:{code:'agy_recovered_tool_failure',message:'Antigravity reported that an intermediate tool call failed, then continued and produced the final response.'}}},
    ]);
  });

  it('does not recover when AGY only emitted text before the tool failure',async()=>{
    const fixture=await fakeAgy(),response='I will search the project.';
    const messages=[
      {event:'step_update',step_update:{step_index:2,state:'DONE',step_type:'agent_response',text_delta:response}},
      {event:'step_update',step_update:{step_index:3,state:'ERROR',step_type:'tool',tool_name:'grep_search'}},
      {event:'result',result:{conversation_id:'conversation-failed-tool',status:'ERROR',response,error:'exec: "grep": executable file not found in %PATH%'}},
    ];
    const adapter=fixture.adapter({env:{FAKE_AGY_EXIT:'1',FAKE_AGY_STDERR:'exec: "grep": executable file not found in %PATH%',FAKE_AGY_RAW_OUTPUT:messages.map(value=>JSON.stringify(value)).join('\n')}}),handle=await adapter.start({...execution(fixture.directory),executionId:'unrecovered-tool-failure'});

    await expect(collect(adapter.events(handle))).resolves.toEqual([
      {type:'output.text.delta',payload:{text:response}},
      {type:'tool.failed',payload:{toolId:'agy-step-3',name:'grep_search',safeSummary:'grep_search failed'}},
      {type:'execution.failed',payload:{error:{code:'agy_execution_failed',message:'exec: "grep": executable file not found in %PATH%'}}},
    ]);
  });

  it('keeps the current request and newest contiguous history inside the command-line boundary',async()=>{
    const fixture=await fakeAgy(),capturePath=join(fixture.directory,'bounded-capture.json');
    const adapter=fixture.adapter({env:{FAKE_AGY_CAPTURE:capturePath},maxCommandChars:4_000});
    const request={...execution(fixture.directory),executionId:'bounded',input:{systemPrompt:'Act as coder.',history:Array.from({length:8},(_,index)=>({role:index%2?'assistant' as const:'user' as const,content:`history-${index}-`+'x'.repeat(700)})),message:'Keep this current request.'}};
    const handle=await adapter.start(request);await collect(adapter.events(handle));
    const capture=JSON.parse(await readFile(capturePath,'utf8')) as{args:string[]};
    const prompt=capture.args.at(-1)!,payload=JSON.parse(prompt.split('\n')[1]!) as{conversationHistory:Array<{content:string}>;currentUserMessage:string};
    expect(payload.currentUserMessage).toBe('Keep this current request.');
    expect(payload.conversationHistory.length).toBeGreaterThan(0);
    expect(payload.conversationHistory.at(-1)?.content).toContain('history-7-');
    expect(payload.conversationHistory[0]?.content).not.toContain('history-0-');
    expect(windowsCommandLineLength(process.execPath,[join(fixture.directory,'agy.cjs'),...capture.args])).toBeLessThanOrEqual(4_000);
  });

  it('terminates a stubborn process tree and reports cancellation', async () => {
    const fixture = await fakeAgy();
    const capturePath = join(fixture.directory, 'capture.json');
    const adapter = fixture.adapter({ env: { FAKE_AGY_CAPTURE: capturePath, FAKE_AGY_BEHAVIOR: 'hang' }, stopGraceMs: 25 });
    const handle = await adapter.start({ ...execution(fixture.directory), executionId: 'cancelled' });
    await waitForFile(capturePath);
    const eventsPromise = collect(adapter.events(handle));
    await adapter.stop(handle);
    await expect(eventsPromise).resolves.toEqual([{ type: 'execution.cancelled', payload: {} }]);
    await expect(adapter.inspect(handle)).rejects.toThrow('not active');
  });

  it('streams active text and tool progress before cancellation',async()=>{
    const fixture=await fakeAgy(),capturePath=join(fixture.directory,'stream-hang.json'),messages=[
      {event:'step_update',step_update:{step_index:1,state:'ACTIVE',step_type:'agent_response',text_delta:'Still working'}},
      {event:'step_update',step_update:{step_index:2,state:'ACTIVE',step_type:'tool',tool_name:'run_command',tool_info:{parameters:{CommandLine:'node server.mjs'}}}},
      {event:'step_update',step_update:{step_index:3,state:'ACTIVE',step_type:'agent_response',text_delta:'<communication_thought>Waiting'}},
    ];
    const adapter=fixture.adapter({env:{FAKE_AGY_CAPTURE:capturePath,FAKE_AGY_BEHAVIOR:'stream-hang',FAKE_AGY_RAW_OUTPUT:messages.map(value=>JSON.stringify(value)).join('\n')},stopGraceMs:25}),handle=await adapter.start({...execution(fixture.directory),executionId:'stream-cancelled'});
    await waitForFile(capturePath);const eventsPromise=collect(adapter.events(handle));
    await new Promise(resolve=>setTimeout(resolve,25));await adapter.stop(handle);
    await expect(eventsPromise).resolves.toEqual([
      {type:'output.text.delta',payload:{text:'Still working'}},
      {type:'tool.started',payload:{toolId:'agy-step-2',name:'run_command',safeSummary:'run_command running',safeInput:'{"CommandLine":"node server.mjs"}'}},
      {type:'output.text.delta',payload:{text:'<communication_thought>Waiting'}},
      {type:'execution.cancelled',payload:{}},
    ]);
  });
});

function execution(workspace: string): AdapterStartExecutionRequest {
  return {
    executionId: 'run-agy-1', harnessInstanceId: 'local-antigravity', modelId: 'Gemini 3.5 Flash (High)', executionProfile:{workflowMode:'work',reasoningEffort:null,permissionProfileId:'accept-edits',agentVariantId:null,planEnforcement:null},
    workspace: { roomId: 'room-1', relativePath: '.', absolutePath: workspace },
    input: { systemPrompt: 'Act as coder.', history: [{ role: 'user', content: 'Earlier' }], message: 'Implement it.' },
  };
}

async function collect(source:AsyncIterable<AdapterExecutionEvent>){const values:AdapterExecutionEvent[]=[];for await(const value of source)values.push(value);return values;}
function continuationHandle(events:AdapterExecutionEvent[]){const terminal=events.at(-1);if(terminal?.type!=='execution.completed'||!terminal.payload.continuation)throw new Error('Expected AGY continuation handle');return terminal.payload.continuation.handle;}

async function fakeAgy() {
  const directory = await mkdtemp(join(tmpdir(), 'agenvyl-agy-'));
  directories.push(directory);
  const script = join(directory, 'agy.cjs');
  await writeFile(script, `
const { appendFileSync, closeSync, openSync, unlinkSync, writeFileSync } = require('node:fs');
const args=process.argv.slice(2);
if(process.env.FAKE_AGY_LOCK){
  try{closeSync(openSync(process.env.FAKE_AGY_LOCK,'wx'))}catch{process.stderr.write('concurrent agy invocation');process.exit(9)}
  process.on('exit',()=>{try{unlinkSync(process.env.FAKE_AGY_LOCK)}catch{}});
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
}
if(args[0]==='--version'){console.log(process.env.FAKE_AGY_VERSION||'1.1.8');process.exit(0)}
if(args[0]==='models'){process.stdout.write(process.env.FAKE_AGY_MODELS||'Gemini 3.5 Flash (High)\\n');process.exit(0)}
if(process.env.FAKE_AGY_CAPTURE){const captured=JSON.stringify({args,cwd:process.cwd(),disableAutoUpdate:process.env.AGY_CLI_DISABLE_AUTO_UPDATE,pid:process.pid});if(process.env.FAKE_AGY_CAPTURE_APPEND)appendFileSync(process.env.FAKE_AGY_CAPTURE,captured+'\\n');else writeFileSync(process.env.FAKE_AGY_CAPTURE,captured)}
if(process.env.FAKE_AGY_BEHAVIOR==='hang'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000)}
else if(process.env.FAKE_AGY_BEHAVIOR==='stream-hang'){process.stdout.write(process.env.FAKE_AGY_RAW_OUTPUT+'\\n');process.on('SIGTERM',()=>{});setInterval(()=>{},1000)}
else{if(process.env.FAKE_AGY_STDERR)process.stderr.write(process.env.FAKE_AGY_STDERR);const response=process.env.FAKE_AGY_OUTPUT??'ok',conversationId=process.env.FAKE_AGY_CONVERSATION_ID||'conversation-1',output=process.env.FAKE_AGY_RAW_OUTPUT??[JSON.stringify({event:'init',conversation_id:conversationId}),JSON.stringify({event:'result',result:{conversation_id:conversationId,status:process.env.FAKE_AGY_STATUS||'SUCCESS',response}})].join('\\n');process.stdout.write(output);process.exit(Number(process.env.FAKE_AGY_EXIT||0))}
`);
  return {
    directory,
    adapter: (options: Omit<import('./adapter.js').AntigravityAdapterOptions, 'command' | 'commandArgsPrefix'>) => new AntigravityConnectorAdapter({ ...options, command: process.execPath, commandArgsPrefix: [script] }),
  };
}

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await readFile(path); return; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  throw new Error('Timed out waiting for fake AGY process');
}
