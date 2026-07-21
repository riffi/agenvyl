import type { Message } from '../../../entities/message';
import type { RoomEvent } from '../../../entities/room';
import { runsApi, type AgentHandle,type Run } from '../../../entities/run';
import { ApiError } from '../../../shared/api';
import { WebSocketRoomEventStream } from '../../../shared/api/realtime';
import { FakeRoomEventStream, type FakeEventScenario } from './FakeRoomEventStream';

export interface RoomGateway { readonly mode:'real'|'fake'; subscribe(listener: (event: RoomEvent) => void): () => void; send(text: string, targets?: AgentHandle[], messageId?:string,attachmentVersionIds?:string[]): Promise<Message>; resolve(runId: string, value: string): Promise<void>; cancel(runId?: string): Promise<void>; retry(runId:string):Promise<void>; select(runId:string):Promise<void>; dispose(): void }
export type DemoKind = FakeEventScenario;

export class FakeRoomGateway implements RoomGateway {
  readonly mode='fake' as const;
  private readonly stream=new FakeRoomEventStream();
  subscribe(listener: (event: RoomEvent) => void) { return this.stream.subscribe(listener); }
  send(text: string, targets: AgentHandle[]) { return this.stream.send(text,targets); }
  demo(kind: DemoKind) { this.stream.demo(kind); }
  async resolve(runId: string, value: string) { this.stream.resolve(runId,value); }
  async cancel(runId?: string) { this.stream.cancel(runId); }
  async retry(){throw new ApiError(501,'unsupported','Retry is unavailable in demo mode')}
  async select(){throw new ApiError(501,'unsupported','Attempt selection is unavailable in demo mode')}
  dispose() { this.stream.dispose(); }
}

export class HttpRoomGateway implements RoomGateway {
  readonly mode='real' as const; private readonly stream:WebSocketRoomEventStream<RoomEvent>;private active=new Set<string>();private deltaTimer?:ReturnType<typeof setTimeout>;private pendingDeltas=new Map<string,Extract<RoomEvent,{type:'run.delta'|'run.reasoning.delta'}>>();
  constructor(private readonly roomId='demo-room',initialSequence?:number,initialRuns:Run[]=[]){const connectImmediately=arguments.length<2||initialSequence!==undefined;this.stream=new WebSocketRoomEventStream<RoomEvent>(roomId,initialSequence??0,connectImmediately);for(const run of initialRuns)if(['queued','streaming','stopping','waiting_approval','waiting_clarification'].includes(run.status))this.active.add(run.id);}
  subscribe(listener:(event:RoomEvent)=>void){const flush=()=>{if(this.deltaTimer)clearTimeout(this.deltaTimer);this.deltaTimer=undefined;const events=[...this.pendingDeltas.values()].sort((a,b)=>a.sequence-b.sequence);this.pendingDeltas.clear();for(const event of events)listener(event)};return this.stream.subscribe(event=>{if(event.type==='run.created')this.active.add(event.payload.id);if(event.type==='run.status'&&['completed','failed','cancelled'].includes(event.payload.status))this.active.delete(event.payload.runId);if(event.type==='run.delta'||event.type==='run.reasoning.delta'){const key=`${event.type}:${event.payload.runId}`,prior=this.pendingDeltas.get(key);this.pendingDeltas.set(key,prior&&prior.type===event.type?{...event,payload:{...event.payload,text:prior.payload.text+event.payload.text}}:event);if(!this.deltaTimer)this.deltaTimer=setTimeout(flush,32);return}flush();listener(event)})}
  send(text:string,targets?:AgentHandle[],messageId=crypto.randomUUID(),attachmentVersionIds:string[]=[]){if(!this.roomId)return Promise.reject(new ApiError(409,'room_required','Create a room first'));return runsApi.sendMessage(this.roomId,text,targets,messageId,attachmentVersionIds);}
  async resolve(runId:string,value:string){await runsApi.resolve(runId,value);}
  async cancel(runId?:string){const ids=runId?[runId]:[...this.active];await Promise.all(ids.map(id=>runsApi.cancel(id)));}
  async retry(runId:string){await runsApi.retry(runId);}
  async select(runId:string){await runsApi.select(runId);}
  dispose(){if(this.deltaTimer)clearTimeout(this.deltaTimer);this.pendingDeltas.clear();this.stream.dispose();this.active.clear();}
}
