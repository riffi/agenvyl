import {execFile} from 'node:child_process';
import {mkdir,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

const execute=promisify(execFile);

export type ManagedProcessIdentity={
  pid:number;
  startTime:string;
  executable:string;
  arguments:string[];
};

export type ManagedServerOwnership=ManagedProcessIdentity&{
  version:1;
  instanceId:string;
  endpoint:string;
  canonicalExecutable:string;
  expectedArguments:string[];
  ownerToken:string;
};

export class ManagedServerOwnershipStore{
  constructor(private readonly directory:string){}

  async read(instanceId:string){
    try{
      const value=JSON.parse(await readFile(this.file(instanceId),'utf8')) as unknown;
      return validOwnership(value)?value:undefined;
    }catch{return undefined;}
  }

  async write(record:ManagedServerOwnership){
    await mkdir(this.directory,{recursive:true});
    const target=this.file(record.instanceId),temporary=`${target}.${process.pid}.${record.ownerToken}.tmp`;
    await writeFile(temporary,`${JSON.stringify(record,null,2)}\n`,{encoding:'utf8',mode:0o600});
    await rename(temporary,target);
  }

  remove(instanceId:string){return rm(this.file(instanceId),{force:true});}

  private file(instanceId:string){return path.join(this.directory,`${instanceId}.json`);}
}

export const inspectManagedProcess=async(pid:number,platform:NodeJS.Platform=process.platform):Promise<ManagedProcessIdentity|undefined>=>{
  if(!Number.isSafeInteger(pid)||pid<1)return undefined;
  try{
    if(platform==='linux')return await inspectLinuxProcess(pid);
    if(platform==='win32')return await inspectWindowsProcess(pid);
    return await inspectPosixProcess(pid);
  }catch{return undefined;}
};

export const sameManagedProcess=(record:ManagedServerOwnership,current:ManagedProcessIdentity|undefined)=>Boolean(current
  &&record.pid===current.pid
  &&record.startTime===current.startTime
  &&pathKey(record.executable)===pathKey(current.executable)
  &&JSON.stringify(record.arguments)===JSON.stringify(current.arguments));

const inspectLinuxProcess=async(pid:number):Promise<ManagedProcessIdentity>=>{
  const [stat,executable,commandLine]=await Promise.all([
    readFile(`/proc/${pid}/stat`,'utf8'),
    realpath(`/proc/${pid}/exe`),
    readFile(`/proc/${pid}/cmdline`),
  ]);
  const close=stat.lastIndexOf(')'),fields=stat.slice(close+2).split(' '),startTime=fields[19];
  if(!startTime)throw new Error('Process start time is unavailable');
  const command=commandLine.toString('utf8').split('\0').filter(Boolean);
  return{pid,startTime,executable,arguments:command.slice(1)};
};

const inspectWindowsProcess=async(pid:number):Promise<ManagedProcessIdentity>=>{
  const script=`$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\";if($p){[pscustomobject]@{startTime=$p.CreationDate.ToUniversalTime().ToString('O');executable=$p.ExecutablePath;commandLine=$p.CommandLine}|ConvertTo-Json -Compress}`;
  const{stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:3_000});
  const value=JSON.parse(stdout) as{startTime?:unknown;executable?:unknown;commandLine?:unknown};
  if(typeof value.startTime!=='string'||typeof value.executable!=='string'||typeof value.commandLine!=='string')throw new Error('Process identity is unavailable');
  return{pid,startTime:value.startTime,executable:value.executable,arguments:splitWindowsCommandLine(value.commandLine).slice(1)};
};

const inspectPosixProcess=async(pid:number):Promise<ManagedProcessIdentity>=>{
  const{stdout}=await execute('ps',['-p',String(pid),'-o','lstart=','-o','command='],{timeout:3_000});
  const line=stdout.trim(),match=line.match(/^(.{24})\s+(.+)$/);
  if(!match)throw new Error('Process identity is unavailable');
  const command=splitPosixCommandLine(match[2]);
  return{pid,startTime:match[1].trim(),executable:await realpath(command[0]!),arguments:command.slice(1)};
};

const validOwnership=(value:unknown):value is ManagedServerOwnership=>isRecord(value)&&value.version===1
  &&typeof value.instanceId==='string'&&typeof value.endpoint==='string'&&typeof value.ownerToken==='string'
  &&typeof value.canonicalExecutable==='string'&&strings(value.expectedArguments)
  &&Number.isSafeInteger(value.pid)&&Number(value.pid)>0&&typeof value.startTime==='string'
  &&typeof value.executable==='string'&&strings(value.arguments);

const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(item=>typeof item==='string');
const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const pathKey=(value:string)=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
const splitWindowsCommandLine=(value:string)=>value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(item=>item.replace(/^"|"$/g,''))??[];
const splitPosixCommandLine=(value:string)=>value.match(/(?:[^\s'"\\]+|\\.|'(?:[^']*)'|"(?:[^"\\]|\\.)*")+/g)?.map(item=>item.replace(/^['"]|['"]$/g,''))??[];
