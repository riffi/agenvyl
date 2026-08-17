import {Buffer} from 'node:buffer';
import {StringDecoder} from 'node:string_decoder';
import type {TokenUsage} from '@agenvyl/connector-contract';

export type AntigravityMessage=Record<string,unknown>;
export type AntigravityResult={conversationId:string;status:string;response:string;error?:string;usage?:TokenUsage};

export class AntigravityProtocolError extends Error{
  constructor(readonly code:'agy_invalid_output'|'agy_output_too_large',message:string){super(message);this.name='AntigravityProtocolError';}
}

export class AntigravityNdjsonDecoder{
  private readonly decoder=new StringDecoder('utf8');
  private buffered='';
  private bytes=0;
  constructor(private readonly maxLineBytes=256*1_024,private readonly maxOutputBytes=1*1_024*1_024){}

  push(chunk:Buffer|string){
    const value=typeof chunk==='string'?Buffer.from(chunk):chunk;
    this.bytes+=value.length;
    if(this.bytes>this.maxOutputBytes)throw new AntigravityProtocolError('agy_output_too_large','Antigravity output exceeded the Connector limit');
    this.buffered+=typeof chunk==='string'?chunk:this.decoder.write(chunk);
    return this.drain(false);
  }

  finish(){
    this.buffered+=this.decoder.end();
    return this.drain(true);
  }

  private drain(finished:boolean){
    const messages:AntigravityMessage[]=[];
    for(;;){
      const index=this.buffered.indexOf('\n');
      if(index<0)break;
      const line=this.buffered.slice(0,index).replace(/\r$/,'');
      this.buffered=this.buffered.slice(index+1);
      if(line.trim())messages.push(parseLine(line,this.maxLineBytes));
    }
    if(finished&&this.buffered.trim())messages.push(parseLine(this.buffered.replace(/\r$/,''),this.maxLineBytes));
    if(finished)this.buffered='';
    if(Buffer.byteLength(this.buffered,'utf8')>this.maxLineBytes)throw new AntigravityProtocolError('agy_invalid_output','Antigravity stream-json event exceeded the Connector line limit');
    return messages;
  }
}

export const antigravityText=(message:AntigravityMessage)=>{
  const update=stepUpdate(message);
  return update?.step_type==='agent_response'&&typeof update.text_delta==='string'?update.text_delta:'';
};

export const antigravityTool=(message:AntigravityMessage)=>{
  const update=stepUpdate(message);
  if(update?.step_type!=='tool')return;
  const info=record(update.tool_info),index=integer(update.step_index),name=shortString(update.tool_name)??shortString(info?.name);
  const state=update.state==='ERROR'?'failed':update.state==='DONE'?'completed':update.state==='ACTIVE'?'active':undefined;
  if(!state)return;
  return{id:`agy-step-${index??'unknown'}`,name,state,parameters:info?.parameters};
};

export const antigravityResult=(message:AntigravityMessage):AntigravityResult|undefined=>{
  if(message.event!=='result')return;
  const value=record(message.result),conversationId=shortString(value?.conversation_id),status=shortString(value?.status);
  if(!value||!conversationId||!status||typeof value.response!=='string')return;
  const error=typeof value.error==='string'?value.error:undefined,usage=tokenUsage(value.usage);
  return{conversationId,status,response:value.response,...(error?{error}:{}),...(usage?{usage}:{})};
};

const stepUpdate=(message:AntigravityMessage)=>message.event==='step_update'?record(message.step_update):undefined;

const tokenUsage=(value:unknown):TokenUsage|undefined=>{
  const usage=record(value),inputTokens=nonnegative(usage?.input_tokens),outputTokens=nonnegative(usage?.output_tokens);
  if(inputTokens===undefined||outputTokens===undefined)return;
  const totalTokens=nonnegative(usage?.total_tokens),reasoningTokens=nonnegative(usage?.thinking_tokens),cacheReadTokens=nonnegative(usage?.cache_read_tokens),cacheWriteTokens=nonnegative(usage?.cache_write_tokens);
  return{inputTokens,outputTokens,...(totalTokens===undefined?{}:{totalTokens}),...(reasoningTokens===undefined?{}:{reasoningTokens}),...(cacheReadTokens===undefined?{}:{cacheReadTokens}),...(cacheWriteTokens===undefined?{}:{cacheWriteTokens})};
};

const parseLine=(line:string,maxBytes:number):AntigravityMessage=>{
  if(Buffer.byteLength(line,'utf8')>maxBytes)throw new AntigravityProtocolError('agy_invalid_output','Antigravity stream-json event exceeded the Connector line limit');
  let value:unknown;
  try{value=JSON.parse(line);}catch{throw new AntigravityProtocolError('agy_invalid_output','Antigravity CLI emitted malformed stream-json');}
  const message=record(value);
  if(!message||typeof message.event!=='string')throw new AntigravityProtocolError('agy_invalid_output','Antigravity CLI emitted an invalid stream-json event');
  return message;
};

const record=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const shortString=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=4_096?value:undefined;
const integer=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0?Number(value):undefined;
const nonnegative=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:undefined;
