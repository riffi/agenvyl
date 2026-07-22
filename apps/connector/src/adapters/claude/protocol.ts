import {StringDecoder} from 'node:string_decoder';

export const CLAUDE_MAX_LINE_BYTES=2*1024*1024;
export const CLAUDE_MAX_BUFFER_BYTES=4*1024*1024;

export type ClaudeMessage=Record<string,unknown>;

export class BoundedNdjsonDecoder{
  private readonly decoder=new StringDecoder('utf8');
  private buffered='';
  constructor(private readonly maxLineBytes=CLAUDE_MAX_LINE_BYTES,private readonly maxBufferBytes=CLAUDE_MAX_BUFFER_BYTES){}
  push(chunk:Buffer|string){
    this.buffered+=typeof chunk==='string'?chunk:this.decoder.write(chunk);
    if(Buffer.byteLength(this.buffered,'utf8')>this.maxBufferBytes)throw new Error('Claude protocol buffer limit exceeded');
    const messages:ClaudeMessage[]=[];
    for(;;){const index=this.buffered.indexOf('\n');if(index<0)break;const line=this.buffered.slice(0,index).replace(/\r$/,'');this.buffered=this.buffered.slice(index+1);if(!line.trim())continue;messages.push(parseLine(line,this.maxLineBytes));}
    return messages;
  }
  end(){this.buffered+=this.decoder.end();if(!this.buffered.trim())return[];const message=parseLine(this.buffered.replace(/\r$/,''),this.maxLineBytes);this.buffered='';return[message];}
}

export function controlRequest(requestId:string,request:Record<string,unknown>){return{type:'control_request',request_id:requestId,request};}
export function controlResponse(requestId:string,response:Record<string,unknown>){return{type:'control_response',response:{subtype:'success',request_id:requestId,response}};}
export function userFrame(sessionId:string,message:string){return{type:'user',message:{role:'user',content:message},parent_tool_use_id:null,session_id:sessionId};}

export function initializeResponse(message:unknown,requestId:string){
  const root=record(message),response=record(root?.response),payload=record(response?.response);
  if(root?.type!=='control_response'||response?.subtype!=='success'||response?.request_id!==requestId||!payload||!Array.isArray(payload.models))return;
  return{models:payload.models,account:record(payload.account)};
}

function parseLine(line:string,maxBytes:number):ClaudeMessage{
  if(Buffer.byteLength(line,'utf8')>maxBytes)throw new Error('Claude protocol line limit exceeded');
  let value:unknown;try{value=JSON.parse(line);}catch{throw new Error('Claude protocol emitted malformed NDJSON');}
  const message=record(value);if(!message||typeof message.type!=='string'||message.type.length>128)throw new Error('Claude protocol message is invalid');
  return message;
}
export function record(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
