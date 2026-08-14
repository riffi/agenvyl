import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ConnectorDiscovery, HarnessDiscoveryCandidate, HarnessType } from '@agenvyl/connector-contract';
import { CONNECTOR_API_VERSION } from '@agenvyl/connector-contract';

const execute=promisify(execFile);
type VersionExecutor=(file:string,args:string[],options:{timeout:number;windowsHide:boolean;windowsVerbatimArguments?:boolean;env:NodeJS.ProcessEnv})=>Promise<{stdout:string;stderr:string}>;
export {commandInvocation,resolveCommand} from './command.js';
import {commandInvocation,executionOptions,resolveCommand} from './command.js';
import {ClaudeCliProcess} from './adapters/claude/process.js';

type ClaudeAuth={authenticated:boolean;kind:'api'|'cloud'|'subscription_oauth'|'none'|'unknown'};

export async function discoverHarnesses(options:{env?:NodeJS.ProcessEnv;request?:typeof fetch;run?:typeof runVersion;codexAuth?:typeof runCodexLoginStatus;claudeAuth?:typeof runClaudeAuthStatus;claudeProbe?:typeof runClaudeInitializeProbe;cursorAuth?:typeof runCursorStatus;cursorProbe?:typeof runCursorCompatibilityProbe;platform?:NodeJS.Platform}={}):Promise<ConnectorDiscovery>{
  const env=options.env??process.env,request=options.request??fetch,run=options.run??runVersion,platform=options.platform??process.platform;
  const definitions:Array<{type:HarnessType;label:string;command:string;endpoint?:string;managed:boolean}>=[
    {type:'hermes',label:'Hermes',command:env.AGENVYL_CONNECTOR_HERMES_COMMAND??'hermes',endpoint:env.AGENVYL_CONNECTOR_HERMES_URL??'http://127.0.0.1:8642',managed:false},
    {type:'opencode',label:'OpenCode',command:env.AGENVYL_CONNECTOR_OPENCODE_COMMAND??'opencode',endpoint:env.AGENVYL_CONNECTOR_OPENCODE_URL??'http://127.0.0.1:4096',managed:true},
    {type:'antigravity',label:'Antigravity (AGY)',command:env.AGENVYL_CONNECTOR_AGY_COMMAND??'agy',managed:false},
    {type:'codex',label:'Codex',command:env.AGENVYL_CONNECTOR_CODEX_COMMAND??'codex',managed:false},
    {type:'claude',label:'Claude Code (experimental)',command:env.AGENVYL_CONNECTOR_CLAUDE_COMMAND??'claude',managed:false},
    {type:'cursor',label:'Cursor CLI (experimental)',command:env.AGENVYL_CONNECTOR_CURSOR_COMMAND??'agent',managed:false},
  ];
  const candidates=await Promise.all(definitions.map(async definition=>{
    let cli=await run(definition.command,{env});
    if(definition.type==='cursor'&&!env.AGENVYL_CONNECTOR_CURSOR_COMMAND&&!cli.found)cli=await run('cursor-agent',{env});
    const endpoint=definition.endpoint?{url:definition.endpoint,reachable:await reachable(definition.endpoint,request)}:undefined;
    let compatible=definition.type==='antigravity'&&cli.found?versionAtLeast(cli.version,'1.1.8'):definition.type==='codex'&&cli.found?versionAtLeast(cli.version,'0.145.0'):definition.type==='claude'&&cli.found?versionAtLeast(cli.version,'2.1.217'):definition.type==='cursor'&&cli.found?cursorVersionSupported(cli.version):cli.found;
    const authorized=definition.type==='codex'&&compatible?await (options.codexAuth??runCodexLoginStatus)(definition.command,{env}):definition.type!=='codex';
    const auth=definition.type==='claude'&&compatible?await (options.claudeAuth??runClaudeAuthStatus)(definition.command,{env}):undefined;
    const protocol=definition.type==='claude'&&compatible&&auth?.authenticated?await (options.claudeProbe??runClaudeInitializeProbe)(definition.command,{env}):definition.type!=='claude';
    if(definition.type==='claude')compatible=compatible&&Boolean(protocol);
    const cursorAuthenticated=definition.type==='cursor'&&compatible?await (options.cursorAuth??runCursorStatus)(cli.command,{env,platform}):false;
    const cursorProtocol=definition.type==='cursor'&&compatible&&cursorAuthenticated?await (options.cursorProbe??runCursorCompatibilityProbe)(cli.command,{env,platform}):definition.type!=='cursor';
    if(definition.type==='cursor')compatible=compatible&&cursorProtocol;
    const safeToSelect=definition.type==='cursor'?compatible&&cursorAuthenticated:definition.type==='codex'?compatible&&authorized:definition.type==='claude'?compatible&&Boolean(auth?.authenticated):definition.type!=='antigravity'&&(Boolean(endpoint?.reachable)||definition.type==='opencode'&&cli.found);
    const warning=definition.type==='cursor'&&!cli.found?'Install Cursor CLI 2026.01.16 or newer and authenticate with agent login.':definition.type==='cursor'&&!cursorVersionSupported(cli.version)?'Cursor CLI 2026.01.16 or newer is required.':definition.type==='cursor'&&!cursorAuthenticated?'Authenticate in Cursor CLI before enabling this connector.':definition.type==='cursor'&&!cursorProtocol?'Cursor CLI headless protocol is incompatible.':definition.type==='cursor'?'Experimental Cursor CLI integration preserves Cursor rules, MCP servers, and hooks.':definition.type==='antigravity'&&!compatible?'AGY 1.1.8 or newer is required.':definition.type==='antigravity'?'AGY runs a subprocess per turn and requires separate permission confirmation.':definition.type==='codex'&&!cli.found?'Install Codex CLI 0.145.0 or newer and run codex login.':definition.type==='codex'&&!compatible?'Codex CLI 0.145.0 or newer is required.':definition.type==='codex'&&!authorized?'Run codex login before enabling this connector.':definition.type==='claude'&&!cli.found?'Install Claude Code CLI 2.1.217 or newer and authenticate it.':definition.type==='claude'&&!versionAtLeast(cli.version,'2.1.217')?'Claude Code CLI 2.1.217 or newer is required.':definition.type==='claude'&&!auth?.authenticated?'Run claude auth login before enabling this connector.':definition.type==='claude'&&!protocol?'Claude CLI stream-json control protocol is incompatible.':definition.type==='claude'&&auth?.kind==='subscription_oauth'?'Experimental: subscription OAuth requires explicit CLAUDE OAUTH confirmation and may conflict with Anthropic terms for third-party products.':definition.type==='claude'?'Experimental Claude CLI integration.':undefined;
    return {type:definition.type,label:definition.label,cli:{...cli,compatible},...(endpoint?{endpoint}:{}),safeToSelect,supportsManagedServer:definition.managed,...(auth?{auth}:{}),...(definition.type==='cursor'?{auth:{authenticated:cursorAuthenticated,kind:env.CURSOR_API_KEY?'api' as const:cursorAuthenticated?'unknown' as const:'none' as const},requiresConfirmation:'cursor_experimental' as const}:auth?.kind==='subscription_oauth'?{requiresConfirmation:'claude_oauth' as const}:{}),...(warning?{warning}:{})} satisfies HarnessDiscoveryCandidate;
  }));
  return {apiVersion:CONNECTOR_API_VERSION,candidates};
}

