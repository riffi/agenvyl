import type {CreateProjectRequest,DirectoryPickerResult,LocalProject,UpdateProjectRequest} from '@agenvyl/contracts';
import {apiRequest} from '../../../shared/api';

export const projectKeys={all:['projects'] as const};
export const projectsApi={
  list:(signal?:AbortSignal)=>apiRequest<LocalProject[]>('/api/v1/projects',{signal}),
  create:(input:CreateProjectRequest)=>apiRequest<LocalProject>('/api/v1/projects',{method:'POST',body:input}),
  update:(id:string,input:UpdateProjectRequest)=>apiRequest<LocalProject>(`/api/v1/projects/${encodeURIComponent(id)}`,{method:'PATCH',body:input}),
  remove:(id:string)=>apiRequest(`/api/v1/projects/${encodeURIComponent(id)}`,{method:'DELETE'}),
  pickDirectory:()=>apiRequest<DirectoryPickerResult>('/api/v1/projects/pick-directory',{method:'POST'}),
};
