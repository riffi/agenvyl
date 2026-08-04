import {Buffer} from 'node:buffer';

export type CursorMessage=Record<string,unknown>;

export class CursorNdjsonDecoder{
  private pending='';
  private bytes=0;
  constructor(private readonly maxLineBytes=256*1_024,private readonly maxOutputBytes=2*1_024*1_024){}

  push(chunk:Buffer|string):CursorMessage[]{
    const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    this.bytes+=value.length;
    if(this.bytes>this.maxOutputBytes)throw new Error('Cursor output exceeded the Connector limit');
    this.pending+=value.toString('utf8');
    const lines=this.pending.split(/\r?\n/);this.pending=lines.pop()??'';
    return lines.filter(line=>line.trim()).map(line=>this.parse(line));
  }

  finish():CursorMessage[]{
    if(!this.pending.trim())return[];
    const line=this.pending;this.pending='';return[this.parse(line)];
  }

  private parse(line:string):CursorMessage{
    if(Buffer.byteLength(line,'utf8')>this.maxLineBytes)throw new Error('Cursor event exceeded the Connector line limit');
    let value:unknown;try{value=JSON.parse(line);}catch{throw new Error('Cursor CLI emitted malformed stream-json');}
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Cursor CLI emitted an invalid stream-json event');
    return value as CursorMessage;
  }
}

export const cursorText=(message:CursorMessage)=>{
  if(message.type!=='assistant')return'';
  const body=record(message.message),content=body&&Array.isArray(body.content)?body.content:[];
  return content.map(item=>record(item)).filter(Boolean).filter(item=>item!.type==='text'&&typeof item!.text==='string').map(item=>String(item!.text)).join('');
};

export const cursorTool=(message:CursorMessage)=>{
  if(message.type!=='tool_call'||(message.subtype!=='started'&&message.subtype!=='completed'))return undefined;
  const call=record(message.tool_call),entry=call?Object.entries(call)[0]:undefined;
  if(!entry)return undefined;
  const [kind,detail]=entry,body=record(detail),args=body?.args;
  const rawName=kind.replace(/ToolCall$/,'').replace(/([a-z])([A-Z])/g,'$1 $2').trim();
  return{id:typeof message.call_id==='string'?message.call_id:kind,name:rawName||'Cursor tool',args,completed:message.subtype==='completed'};
};

export const cursorResult=(message:CursorMessage)=>message.type==='result'&&message.subtype==='success'&&message.is_error!==true
  ?{success:true as const,text:typeof message.result==='string'?message.result:''}
  :message.type==='result'?{success:false as const,text:typeof message.result==='string'?message.result:''}:undefined;

const record=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
