import {apiRequest} from '../../../shared/api';
import type {PersonaGroup} from '../model';
export const personaGroupKeys={all:['persona-groups'] as const};
export const personaGroupsApi={
  list:(signal?:AbortSignal)=>apiRequest<PersonaGroup[]>('/api/v1/persona-groups',{signal}),
  create:(name:string)=>apiRequest<PersonaGroup>('/api/v1/persona-groups',{method:'POST',body:{name}}),
  rename:(id:string,name:string)=>apiRequest<PersonaGroup>(`/api/v1/persona-groups/${encodeURIComponent(id)}`,{method:'PUT',body:{name}}),
  move:(id:string,direction:'up'|'down')=>apiRequest<PersonaGroup>(`/api/v1/persona-groups/${encodeURIComponent(id)}/move`,{method:'POST',body:{direction}}),
  reorder:(id:string,position:number)=>apiRequest<PersonaGroup>(`/api/v1/persona-groups/${encodeURIComponent(id)}/reorder`,{method:'POST',body:{position}}),
  remove:(id:string)=>apiRequest(`/api/v1/persona-groups/${encodeURIComponent(id)}`,{method:'DELETE'}),
};
