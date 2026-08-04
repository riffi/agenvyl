import type {ConnectorDirectoryPickerResult,ConnectorDirectoryValidation} from '@agenvyl/connector-contract';
import type {LocalProject,ProjectAvailability} from '@agenvyl/contracts';
import {AppError} from '../../shared/errors/AppError.js';
import type {ProjectRepository,ProjectRow} from './projects.repository.js';

type DirectoryConnector={validateDirectory(path:string):Promise<ConnectorDirectoryValidation>;pickDirectory():Promise<ConnectorDirectoryPickerResult>};

export class ProjectsService{
  constructor(private readonly projects:ProjectRepository,private readonly connector:DirectoryConnector){}
  async list(){return Promise.all((await this.projects.list()).map(project=>this.present(project)));}
  async create(input:{name?:string;path?:string}){
    const name=projectName(input.name),validated=await this.requireDirectory(input.path);
    try{return this.present(await this.projects.create({name,path:validated.path,pathKey:validated.pathKey}));}
    catch{throw new AppError('project_conflict',409,'A project with this name or folder already exists');}
  }
  async update(id:string,input:{name?:string;path?:string}){
    const current=await this.projects.find(id);
    if(!current)throw new AppError('project_not_found',404,'Project not found');
    const name=input.name===undefined?current.name:projectName(input.name);
    const validated=input.path===undefined?{path:current.path,pathKey:current.pathKey}:await this.requireDirectory(input.path);
    try{return this.present((await this.projects.update(id,{name,...validated}))!);}
    catch{throw new AppError('project_conflict',409,'A project with this name or folder already exists');}
  }
  async delete(id:string){if(!await this.projects.delete(id))throw new AppError('project_not_found',404,'Project not found');}
  async pick(){const result=await this.connector.pickDirectory();if(result.status==='selected')return{status:'selected' as const,path:result.path};if(result.status==='cancelled')return{status:'cancelled' as const};return{status:'unavailable' as const,message:result.error?.message};}
  private async requireDirectory(path?:string){
    if(!path?.trim())throw new AppError('project_path_required',400,'Project path is required');
    let result:ConnectorDirectoryValidation;
    try{result=await this.connector.validateDirectory(path);}catch{throw new AppError('connector_unavailable',503,'Connector cannot validate the project folder');}
    if(result.status!=='available')throw new AppError(result.error?.code??'project_path_unavailable',400,result.error?.message??'Project folder is unavailable');
    return{path:result.path!,pathKey:result.pathKey!};
  }
  private async present(project:ProjectRow):Promise<LocalProject>{
    let availability:ProjectAvailability='unknown';
    try{availability=(await this.connector.validateDirectory(project.path)).status==='available'?'available':'unavailable';}catch{/* Connector status is represented as unknown. */}
    return{id:project.id,name:project.name,path:project.path,availability,created_at:project.createdAt,updated_at:project.updatedAt};
  }
}

const projectName=(input?:string)=>{const name=input?.trim();if(!name)throw new AppError('project_name_required',400,'Project name is required');if(name.length>80)throw new AppError('project_name_invalid',400,'Project name must be at most 80 characters');return name;};
