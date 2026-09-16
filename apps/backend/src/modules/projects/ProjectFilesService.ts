import type {ProjectInspection,ProjectPreviewSettings,WorkspaceAttachment} from '@agenvyl/contracts';
import type {ProjectFileOperation,ProjectFileRequest} from '@agenvyl/connector-contract';
import {ConnectorClientError,type HttpConnectorClient} from '../../integrations/connector/HttpConnectorClient.js';
import {AppError} from '../../shared/errors/AppError.js';
import type {ProjectRepository} from './projects.repository.js';
import type {RoomWorkspaceService} from '../workspace/RoomWorkspaceService.js';

export class ProjectFilesService{
  constructor(private projects:ProjectRepository,private connector:Pick<HttpConnectorClient,'projectFiles'>,private workspace:RoomWorkspaceService){}
  private async call<T extends ProjectFileOperation>(id:string,operation:T,input:Omit<ProjectFileRequest,'root'>={}){
    const project=await this.projects.find(id);if(!project)throw new AppError('project_not_found',404,'Project not found');
    try{return await this.connector.projectFiles(operation,{...input,root:project.path});}
    catch(error){if(error instanceof ConnectorClientError)throw new AppError(error.serverCode??error.code,error.status??503,error.message);throw error;}
  }
  async list(id:string,path:string){return this.call(id,'list',{path});}
  async search(id:string,query:string){return this.call(id,'search',{path:query});}
  async inspect(id:string):Promise<ProjectInspection>{
    const [discovery,settings]=await Promise.all([this.call(id,'inspect'),this.projects.previewSettings(id)]);
    return{...discovery,settings,entrypoint:settings.entrypoint??(discovery.candidates.length===1?discovery.candidates[0]:null),build_command:settings.build_command??discovery.detected_command};
  }
  async saveSettings(id:string,settings:ProjectPreviewSettings){
    const project=await this.projects.find(id);if(!project)throw new AppError('project_not_found',404,'Project not found');
    if(settings.entrypoint){if(!/\.html?$/i.test(settings.entrypoint))throw new AppError('project_html_required',400,'Select an HTML file');await this.file(id,settings.entrypoint);}
    return this.projects.savePreviewSettings(id,{entrypoint:settings.entrypoint?.trim()||null,build_command:settings.build_command?.trim()||null});
  }
  async file(id:string,path:string){return this.decode(await this.call(id,'read',{path}));}
  async preview(id:string,entrypoint:string,path:string){return this.decode(await this.call(id,'preview',{entrypoint,path}));}
  private decode(file:{data:string;mime_type:string}){
    return{data:Buffer.from(file.data,'base64'),mime_type:file.mime_type};
  }
  async build(id:string){const inspection=await this.inspect(id);if(!inspection.build_command)throw new AppError('project_build_missing',400,'Set a build command in Build settings');return this.call(id,'build',{command:inspection.build_command});}
  async buildStatus(id:string){return this.call(id,'build-status');}
  async cancel(id:string){return this.call(id,'cancel');}
  async attach(id:string,roomId:string,path:string):Promise<WorkspaceAttachment>{
    if(await this.projects.roomProject(roomId)!==id)throw new AppError('room_project_changed',409,'The room project has changed');
    const file=await this.file(id,path),name=path.replaceAll('\\','/').split('/').pop()!;
    const saved=await this.workspace.upload(roomId,encodeURIComponent(`project-attachments/${crypto.randomUUID()}/${name}`),file.mime_type,file.data,'fail',true);
    if(!saved.version)throw new AppError('attachment_failed',500,'Could not capture the project attachment');
    const version=await this.workspace.version(roomId,saved.version.id);
    return{version_id:version.id,entry_id:version.entry_id,name,path:version.path,size:version.size,mime_type:version.mime_type,url:version.url,preview_url:version.preview_url};
  }
}
