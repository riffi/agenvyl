import type { Room,TimelinePage } from '../model';
import type {RoomExecutionState,RoomWorkspace,UpdateRoomExecutionProfileRequest,WorkspaceEntry,WorkspaceVersion} from '@agenvyl/contracts';
import { apiRequest } from '../../../shared/api';

export const roomKeys = { all: ['rooms'] as const };

export const roomsApi = {
  list: (signal?: AbortSignal) => apiRequest<Room[]>('/api/v1/rooms', { signal }),
  trash:(signal?:AbortSignal)=>apiRequest<Room[]>('/api/v1/rooms?deleted=true',{signal}).then(rooms=>rooms.filter(room=>Boolean(room.deleted_at))),
  timeline:(roomId:string,options:{before?:string;limit?:number;signal?:AbortSignal}={})=>{const query=new URLSearchParams();if(options.before)query.set('before',options.before);if(options.limit)query.set('limit',String(options.limit));return apiRequest<TimelinePage>(`/api/v1/rooms/${encodeURIComponent(roomId)}/timeline?${query}`,{signal:options.signal});},
  create: (title: string, personaIds: string[]) => apiRequest<Room>('/api/v1/rooms', { method: 'POST', body: { title, persona_ids: personaIds } }),
  rename: (roomId: string, title: string) => apiRequest<Room>(`/api/v1/rooms/${encodeURIComponent(roomId)}`, { method: 'PATCH', body: { title } }),
  remove: (roomId: string) => apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' }),
  restore:(roomId:string)=>apiRequest<Room>(`/api/v1/rooms/${encodeURIComponent(roomId)}/restore`,{method:'POST'}),
  purge:(roomId:string)=>apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}?permanent=true`,{method:'DELETE'}),
  addParticipant: (roomId: string, personaId: string) => apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(personaId)}`, { method: 'PUT' }),
  removeParticipant: (roomId: string, personaId: string) => apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(personaId)}`, { method: 'DELETE' }),
  executionState:(roomId:string,signal?:AbortSignal)=>apiRequest<RoomExecutionState>(`/api/v1/rooms/${encodeURIComponent(roomId)}/execution-state`,{signal}),
  updateExecutionProfile:(roomId:string,profile:UpdateRoomExecutionProfileRequest)=>apiRequest<RoomExecutionState>(`/api/v1/rooms/${encodeURIComponent(roomId)}/execution-profile`,{method:'PATCH',body:profile}),
  approvePlan:(roomId:string,runId:string)=>apiRequest<RoomExecutionState>(`/api/v1/rooms/${encodeURIComponent(roomId)}/approved-plan`,{method:'PUT',body:{run_id:runId}}),
  clearApprovedPlan:(roomId:string)=>apiRequest<RoomExecutionState>(`/api/v1/rooms/${encodeURIComponent(roomId)}/approved-plan`,{method:'DELETE'}),
  workspace:(roomId:string,signal?:AbortSignal)=>apiRequest<RoomWorkspace>(`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace`,{signal}),
  uploadFile:(roomId:string,file:File,filePath=file.name,conflict:'fail'|'replace'|'rename'='fail',options:{signal?:AbortSignal;onProgress?:(progress:number)=>void}={})=>new Promise<{entry:WorkspaceEntry;version?:WorkspaceVersion}>((resolve,reject)=>{
    const request=new XMLHttpRequest();
    request.open('POST',`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/files`);
    request.setRequestHeader('content-type',file.type||'application/octet-stream');
    request.setRequestHeader('x-file-path',encodeURIComponent(filePath));
    request.setRequestHeader('x-conflict-strategy',conflict);
    request.upload.onprogress=event=>{if(event.lengthComputable)options.onProgress?.(Math.round(event.loaded/event.total*100))};
    const abort=()=>request.abort();
    options.signal?.addEventListener('abort',abort,{once:true});
    request.onerror=()=>reject(new Error('Failed to upload file'));
    request.onabort=()=>reject(new DOMException('Upload cancelled','AbortError'));
    request.onload=()=>{options.signal?.removeEventListener('abort',abort);let data:unknown;try{data=JSON.parse(request.responseText)}catch{data=undefined}if(request.status<200||request.status>=300){const error=data as {error?:string;message?:string}|undefined;const value=new Error(error?.message??`HTTP ${request.status}`) as Error&{code?:string};value.code=error?.error;reject(value);return}options.onProgress?.(100);resolve(data as {entry:WorkspaceEntry;version?:WorkspaceVersion})};
    request.send(file);
  }),
  createDirectory:(roomId:string,path:string)=>apiRequest<WorkspaceEntry>(`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/directories`,{method:'POST',body:{path}}),
  moveEntry:(roomId:string,id:string,path:string)=>apiRequest<WorkspaceEntry>(`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/entries/${encodeURIComponent(id)}`,{method:'PATCH',body:{path}}),
  deleteEntry:(roomId:string,id:string)=>apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/entries/${encodeURIComponent(id)}`,{method:'DELETE'}),
  restoreEntry:(roomId:string,id:string)=>apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/entries/${encodeURIComponent(id)}/restore`,{method:'POST'}),
  versions:(roomId:string,id:string)=>apiRequest<WorkspaceVersion[]>(`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/entries/${encodeURIComponent(id)}/versions`),
  restoreVersion:(roomId:string,id:string)=>apiRequest(`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(id)}/restore`,{method:'POST'}),
};
