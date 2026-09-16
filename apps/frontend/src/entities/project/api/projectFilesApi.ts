import type {ProjectBuild,ProjectDirectory,ProjectInspection,ProjectPreviewSettings,WorkspaceAttachment} from '@agenvyl/contracts';
import {apiRequest} from '../../../shared/api';
const base=(id:string)=>`/api/v1/projects/${encodeURIComponent(id)}`;
export const projectFilesApi={
  list:(id:string,path:string,signal?:AbortSignal)=>apiRequest<ProjectDirectory>(`${base(id)}/files?${new URLSearchParams({path})}`,{signal}),
  inspect:(id:string,signal?:AbortSignal)=>apiRequest<ProjectInspection>(`${base(id)}/inspection`,{signal}),
  saveSettings:(id:string,body:ProjectPreviewSettings)=>apiRequest<ProjectPreviewSettings>(`${base(id)}/preview-settings`,{method:'PUT',body}),
  build:(id:string)=>apiRequest<ProjectBuild>(`${base(id)}/build`,{method:'POST'}),
  buildStatus:(id:string,signal?:AbortSignal)=>apiRequest<ProjectBuild|null>(`${base(id)}/build`,{signal}),
  cancel:(id:string)=>apiRequest<ProjectBuild|null>(`${base(id)}/build/cancel`,{method:'POST'}),
  attach:(id:string,roomId:string,path:string)=>apiRequest<WorkspaceAttachment>(`${base(id)}/attach`,{method:'POST',body:{roomId,path}}),
  fileUrl:(id:string,path:string,modified:string,inline=false)=>`${base(id)}/file?${new URLSearchParams({path,v:modified,...(inline?{inline:'1'}:{})})}`,
  previewUrl:(id:string,path:string)=>`${base(id)}/preview/${btoa(String.fromCharCode(...new TextEncoder().encode(path))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}/`,
};
