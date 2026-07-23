import {createServer,type IncomingMessage,type Server as HttpServer,type ServerResponse} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {isInitializeRequest} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';

export const CLAUDE_PERMISSION_SERVER_NAME='agenvyl_permissions';
export const CLAUDE_PERMISSION_TOOL_NAME='permission_prompt';
export const CLAUDE_PERMISSION_TOOL=`mcp__${CLAUDE_PERMISSION_SERVER_NAME}__${CLAUDE_PERMISSION_TOOL_NAME}`;

export type ClaudePermissionDecision=
  |{behavior:'allow';updatedInput:Record<string,unknown>;updatedPermissions?:unknown[]}
  |{behavior:'deny';message:string};

export type ClaudePermissionRequest={
  id:string;
  toolName:string;
  input:Record<string,unknown>;
  suggestions?:unknown[];
  signal:AbortSignal;
};

export type ClaudePermissionRun={
  configPath:string;
  permissionTool:string;
  close():Promise<void>;
};

export type ClaudePermissionBridgePort={
  openRun(executionId:string,handler:(request:ClaudePermissionRequest)=>Promise<ClaudePermissionDecision>):Promise<ClaudePermissionRun>;
  close():Promise<void>;
};

type ActiveRun={executionId:string;handler:(request:ClaudePermissionRequest)=>Promise<ClaudePermissionDecision>};
type ActiveSession={token:string;transport:StreamableHTTPServerTransport;server:McpServer};

export class ClaudePermissionMcpBridge implements ClaudePermissionBridgePort{
  private httpServer?:HttpServer;
  private startPromise?:Promise<string>;
  private readonly runs=new Map<string,ActiveRun>();
  private readonly sessions=new Map<string,ActiveSession>();

  async openRun(executionId:string,handler:(request:ClaudePermissionRequest)=>Promise<ClaudePermissionDecision>):Promise<ClaudePermissionRun>{
    const endpoint=await this.ensureStarted(),token=randomBytes(32).toString('base64url');
    this.runs.set(token,{executionId,handler});
    const directory=await mkdtemp(join(tmpdir(),'agenvyl-claude-mcp-')),configPath=join(directory,'mcp.json');
    const config={mcpServers:{[CLAUDE_PERMISSION_SERVER_NAME]:{type:'http',url:endpoint,headers:{Authorization:`Bearer ${token}`},timeout:30*60_000}}};
    try{await writeFile(configPath,JSON.stringify(config),{encoding:'utf8',mode:0o600});}
    catch(error){this.runs.delete(token);await rm(directory,{recursive:true,force:true});throw error;}
    let closed=false;
    return{configPath,permissionTool:CLAUDE_PERMISSION_TOOL,close:async()=>{
      if(closed)return;closed=true;this.runs.delete(token);
      const matching=[...this.sessions.entries()].filter(([,session])=>session.token===token);
      await Promise.allSettled(matching.map(async([sessionId,session])=>{this.sessions.delete(sessionId);await session.transport.close();await session.server.close();}));
      await rm(directory,{recursive:true,force:true});
    }};
  }

  async close(){
    this.runs.clear();
    const sessions=[...this.sessions.values()];this.sessions.clear();
    await Promise.allSettled(sessions.map(async session=>{await session.transport.close();await session.server.close();}));
    const server=this.httpServer;this.httpServer=undefined;this.startPromise=undefined;
    if(!server)return;
    await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});
  }

  private ensureStarted(){
    if(!this.startPromise)this.startPromise=this.start();
    return this.startPromise;
  }

  private start(){
    return new Promise<string>((resolve,reject)=>{
      const server=createServer((request,response)=>void this.handle(request,response));
      server.requestTimeout=0;server.headersTimeout=10_000;
      const fail=(error:Error)=>{this.httpServer=undefined;this.startPromise=undefined;reject(error);};
      server.once('error',fail);
      server.listen(0,'127.0.0.1',()=>{
        server.off('error',fail);server.on('error',()=>undefined);this.httpServer=server;
        const address=server.address();
        if(!address||typeof address==='string'){void this.close();reject(new Error('Claude permission MCP address is unavailable'));return;}
        resolve(`http://127.0.0.1:${address.port}/mcp`);
      });
    });
  }

  private async handle(request:IncomingMessage,response:ServerResponse){
    try{
      if(new URL(request.url??'/',`http://${request.headers.host??'127.0.0.1'}`).pathname!=='/mcp'){sendJson(response,404,{error:'not_found'});return;}
      const token=bearerToken(request),run=token?this.runs.get(token):undefined;
      if(!token||!run){response.setHeader('www-authenticate','Bearer');sendJson(response,401,{error:'unauthorized'});return;}
      const sessionId=singleHeader(request.headers['mcp-session-id']);
      if(sessionId){
        const session=this.sessions.get(sessionId);
        if(!session||session.token!==token){sendJson(response,404,{error:'invalid_session'});return;}
        await session.transport.handleRequest(request,response);
        return;
      }
      if(request.method!=='POST'){sendJson(response,400,{error:'missing_session'});return;}
      const body=await readJson(request);
      if(!isInitializeRequest(body)){sendJson(response,400,{error:'invalid_initialize'});return;}
      await this.initializeSession(token,run,request,response,body);
    }catch{
      if(!response.headersSent)sendJson(response,500,{error:'mcp_internal_error'});
      else response.end();
    }
  }

  private async initializeSession(token:string,run:ActiveRun,request:IncomingMessage,response:ServerResponse,body:unknown){
    let server:McpServer;
    const transport=new StreamableHTTPServerTransport({
      sessionIdGenerator:randomUUID,
      onsessioninitialized:sessionId=>{this.sessions.set(sessionId,{token,transport,server});},
    });
    server=this.createMcpServer(run);
    transport.onclose=()=>{
      const sessionId=transport.sessionId;
      if(sessionId)this.sessions.delete(sessionId);
    };
    try{await server.connect(transport);await transport.handleRequest(request,response,body);}
    catch(error){await transport.close().catch(()=>undefined);await server.close().catch(()=>undefined);throw error;}
  }

  private createMcpServer(run:ActiveRun){
    const server=new McpServer({name:'agenvyl-permission-bridge',version:'1.0.0'});
    server.registerTool(CLAUDE_PERMISSION_TOOL_NAME,{
      description:'Ask the Agenvyl user whether Claude may invoke a tool.',
      inputSchema:{
        tool_name:z.string(),
        input:z.record(z.string(),z.unknown()),
        permission_suggestions:z.array(z.unknown()).optional(),
      },
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:false},
    },async({tool_name,input,permission_suggestions},context)=>{
      const decision=await run.handler({
        id:randomUUID(),
        toolName:tool_name,
        input,
        ...(permission_suggestions?{suggestions:permission_suggestions}:{}),
        signal:context.signal,
      });
      return{content:[{type:'text' as const,text:JSON.stringify(decision)}]};
    });
    return server;
  }
}

const bearerToken=(request:IncomingMessage)=>{
  const header=singleHeader(request.headers.authorization);
  return header?.startsWith('Bearer ')?header.slice(7):undefined;
};

const singleHeader=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;

const readJson=async(request:IncomingMessage)=>{
  const chunks:Buffer[]=[];let size=0;
  for await(const value of request){
    const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);size+=chunk.length;
    if(size>1024*1024)throw new Error('MCP request body is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
};

const sendJson=(response:ServerResponse,status:number,payload:unknown)=>{
  response.writeHead(status,{'content-type':'application/json; charset=utf-8'});
  response.end(JSON.stringify(payload));
};
