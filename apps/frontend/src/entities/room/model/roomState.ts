import type { Message } from '../../message';
import type { Run } from '../../run';
import type { ServerRoomEvent, TimelinePage, UpstreamStatus } from '@agenvyl/contracts';
export type Connection = 'connected' | 'reconnecting' | 'replaying';
export type { TimelinePage } from '@agenvyl/contracts';
export type RoomState = { messages: Message[]; runs: Record<string, Run>; runOrder: string[]; selectedRuns:Record<string,string>; connection: Connection; lastSequence: number; selectedRunId?: string; appliedPatch: boolean; hydrated:boolean; hasMore:boolean; nextCursor?:string };

export type RoomEvent = ServerRoomEvent | { id: string; sequence: number; type: 'connection.changed'; payload: { status: Connection } };

export const initialState: RoomState = { messages: [], runs: {}, runOrder: [], selectedRuns:{}, connection: 'connected', lastSequence: 0, appliedPatch: false, hydrated:false, hasMore:false };

export function stateFromTimeline(page:TimelinePage):RoomState{return{...initialState,messages:page.messages,runs:Object.fromEntries(page.runs.map(run=>[run.id,run])),runOrder:page.runs.map(run=>run.id),selectedRuns:page.selectedRuns,lastSequence:page.lastSequence,hydrated:true,hasMore:page.hasMore,nextCursor:page.nextCursor};}
export function prependTimeline(state:RoomState,page:TimelinePage):RoomState{const known=new Set(state.messages.map(message=>message.id));const runs={...state.runs};for(const run of page.runs)runs[run.id]??=run;return{...state,messages:[...page.messages.filter(message=>!known.has(message.id)),...state.messages],runs,runOrder:[...page.runs.map(run=>run.id).filter(id=>!state.runs[id]),...state.runOrder],selectedRuns:{...page.selectedRuns,...state.selectedRuns},hasMore:page.hasMore,nextCursor:page.nextCursor};}

export function roomReducer(state: RoomState, event: RoomEvent): RoomState {
  if (event.type === 'connection.changed') return { ...state, connection: event.payload.status };
  if (event.sequence <= state.lastSequence) return state;
  const base = { ...state, lastSequence: event.sequence };
  switch (event.type) {
    case 'message.created': return { ...base, messages: [...state.messages, event.payload] };
    case 'run.created': return { ...base, messages:state.messages.map(message=>message.id===event.payload.messageId&&!message.runIds.includes(event.payload.id)?{...message,runIds:[...message.runIds,event.payload.id]}:message), runs: { ...state.runs, [event.payload.id]: {...event.payload,reasoning:event.payload.reasoning??''} }, runOrder: [...state.runOrder, event.payload.id] };
    case 'run.selected':return {...base,selectedRuns:{...state.selectedRuns,[event.payload.responseSlotId]:event.payload.runId}};
    case 'run.delta': { const run = state.runs[event.payload.runId]; return run ? { ...base, runs: { ...state.runs, [run.id]: { ...run, text: run.text + event.payload.text } } } : base; }
    case 'run.reasoning.delta': { const run = state.runs[event.payload.runId]; return run ? { ...base, runs: { ...state.runs, [run.id]: { ...run, reasoning: (run.reasoning??'') + event.payload.text } } } : base; }
    case 'run.status': { const run = state.runs[event.payload.runId]; return run ? { ...base, runs: { ...state.runs, [run.id]: { ...run, status: event.payload.status, ...(['completed','failed','cancelled'].includes(event.payload.status)?{upstreamStatus:undefined}:{}), error: event.payload.error, errorCode:event.payload.errorCode } },...(event.payload.status==='completed'?{selectedRuns:{...state.selectedRuns,[run.responseSlotId??run.retryOfRunId??run.id]:run.id}}:{}) } : base; }
    case 'run.upstream_status': { const run=state.runs[event.payload.runId];if(!run)return base;if(event.payload.state==='recovered')return{...base,runs:{...state.runs,[run.id]:{...run,upstreamStatus:undefined}}};const{runId:_runId,...payload}=event.payload,upstreamStatus=payload as UpstreamStatus;return{...base,runs:{...state.runs,[run.id]:{...run,upstreamStatus}}};}
    case 'run.usage':{const run=state.runs[event.payload.runId];return run?{...base,runs:{...state.runs,[run.id]:{...run,usage:event.payload.usage}}}:base;}
    case 'tool.updated': { const run = state.runs[event.payload.runId]; if (!run) return base; const incoming=event.payload.tool,prior=run.tools.find(tool=>tool.id===incoming.id),merged={...prior,...incoming,detail:incoming.detail||prior?.detail||'',...(incoming.input?{input:incoming.input}:prior?.input?{input:prior.input}:{})};const tools = [...run.tools.filter(t => t.id !== incoming.id),merged]; return { ...base, runs: { ...state.runs, [run.id]: { ...run, tools } } }; }
    case 'request.created': { const run = state.runs[event.payload.runId]; return run ? { ...base, runs: { ...state.runs, [run.id]: { ...run, status: event.payload.kind === 'approval' ? 'waiting_approval' : 'waiting_clarification', request: { kind: event.payload.kind, prompt: event.payload.prompt,...(event.payload.choices?.length?{choices:event.payload.choices}:{}) } } } } : base; }
    case 'request.resolved': { const run = state.runs[event.payload.runId]; return run ? { ...base, runs: { ...state.runs, [run.id]: { ...run, status: 'streaming', request: run.request ? { ...run.request, resolved: event.payload.resolution } : undefined } } } : base; }
    case 'artifact.created':{const run=state.runs[event.payload.runId];return run?{...base,runs:{...state.runs,[run.id]:{...run,artifacts:[...(run.artifacts??[]).filter(item=>item.version_id!==event.payload.artifact.version_id),event.payload.artifact]}}}:base;}
    case 'run.embeds':{const run=state.runs[event.payload.runId];return run?{...base,runs:{...state.runs,[run.id]:{...run,embeds:event.payload.embeds}}}:base;}
    case 'workspace.changed':return base;
  }
}
