import {chmod,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {CodexAppServerClient} from './app-server-client.js';

const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

describe('Codex app-server subprocess protocol',()=>{
  it('handshakes, parses fragmented JSONL and correlates out-of-order responses',async()=>{const root=await mkdtemp(join(tmpdir(),'agenvyl-codex-process-'));roots.push(root);const fixture=join(root,'fixture.mjs'),command=process.platform==='win32'?join(root,'codex.cmd'):join(root,'codex');await writeFile(fixture,serverSource);if(process.platform==='win32')await writeFile(command,`@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);else{await writeFile(command,`#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);await chmod(command,0o755);}const client=new CodexAppServerClient(command);try{await client.start();const [first,second]=await Promise.all([client.request('echo',{value:'first'}),client.request('echo',{value:'second'})]);expect(first).toEqual({value:'first'});expect(second).toEqual({value:'second'});}finally{await client.close();}});
});

const serverSource=`
import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});let echoes=[];
const send=value=>{const text=JSON.stringify(value)+'\\n',middle=Math.floor(text.length/2);process.stdout.write(text.slice(0,middle));setTimeout(()=>process.stdout.write(text.slice(middle)),2);};
lines.on('line',line=>{const message=JSON.parse(line);if(message.method==='initialize'){send({id:message.id,result:{serverInfo:{name:'fixture'}}});return;}if(message.method==='echo'){echoes.push(message);if(echoes.length===2){const [first,second]=echoes;send({id:second.id,result:second.params});setTimeout(()=>send({id:first.id,result:first.params}),5);}}});
`;
