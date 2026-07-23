import {readFile} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {afterEach,describe,expect,it} from 'vitest';
import {CLAUDE_PERMISSION_TOOL_NAME,ClaudePermissionMcpBridge,type ClaudePermissionDecision} from './permission-bridge.js';

const bridges:ClaudePermissionMcpBridge[]=[];
const clients:Client[]=[];

afterEach(async()=>{
  await Promise.allSettled(clients.splice(0).map(client=>client.close()));
  await Promise.allSettled(bridges.splice(0).map(bridge=>bridge.close()));
});

describe('ClaudePermissionMcpBridge',()=>{
  it('serves isolated concurrent runs from one loopback endpoint',async()=>{
    const bridge=new ClaudePermissionMcpBridge();bridges.push(bridge);
    const seen:string[]=[];
    const runA=await bridge.openRun('run-a',async request=>{seen.push(`a:${request.toolName}`);return{behavior:'allow',updatedInput:request.input};});
    const runB=await bridge.openRun('run-b',async request=>{seen.push(`b:${request.toolName}`);return{behavior:'deny',message:'No'};});
    const configA=await readConfig(runA.configPath),configB=await readConfig(runB.configPath);
    expect(configA.url).toBe(configB.url);
    expect(configA.token).not.toBe(configB.token);
    const clientA=await connect(configA),clientB=await connect(configB);
    const [allowed,denied]=await Promise.all([
      call(clientA,'Write',{file_path:'a.txt'}),
      call(clientB,'Bash',{command:'rm a.txt'}),
    ]);
    expect(allowed).toEqual({behavior:'allow',updatedInput:{file_path:'a.txt'}});
    expect(denied).toEqual({behavior:'deny',message:'No'});
    expect(seen).toEqual(expect.arrayContaining(['a:Write','b:Bash']));
    await runA.close();await runB.close();
  });

  it('rejects expired run tokens without changing any Claude configuration',async()=>{
    const bridge=new ClaudePermissionMcpBridge();bridges.push(bridge);
    const run=await bridge.openRun('run-expired',async request=>({behavior:'allow',updatedInput:request.input}));
    const config=await readConfig(run.configPath);
    await run.close();
    const client=new Client({name:'expired-test',version:'1.0.0'});clients.push(client);
    await expect(client.connect(new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:{Authorization:`Bearer ${config.token}`}}}))).rejects.toThrow();
    await expect(readFile(run.configPath,'utf8')).rejects.toThrow();
  });
});

const connect=async(config:{url:string;token:string})=>{
  const client=new Client({name:'agenvyl-test',version:'1.0.0'});clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:{Authorization:`Bearer ${config.token}`}}}));
  expect((await client.listTools()).tools.map(tool=>tool.name)).toContain(CLAUDE_PERMISSION_TOOL_NAME);
  return client;
};

const call=async(client:Client,toolName:string,input:Record<string,unknown>)=>{
  const result=await client.callTool({name:CLAUDE_PERMISSION_TOOL_NAME,arguments:{tool_name:toolName,input}});
  if('toolResult'in result)throw new Error('Unexpected task result');
  const content=result.content[0];
  if(content?.type!=='text')throw new Error('Permission result is not text');
  return JSON.parse(content.text) as ClaudePermissionDecision;
};

const readConfig=async(path:string)=>{
  const config=JSON.parse(await readFile(path,'utf8')) as {mcpServers:{agenvyl_permissions:{url:string;headers:{Authorization:string}}}};
  return{url:config.mcpServers.agenvyl_permissions.url,token:config.mcpServers.agenvyl_permissions.headers.Authorization.slice('Bearer '.length)};
};
