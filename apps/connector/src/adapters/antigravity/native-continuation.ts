import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import type {AdapterStartExecutionRequest} from '../../adapter.js';

export type AntigravityContinuationHandle={
  v:1;
  harness:'antigravity';
  instanceId:string;
  conversationId:string;
  directory:string;
  storageScopeHash:string;
  configurationHash:string;
};

export const antigravityStorageScopeHash=(input:{command:string;commandArgsPrefix:string[];platform:NodeJS.Platform;env:NodeJS.ProcessEnv})=>createHash('sha256').update(JSON.stringify({
  protocol:'antigravity-json-print-v1',
  command:input.command,
  commandArgsPrefix:input.commandArgsPrefix,
  platform:input.platform,
  userProfile:input.env.USERPROFILE??null,
  home:input.env.HOME??null,
})).digest('hex');

export const antigravityContinuationConfiguration=(request:AdapterStartExecutionRequest)=>createHash('sha256').update(JSON.stringify({
  harness:'antigravity',
  instanceId:request.harnessInstanceId,
  modelId:request.modelId,
  executionProfile:request.executionProfile,
  workspace:{
    roomId:request.workspace.roomId,
    absolutePath:request.workspace.absolutePath,
    roomAbsolutePath:request.workspace.roomAbsolutePath??request.workspace.absolutePath,
    project:request.workspace.project??null,
  },
  systemPrompt:request.input.systemPrompt,
})).digest('hex');

export const encodeAntigravityContinuationHandle=(value:AntigravityContinuationHandle)=>Buffer.from(JSON.stringify(value),'utf8').toString('base64url');

export const parseAntigravityContinuationHandle=(handle:string):AntigravityContinuationHandle|undefined=>{
  try{
    const value=record(JSON.parse(Buffer.from(handle,'base64url').toString('utf8')));
    if(value?.v!==1||value.harness!=='antigravity'||!shortString(value.instanceId)||!shortString(value.conversationId)||!shortString(value.directory)||typeof value.storageScopeHash!=='string'||typeof value.configurationHash!=='string')return;
    return value as AntigravityContinuationHandle;
  }catch{return;}
};

const record=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const shortString=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=4_096;
