import { connectorContractFixtures } from '@agenvyl/connector-contract';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorClientError, HttpConnectorClient } from './HttpConnectorClient.js';

describe('HttpConnectorClient', () => {
  it('authenticates and validates health and execution snapshots', async () => {
    const inspectedExecution={...connectorContractFixtures.execution,executionId:'run/1'};
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(connectorContractFixtures.health))
      .mockResolvedValueOnce(Response.json({ execution: inspectedExecution }))
      .mockResolvedValueOnce(Response.json(connectorContractFixtures.instances))
      .mockResolvedValueOnce(Response.json(connectorContractFixtures.catalog))
      .mockResolvedValueOnce(Response.json({apiVersion:'v1',instances:[{id:'disabled',type:'hermes',enabled:false}]}));
    const client = new HttpConnectorClient('http://connector.test/', 'x'.repeat(32), request);

    await expect(client.health()).resolves.toEqual(connectorContractFixtures.health);
    await expect(client.inspect('run/1')).resolves.toEqual(inspectedExecution);
    await expect(client.instances()).resolves.toEqual(connectorContractFixtures.instances);
    await expect(client.catalog('local/hermes')).resolves.toEqual(connectorContractFixtures.catalog);
    await expect(client.configuration()).resolves.toEqual({apiVersion:'v1',instances:[{id:'disabled',type:'hermes',enabled:false}]});
    expect(request.mock.calls.map(([url, init]) => [url, (init?.headers as Record<string, string>).authorization])).toEqual([
      ['http://connector.test/v1/health', `Bearer ${'x'.repeat(32)}`],
      ['http://connector.test/v1/executions/run%2F1', `Bearer ${'x'.repeat(32)}`],
      ['http://connector.test/v1/instances', `Bearer ${'x'.repeat(32)}`],
      ['http://connector.test/v1/instances/local%2Fhermes/catalog', `Bearer ${'x'.repeat(32)}`],
      ['http://connector.test/v1/configuration', `Bearer ${'x'.repeat(32)}`],
    ]);
  });

  it('maps missing executions and malformed payloads to safe errors', async () => {
    const token = 'secret-token-'.padEnd(32, 'x');
    const missing = new HttpConnectorClient('http://connector.test', token, vi.fn<typeof fetch>().mockResolvedValue(Response.json({apiVersion:'v1',error:'execution_not_found',message:`leak ${token}`},{status:404})));
    await expect(missing.inspect('gone')).rejects.toMatchObject<Partial<ConnectorClientError>>({ code: 'connector_execution_lost', status: 404 });

    const malformed = new HttpConnectorClient('http://connector.test', token, vi.fn<typeof fetch>().mockResolvedValue(Response.json({ connectorEpoch: 'wrong' })));
    await expect(malformed.health()).rejects.toMatchObject<Partial<ConnectorClientError>>({ code: 'connector_invalid_response' });
    const mismatched = new HttpConnectorClient('http://connector.test', token, vi.fn<typeof fetch>().mockResolvedValue(Response.json({execution:connectorContractFixtures.execution})));
    await expect(mismatched.inspect('different-run')).rejects.toMatchObject<Partial<ConnectorClientError>>({code:'connector_invalid_response'});
    await expect(missing.inspect('gone')).rejects.not.toThrow(token);
    const rejected=new HttpConnectorClient('http://connector.test',token,vi.fn<typeof fetch>().mockResolvedValue(Response.json({apiVersion:'v1',error:'instance_not_found',message:'missing'},{status:404})));
    await expect(rejected.start({...connectorContractFixtures.startExecution})).rejects.toMatchObject({code:'connector_command_rejected',status:404});
  });

  it('sends typed start, stop and request-resolution commands',async()=>{
    const requestSnapshot={id:'request-1',kind:'approval' as const,prompt:'Allow?',resolution:{outcome:'answered' as const,value:'once'}},request=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({execution:connectorContractFixtures.execution},{status:201}))
      .mockResolvedValueOnce(Response.json({execution:{...connectorContractFixtures.execution,status:'cancelled'}}))
      .mockResolvedValueOnce(Response.json({execution:connectorContractFixtures.execution,request:requestSnapshot}));
    const client=new HttpConnectorClient('http://connector.test','x'.repeat(32),request);
    await expect(client.start({...connectorContractFixtures.startExecution})).resolves.toEqual(connectorContractFixtures.execution);
    await expect(client.stop('run-1')).resolves.toMatchObject({status:'cancelled'});
    await expect(client.resolve('run-1','request-1','once')).resolves.toEqual({execution:connectorContractFixtures.execution,request:requestSnapshot});
    expect(request.mock.calls.map(([url,init])=>[url,init?.method,init?.body?JSON.parse(String(init.body)):undefined])).toEqual([
      ['http://connector.test/v1/executions','POST',connectorContractFixtures.startExecution],
      ['http://connector.test/v1/executions/run-1/stop','POST',undefined],
      ['http://connector.test/v1/executions/run-1/requests/request-1/resolve','POST',{resolution:'once'}],
    ]);
  });

  it('streams only contiguous events from the expected execution and epoch',async()=>{
    const completed={...connectorContractFixtures.textEvent,cursor:4,type:'execution.completed' as const,payload:{}},request=vi.fn<typeof fetch>().mockResolvedValue(sse(connectorContractFixtures.textEvent,completed)),client=new HttpConnectorClient('http://connector.test','x'.repeat(32),request),controller=new AbortController();
    await expect(collect(client.events('run-1',{after:2,connectorEpoch:'epoch-1',signal:controller.signal}))).resolves.toEqual([connectorContractFixtures.textEvent,completed]);
    expect(request.mock.calls[0]?.[0]).toBe('http://connector.test/v1/executions/run-1/events?after=2');
  });

  it('fails closed on cursor gaps, epoch changes and unavailable replay',async()=>{
    const token='x'.repeat(32),controller=new AbortController(),gap={...connectorContractFixtures.textEvent,cursor:4};
    const invalid=new HttpConnectorClient('http://connector.test',token,vi.fn<typeof fetch>().mockResolvedValue(sse(gap)));
    await expect(collect(invalid.events('run-1',{after:2,connectorEpoch:'epoch-1',signal:controller.signal}))).rejects.toMatchObject({code:'connector_invalid_response'});
    const changed=new HttpConnectorClient('http://connector.test',token,vi.fn<typeof fetch>().mockResolvedValue(sse({...connectorContractFixtures.textEvent,connectorEpoch:'epoch-new'})));
    await expect(collect(changed.events('run-1',{after:2,connectorEpoch:'epoch-1',signal:controller.signal}))).rejects.toMatchObject({code:'connector_invalid_response'});
    const replay=new HttpConnectorClient('http://connector.test',token,vi.fn<typeof fetch>().mockResolvedValue(Response.json({apiVersion:'v1',error:'replay_unavailable',message:'gone'},{status:409})));
    await expect(collect(replay.events('run-1',{after:2,connectorEpoch:'epoch-1',signal:controller.signal}))).rejects.toMatchObject({code:'connector_replay_unavailable',status:409});
  });
});

function sse(...events:Array<Record<string,unknown>>){return new Response(events.map(event=>`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{status:200,headers:{'content-type':'text/event-stream; charset=utf-8'}});}
async function collect<T>(events:AsyncIterable<T>){const result:T[]=[];for await(const event of events)result.push(event);return result;}