export async function runCursorStatus(command:string,options:{platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;execute?:VersionExecutor}={}){
  const env=options.env??process.env;if(env.CURSOR_API_KEY?.trim())return true;
  return runCursorCommand(command,['status'],options);
}

export async function runCursorCompatibilityProbe(command:string,options:{platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;execute?:VersionExecutor}={}){
  const models=await runCursorCommand(command,['--list-models'],options,true),help=await runCursorCommand(command,['--help'],options,true);
  return Boolean(models&&help&&models.stdout.trim()&&/--mode(?:[ =]|\b)/.test(help.stdout+help.stderr)&&/--output-format/.test(help.stdout+help.stderr));
}

async function runCursorCommand(command:string,args:string[],options:{platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;execute?:VersionExecutor},capture?:false):Promise<boolean>;
async function runCursorCommand(command:string,args:string[],options:{platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;execute?:VersionExecutor},capture:true):Promise<{stdout:string;stderr:string}|undefined>;
async function runCursorCommand(command:string,args:string[],options:{platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;execute?:VersionExecutor},capture=false){
  const platform=options.platform??process.platform,env=options.env??process.env,run=options.execute??execute as VersionExecutor;
  try{const executable=await resolveCommand(command,{platform,env,execute:run}),invocation=commandInvocation(executable,args,platform,env),result=await run(invocation.file,invocation.args,{...executionOptions(env),windowsVerbatimArguments:invocation.windowsVerbatimArguments});return capture?result:true;}catch{return capture?undefined:false;}
}

