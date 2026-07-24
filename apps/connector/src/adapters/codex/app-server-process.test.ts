import {chmod,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {CodexAppServerClient} from './app-server-client.js';

const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

describe('Codex app-server subprocess protocol',()=>{
  it('opts into the experimental API, parses fragmented JSONL and correlates out-of-order responses',async()=>{const root=await mkdtemp(join(tmpdir(),'agenvyl-codex-process-'));roots.push(root);const fixture=join(root,'fixture.mjs'),command=process.platform==='win32'?join(root,'codex.cmd'):join(root,'codex');await writeFile(fixture,serverSource);if(process.platform==='win32')await writeFile(command,`@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);else{await writeFile(command,`#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);await chmod(command,0o755);}const client=new CodexAppServerClient(command);try{await client.start();const [first,second]=await Promise.all([client.request('echo',{value:'first'}),client.request('echo',{value:'second'})]);expect(first).toEqual({value:'first'});expect(second).toEqual({value:'second'});}finally{await client.close();}});
  it('terminates descendants that hold a run workspace as their current directory',async()=>{
    const root=await mkdtemp(join(tmpdir(),'agenvyl-codex-tree-'));roots.push(root);
    const workspace=join(root,'workspace'),pidFile=join(root,'child.pid'),fixture=join(root,'fixture.mjs'),command=process.platform==='win32'?join(root,'codex.cmd'):join(root,'codex');
    await mkdir(workspace);await writeFile(fixture,treeServerSource);
    if(process.platform==='win32')await writeFile(command,`@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
    else{await writeFile(command,`#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);await chmod(command,0o755);}
    const client=new CodexAppServerClient(command,{...process.env,AGENVYL_TEST_HOLD_CWD:workspace,AGENVYL_TEST_CHILD_PID_FILE:pidFile});
    await client.start();
    const childPid=Number(await readFile(pidFile,'utf8'));expect(processExists(childPid)).toBe(true);
    await client.close();
    await expect.poll(()=>processExists(childPid),{timeout:5_000}).toBe(false);
    await expect(rm(workspace,{recursive:true})).resolves.toBeUndefined();
  });
});

const serverSource=`
import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});let echoes=[];
const send=value=>{const text=JSON.stringify(value)+'\\n',middle=Math.floor(text.length/2);process.stdout.write(text.slice(0,middle));setTimeout(()=>process.stdout.write(text.slice(middle)),2);};
lines.on('line',line=>{const message=JSON.parse(line);if(message.method==='initialize'){if(message.params?.capabilities?.experimentalApi!==true){send({id:message.id,error:{code:-32602,message:'experimentalApi capability required'}});return;}send({id:message.id,result:{serverInfo:{name:'fixture'}}});return;}if(message.method==='echo'){echoes.push(message);if(echoes.length===2){const [first,second]=echoes;send({id:second.id,result:second.params});setTimeout(()=>send({id:first.id,result:first.params}),5);}}});
`;

const treeServerSource=`
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import readline from 'node:readline';
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:process.env.AGENVYL_TEST_HOLD_CWD,stdio:'ignore'});
writeFileSync(process.env.AGENVYL_TEST_CHILD_PID_FILE,String(child.pid));
const lines=readline.createInterface({input:process.stdin});
lines.on('line',line=>{const message=JSON.parse(line);if(message.method==='initialize')process.stdout.write(JSON.stringify({id:message.id,result:{serverInfo:{name:'tree-fixture'}}})+'\\n');});
`;

const processExists=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
