import {execFile} from 'node:child_process';
import {extname} from 'node:path';
import {promisify} from 'node:util';

const execute=promisify(execFile);
export type CommandExecutor=(file:string,args:string[],options:{timeout:number;windowsHide:boolean;windowsVerbatimArguments?:boolean;env:NodeJS.ProcessEnv})=>Promise<{stdout:string;stderr:string}>;

export async function resolveCommand(command:string,options:{platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;execute?:CommandExecutor}={}){
  const platform=options.platform??process.platform,env=options.env??process.env,run=options.execute??execute as CommandExecutor;
  if(platform!=='win32'||['.exe','.com','.cmd','.bat'].includes(extname(command).toLowerCase()))return command;
  const{stdout}=await run('where.exe',[command],executionOptions(env));
  const matches=stdout.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
  const resolved=matches.find(value=>['.exe','.com'].includes(extname(value).toLowerCase()))??matches.find(value=>['.cmd','.bat'].includes(extname(value).toLowerCase()));
  if(!resolved)throw new Error('Command is not available on PATH');
  return resolved;
}

export function commandInvocation(executable:string,args:string[],platform:NodeJS.Platform=process.platform,env:NodeJS.ProcessEnv=process.env){
  const extension=extname(executable).toLowerCase();
  if(platform!=='win32'||(extension!=='.cmd'&&extension!=='.bat'))return{file:executable,args};
  if(/["\r\n]/.test(executable)||args.some(value=>!/^[-A-Za-z0-9_.:\/\[\]]+$/.test(value)))throw new Error('Windows command invocation is invalid');
  return{file:env.ComSpec??env.COMSPEC??'cmd.exe',args:['/d','/s','/c',`""${executable}" ${args.join(' ')}"`],windowsVerbatimArguments:true};
}
export function executionOptions(env:NodeJS.ProcessEnv){return{timeout:3_000,windowsHide:true,env};}