export async function runClaudeAuthStatus(command:string,options:{platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;execute?:VersionExecutor}={}):Promise<ClaudeAuth>{
  const platform=options.platform??process.platform,env=options.env??process.env,run=options.execute??execute as VersionExecutor;
  try{const executable=await resolveCommand(command,{platform,env,execute:run}),invocation=commandInvocation(executable,['auth','status'],platform,env),{stdout}=await run(invocation.file,invocation.args,{...executionOptions(env),windowsVerbatimArguments:invocation.windowsVerbatimArguments});const value=JSON.parse(stdout) as Record<string,unknown>;if(value.loggedIn!==true)return{authenticated:false,kind:'none'};const method=String(value.authMethod??'').toLowerCase(),provider=String(value.apiProvider??'').toLowerCase();return{authenticated:true,kind:method.includes('oauth')?'subscription_oauth':provider&&provider!=='firstparty'?'cloud':method.includes('api')?'api':'unknown'};}catch{return{authenticated:false,kind:'none'};}
}

export async function runClaudeInitializeProbe(command:string,options:{env?:NodeJS.ProcessEnv}={}){
  const processPort=new ClaudeCliProcess({command,env:options.env,cwd:process.cwd(),args:['--print','--input-format','stream-json','--output-format','stream-json','--verbose','--no-session-persistence'],initializeTimeoutMs:5_000});
  try{const response=await processPort.initialize();return response.models.length>0;}catch{return false;}finally{await processPort.close();}
}

export async function runCodexLoginStatus(command:string,options:{platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;execute?:VersionExecutor}={}){
  const platform=options.platform??process.platform,env=options.env??process.env,run=options.execute??execute as VersionExecutor;
  try{const executable=await resolveCommand(command,{platform,env,execute:run}),invocation=commandInvocation(executable,['login','status'],platform,env);await run(invocation.file,invocation.args,{...executionOptions(env),windowsVerbatimArguments:invocation.windowsVerbatimArguments});return true;}catch{return false;}
}

export async function runVersion(command:string,options:{platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;execute?:VersionExecutor}={}){
  const platform=options.platform??process.platform,env=options.env??process.env,run=options.execute??execute as VersionExecutor;
  try{const executable=await resolveCommand(command,{platform,env,execute:run}),invocation=commandInvocation(executable,['--version'],platform,env),{stdout,stderr}=await run(invocation.file,invocation.args,{...executionOptions(env),windowsVerbatimArguments:invocation.windowsVerbatimArguments});return{found:true,command,version:firstVersion(`${stdout}\n${stderr}`)};}
  catch{return{found:false,command};}
}

async function reachable(url:string,request:typeof fetch){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1_000);
  try{const response=await request(url,{method:'GET',signal:controller.signal});return response.status<500;}catch{return false;}finally{clearTimeout(timer);}
}

function firstVersion(value:string){return value.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0];}
function versionAtLeast(value:string|undefined,minimum:string){if(!value)return false;const match=value.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/),floor=minimum.split('.').map(Number);if(!match)return false;const parts=match.slice(1,4).map(Number);for(let index=0;index<3;index++){if(parts[index]>floor[index])return true;if(parts[index]<floor[index])return false;}return !match[4].startsWith('-');}
function cursorVersionSupported(value:string|undefined){const match=value?.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);return Boolean(match&&Number(`${match[1]}${match[2]!.padStart(2,'0')}${match[3]!.padStart(2,'0')}`)>=20260116);}
