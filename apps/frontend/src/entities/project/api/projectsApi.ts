import type {DirectoryListing,CreateProjectRequest,DirectoryPickerResult,LocalProject,UpdateProjectRequest} from '@agenvyl/contracts';
import {apiRequest} from '../../../shared/api';

export const projectKeys={all:['projects'] as const};
export const projectsApi={
  directories:(path?:string,signal?:AbortSignal)=>apiRequest<DirectoryListing>(`/api/v1/projects/directories?${new URLSearchParams(path?{path}:{})}`,{signal}),
  list:(signal?:AbortSignal)=>apiRequest<LocalProject[]>('/api/v1/projects',{signal}),
  create:(input:CreateProjectRequest)=>apiRequest<LocalProject>('/api/v1/projects',{method:'POST',body:input}),
  update:(id:string,input:UpdateProjectRequest)=>apiRequest<LocalProject>(`/api/v1/projects/${encodeURIComponent(id)}`,{method:'PATCH',body:input}),
  remove:(id:string)=>apiRequest(`/api/v1/projects/${encodeURIComponent(id)}`,{method:'DELETE'}),
  pickDirectory:()=>apiRequest<DirectoryPickerResult>('/api/v1/projects/pick-directory',{method:'POST'}),
};
