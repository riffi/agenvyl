import {createHash} from 'node:crypto';
import {createReadStream,watch,type FSWatcher} from 'node:fs';
import {copyFile,mkdir,readdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {AppError} from '../../shared/errors/AppError.js';
import type {RoomRepository} from '../rooms/rooms.repository.js';
import type {WorkspaceRepository} from './workspace.repository.js';
import {toWorkspaceVersion} from './workspace.repository.js';
import type {RoomEventService} from '../room-events/RoomEventService.js';
import type {ActiveRunRegistry} from '../runs/ActiveRunRegistry.js';
import type {RunEmbed,UpdatePlanResponse} from '@agenvyl/contracts';
import {extractWorkspaceImageReferences} from './workspaceEmbeds.js';

export class RoomWorkspaceService{
  private watchers=new Map<string,FSWatcher>();
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private reconciling=new Map<string,Promise<void>>();
  constructor(private readonly rooms:RoomRepository,private readonly repository:WorkspaceRepository,private readonly events:RoomEventService,private readonly activeRuns:ActiveRunRegistry,private readonly root:string,private readonly agentRoot:string,readonly maxFileBytes:number){}

  roomPath(roomId:string){return path.join(path.resolve(this.root),roomId);}
  agentRoomPath(roomId:string){return path.join(path.resolve(this.agentRoot),roomId);}
  objectPath(sha:string){return path.join(path.resolve(this.root),'.versions',sha.slice(0,2),sha);}
  agentObjectPath(sha:string){return path.join(path.resolve(this.agentRoot),'.versions',sha.slice(0,2),sha);}

  async ensure(roomId:string){await this.assertRoom(roomId);const directory=this.roomPath(roomId);await mkdir(directory,{recursive:true});this.startWatcher(roomId,directory);return directory;}
  async list(roomId:string,includeDeleted=false){await this.ensure(roomId);await this.reconcile(roomId);return{path:this.agentRoomPath(roomId),entries:await this.repository.list(roomId,includeDeleted)};}

  async upload(roomId:string,filePath:string|undefined,_contentType:string|undefined,body:Buffer,conflict:'fail'|'replace'|'rename'='fail'){
    if(!filePath)throw new AppError('file_name_required',400,'File name is required');
    if(!body.length)throw new AppError('empty_file',400,'File is empty');
    if(body.length>this.maxFileBytes)throw new AppError('file_too_large',413,`File size must not exceed ${Math.floor(this.maxFileBytes/1024/1024)} MB`);
    let relative=safeRelative(decodeHeaderName(filePath));const directory=await this.ensure(roomId);let target=path.join(directory,relative);
    const exists=await stat(target).then(item=>item.isFile()).catch(()=>false);
    if(exists&&conflict==='fail')throw new AppError('file_exists',409,'A file with this name already exists');
    if(exists&&conflict==='rename'){relative=await availableName(directory,relative);target=path.join(directory,relative);}
    await mkdir(path.dirname(target),{recursive:true});const temporary=`${target}.upload-${crypto.randomUUID()}`;await writeFile(temporary,body);await rename(temporary,target);
    return this.capture(roomId,relative,'user',[],'updated');
  }

  async createDirectory(roomId:string,relativeInput:string){const relative=safeRelative(relativeInput),directory=await this.ensure(roomId),target=path.join(directory,relative);if(await stat(target).then(()=>true).catch(()=>false))throw new AppError('file_exists',409,'An item with this name already exists');await mkdir(target,{recursive:false});const entry=await this.repository.saveDirectory(roomId,relative);await this.events.emit(roomId,'workspace.changed',{entry,change:'created'});return entry;}

  async move(roomId:string,entryId:string,nextPathInput:string){const nextPath=safeRelative(nextPathInput),entry=await this.repository.entryById(roomId,entryId);if(!entry||entry.deleted_at)throw new AppError('file_not_found',404,'File not found');const directory=await this.ensure(roomId),target=path.join(directory,nextPath);if(await stat(target).then(()=>true).catch(()=>false))throw new AppError('file_exists',409,'An item with this name already exists');await mkdir(path.dirname(target),{recursive:true});await rename(path.join(directory,entry.path),target);const result=await this.repository.move(roomId,entryId,nextPath);if(!result||result==='conflict')throw new AppError('file_exists',409,'An item with this name already exists');await this.events.emit(roomId,'workspace.changed',{entry:result,change:'moved'});return result;}

  async remove(roomId:string,entryId:string){const entry=await this.repository.entryById(roomId,entryId);if(!entry||entry.deleted_at)throw new AppError('file_not_found',404,'File not found');await rm(path.join(await this.ensure(roomId),entry.path),{recursive:true,force:true});const removed=await this.repository.softDelete(roomId,entryId);for(const item of removed)await this.events.emit(roomId,'workspace.changed',{entry:item,change:'deleted'});}

  async restoreEntry(roomId:string,entryId:string){const entry=await this.repository.entryById(roomId,entryId);if(!entry?.deleted_at)throw new AppError('file_not_found',404,'Deleted file not found');const directory=await this.ensure(roomId),target=path.join(directory,entry.path);if(await stat(target).then(()=>true).catch(()=>false))throw new AppError('file_exists',409,'The path is already in use');if(entry.kind==='directory'){await mkdir(target,{recursive:true});const restored=await this.repository.restoreTree(roomId,entryId);for(const item of restored){if(item.kind==='directory')await mkdir(path.join(directory,item.path),{recursive:true});else if(item.current_version_id){const version=await this.repository.version(roomId,item.current_version_id);if(version){await mkdir(path.dirname(path.join(directory,item.path)),{recursive:true});await copyFile(this.objectPath(version.sha256),path.join(directory,item.path));}}await this.events.emit(roomId,'workspace.changed',{entry:item,change:'restored'});}return{entry:restored.find(item=>item.id===entryId)};}if(!entry.current_version_id)throw new AppError('version_not_found',404,'Version not found');const version=await this.repository.version(roomId,entry.current_version_id);if(!version)throw new AppError('version_not_found',404,'Version not found');await mkdir(path.dirname(target),{recursive:true});await copyFile(this.objectPath(version.sha256),target);return this.capture(roomId,entry.path,'user',[],'updated',true);
  }

  async restoreVersion(roomId:string,versionId:string){const version=await this.versionRow(roomId,versionId),entry=await this.repository.entryById(roomId,version.entry_id);if(!entry)throw new AppError('file_not_found',404,'File not found');const target=path.join(await this.ensure(roomId),entry.path);await mkdir(path.dirname(target),{recursive:true});await copyFile(this.objectPath(version.sha256),target);return this.capture(roomId,entry.path,'user',[],'updated',true);}

  async savePlanFromRun(roomId:string,runId:string,content:string){return this.writePlan(roomId,content,'agent',[runId],true);}
  async updatePlan(roomId:string,content:string,expectedVersionId:string):Promise<UpdatePlanResponse>{
    if([...this.activeRuns.values()].some(run=>run.roomId===roomId&&!run.terminal&&run.executionProfile.workflowMode==='plan')||await this.rooms.hasActivePlanRun(roomId))throw new AppError('plan_run_active',409,'Wait for the active plan update to finish');
    const current=await this.repository.currentVersion(roomId,'plan.md');
    if(!current||current.id!==expectedVersionId)throw new AppError('plan_version_conflict',409,'plan.md changed while it was being edited');
    try{return await this.writePlan(roomId,content,'user',[],false,expectedVersionId);}catch(error){if(error instanceof Error&&error.message==='plan_version_conflict')throw new AppError('plan_version_conflict',409,'plan.md changed while it was being edited');throw error;}
  }
  async planVersionContent(roomId:string,versionId:string){const file=await this.resolveVersion(roomId,versionId);if(file.contentType!=='text/markdown')throw new AppError('invalid_approved_plan',409,'Approved plan must be Markdown');return readFile(file.path,'utf8');}

  async versions(roomId:string,entryId:string){await this.assertRoom(roomId);return(await this.repository.versions(roomId,entryId)).map(toWorkspaceVersion);}
  async resolveVersion(roomId:string,versionId:string){const version=await this.versionRow(roomId,versionId);return{path:this.objectPath(version.sha256),contentType:version.mime_type,version:toWorkspaceVersion(version)};}
  async resolvePreviewAsset(roomId:string,versionId:string,assetInput:string){const owner=await this.versionRow(roomId,versionId),asset=safeRelative(decodeURIComponent(assetInput)),logical=path.posix.join(path.posix.dirname(owner.path),asset),version=await this.repository.versionAt(roomId,logical,owner.created_at);if(!version)throw new AppError('version_not_found',404,'Related preview file not found');return{path:this.objectPath(version.sha256),contentType:version.mime_type};}
  async snapshotAgentPath(roomId:string,versionId:string){const version=await this.versionRow(roomId,versionId);return this.agentObjectPath(version.sha256);}
  streamVersion(roomId:string,versionId:string){return this.resolveVersion(roomId,versionId).then(file=>({...file,stream:createReadStream(file.path)}));}

  async settleRun(roomId:string){await this.reconcile(roomId);}
  async resolveRunEmbeds(roomId:string,runId:string,markdown:string){const supported=new Set(['image/png','image/jpeg','image/webp','image/gif']),embeds:RunEmbed[]=[];for(const reference of extractWorkspaceImageReferences(markdown)){if(reference.error){embeds.push({kind:'image',path:reference.path,status:'error',error:reference.error});continue;}const version=await this.repository.currentVersion(roomId,reference.path);if(!version){embeds.push({kind:'image',path:reference.path,status:'error',error:'not_found'});continue;}if(!supported.has(version.mime_type)){embeds.push({kind:'image',path:reference.path,status:'error',error:'unsupported_type'});continue;}const content=await readFile(this.objectPath(version.sha256));if(!content.length||imageMime(content)!==version.mime_type){embeds.push({kind:'image',path:reference.path,status:'error',error:'invalid_content'});continue;}embeds.push({kind:'image',path:reference.path,status:'resolved',attachment:{version_id:version.id,entry_id:version.entry_id,path:version.path,name:path.basename(version.path),size:version.size,mime_type:version.mime_type,url:`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(version.id)}`,preview_url:`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(version.id)}/preview`}});}await this.repository.saveRunEmbeds(runId,embeds);return embeds;}
  purgeCandidates(roomId:string){return this.repository.roomHashes(roomId);}
  async purgeFiles(roomId:string,hashes:string[]){this.watchers.get(roomId)?.close();this.watchers.delete(roomId);await rm(this.roomPath(roomId),{recursive:true,force:true});for(const sha of hashes)if(!await this.repository.hashExists(sha))await rm(this.objectPath(sha),{force:true});}
  close(){for(const watcher of this.watchers.values())watcher.close();for(const timer of this.timers.values())clearTimeout(timer);this.watchers.clear();this.timers.clear();}

  private startWatcher(roomId:string,directory:string){if(this.watchers.has(roomId))return;try{const watcher=watch(directory,{recursive:true},()=>{const prior=this.timers.get(roomId);if(prior)clearTimeout(prior);this.timers.set(roomId,setTimeout(()=>{this.timers.delete(roomId);void this.reconcile(roomId).catch(()=>{});},350));});watcher.on('error',()=>{watcher.close();this.watchers.delete(roomId);});this.watchers.set(roomId,watcher);}catch{/* reconciliation on list/run still guarantees correctness */}}

  private async reconcile(roomId:string){const prior=this.reconciling.get(roomId);if(prior)return prior;const task=this.performReconcile(roomId).finally(()=>this.reconciling.delete(roomId));this.reconciling.set(roomId,task);return task;}
  private async performReconcile(roomId:string){const directory=this.roomPath(roomId);await mkdir(directory,{recursive:true});const disk=await walk(directory),known=await this.repository.list(roomId),seen=new Set<string>();for(const item of disk){seen.add(item.path);const existing=known.find(entry=>entry.path===item.path&&!entry.deleted_at);if(item.kind==='directory'){const entry=await this.repository.saveDirectory(roomId,item.path,item.updatedAt);if(!existing)await this.events.emit(roomId,'workspace.changed',{entry,change:'created'});continue;}if(item.size===0)continue;if(item.size>this.maxFileBytes){if(!existing||existing.size!==item.size||existing.status!=='oversize'){const entry=await this.repository.markOversize(roomId,item.path,item.size,mimeFor(item.path));await this.events.emit(roomId,'workspace.changed',{entry,change:existing?'updated':'created'});}continue;}const data=await readFile(path.join(directory,item.path)),sha=hash(data);if(existing?.current_version_id){const version=await this.repository.version(roomId,existing.current_version_id);if(version?.sha256===sha)continue;}const runs=[...this.activeRuns.values()].filter(run=>run.roomId===roomId&&run.started&&!run.terminal).map(run=>run.id);await this.captureBuffer(roomId,item.path,data,runs.length?'agent':'external',runs,existing?'updated':'created');}
    for(const entry of known.filter(item=>!item.deleted_at&&!seen.has(item.path))){const runs=[...this.activeRuns.values()].filter(run=>run.roomId===roomId&&run.started&&!run.terminal).map(run=>run.id),removed=await this.repository.softDelete(roomId,entry.id);for(const item of removed)await this.events.emit(roomId,'workspace.changed',{entry:item,change:'deleted'});if(entry.current_version_id&&runs.length){const version=await this.repository.version(roomId,entry.current_version_id);if(version){const attribution=runs.length===1?'exact':'shared';await this.repository.linkArtifacts(runs,version,'deleted',attribution);for(const runId of runs)await this.events.emit(roomId,'artifact.created',{runId,artifact:{version_id:version.id,entry_id:version.entry_id,path:version.path,name:path.basename(version.path),size:version.size,mime_type:version.mime_type,url:`/api/v1/rooms/${roomId}/workspace/versions/${version.id}`,preview_url:`/api/v1/rooms/${roomId}/workspace/versions/${version.id}/preview`,change:'deleted',attribution}});}}}
  }

  private async capture(roomId:string,relative:string,source:'user'|'agent'|'external',runIds:string[],change:'created'|'updated',force=false){const data=await readFile(path.join(this.roomPath(roomId),relative));return this.captureBuffer(roomId,relative,data,source,runIds,change,force);}
  private async writePlan(roomId:string,content:string,source:'user'|'agent',runIds:string[],force=false,expectedCurrentVersionId?:string):Promise<UpdatePlanResponse>{
    const data=Buffer.from(content,'utf8');
    if(!content.trim())throw new AppError('empty_plan',400,'Plan content is required');
    if(data.length>this.maxFileBytes)throw new AppError('file_too_large',413,`Plan must not exceed ${Math.floor(this.maxFileBytes/1024/1024)} MB`);
    const directory=await this.ensure(roomId),target=path.join(directory,'plan.md'),created=!await stat(target).then(item=>item.isFile()).catch(()=>false);
    const temporary=path.join(path.resolve(this.root),'.versions','tmp',`${roomId}-${crypto.randomUUID()}.plan`);
    await mkdir(path.dirname(temporary),{recursive:true});
    await writeFile(temporary,data);
    let captured;
    try{captured=await this.captureBuffer(roomId,'plan.md',data,source,runIds,created?'created':'updated',force,expectedCurrentVersionId);await rename(temporary,target);}catch(error){await rm(temporary,{force:true});throw error;}
    const version=captured.version??await this.repository.currentVersion(roomId,'plan.md');
    if(!version)throw new Error('Could not capture plan.md version');
    return{entry:captured.entry,version:'url' in version?version:toWorkspaceVersion(version)};
  }
  private async captureBuffer(roomId:string,relative:string,data:Buffer,source:'user'|'agent'|'external',runIds:string[],change:'created'|'updated',force=false,expectedCurrentVersionId?:string){const sha=hash(data),object=this.objectPath(sha);await mkdir(path.dirname(object),{recursive:true});if(!await stat(object).then(()=>true).catch(()=>false)){const temporary=`${object}.${crypto.randomUUID()}.tmp`;await writeFile(temporary,data);await rename(temporary,object).catch(async error=>{await rm(temporary,{force:true});if(!await stat(object).then(()=>true).catch(()=>false))throw error;});}const result=await this.repository.saveVersion({roomId,path:relative,size:data.length,mimeType:mimeFor(relative,data),sha256:sha,source,runIds,force,artifactChange:runIds.length?change:undefined,expectedCurrentVersionId});if(!result.version)return{entry:result.entry};await this.events.emit(roomId,'workspace.changed',{entry:result.entry,change:result.created?'created':'updated'});if(runIds.length){const attribution=runIds.length===1?'exact':'shared';for(const runId of runIds)await this.events.emit(roomId,'artifact.created',{runId,artifact:{version_id:result.version.id,entry_id:result.version.entry_id,path:result.version.path,name:path.basename(result.version.path),size:result.version.size,mime_type:result.version.mime_type,url:`/api/v1/rooms/${roomId}/workspace/versions/${result.version.id}`,preview_url:`/api/v1/rooms/${roomId}/workspace/versions/${result.version.id}/preview`,change,attribution}});}return{entry:result.entry,version:toWorkspaceVersion(result.version)};}
  private async versionRow(roomId:string,id:string){await this.assertRoom(roomId);const version=await this.repository.version(roomId,id);if(!version)throw new AppError('version_not_found',404,'Version not found');return version;}
  private async assertRoom(roomId:string){if(!await this.rooms.exists(roomId))throw new AppError('room_not_found',404,'Room not found');}
}

async function walk(root:string,prefix=''):Promise<Array<{path:string;kind:'file'|'directory';size:number;updatedAt:string}>>{const result:Array<{path:string;kind:'file'|'directory';size:number;updatedAt:string}>=[];for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})){if(entry.name==='.hermes'||entry.name==='.versions'||entry.isSymbolicLink())continue;const relative=prefix?`${prefix}/${entry.name}`:entry.name,details=await stat(path.join(root,relative));if(entry.isDirectory()){result.push({path:relative,kind:'directory',size:0,updatedAt:details.mtime.toISOString()});result.push(...await walk(root,relative));}else if(entry.isFile())result.push({path:relative,kind:'file',size:details.size,updatedAt:details.mtime.toISOString()});}return result;}
function safeRelative(value:string){const normalized=value.normalize('NFC').trim().replaceAll('\\','/').replace(/^\/+|\/+$/g,'');if(!normalized||normalized==='.'||normalized==='..'||normalized.split('/').some(part=>!part||part==='.'||part==='..'||part.includes('\0'))||path.posix.normalize(normalized)!==normalized)throw new AppError('invalid_file_name',400,'Invalid file path');return normalized;}
function decodeHeaderName(value:string){try{return decodeURIComponent(value);}catch{throw new AppError('invalid_file_name',400,'Invalid file name');}}
async function availableName(root:string,relative:string){const parsed=path.posix.parse(relative);for(let index=2;index<10_000;index++){const candidate=path.posix.join(parsed.dir,`${parsed.name} (${index})${parsed.ext}`);if(!await stat(path.join(root,candidate)).then(()=>true).catch(()=>false))return candidate;}throw new AppError('file_exists',409,'Could not find an available name');}
function hash(data:Buffer){return createHash('sha256').update(data).digest('hex');}
function mimeFor(name:string,data?:Buffer){switch(path.extname(name).toLowerCase()){case'.png':return'image/png';case'.jpg':case'.jpeg':return'image/jpeg';case'.webp':return'image/webp';case'.gif':return'image/gif';case'.svg':return'image/svg+xml';case'.html':case'.htm':return'text/html';case'.md':case'.markdown':return'text/markdown';case'.txt':case'.log':return'text/plain';case'.css':return'text/css';case'.js':case'.mjs':return'text/javascript';case'.json':return'application/json';default:return data&&data.subarray(0,1024).every(byte=>byte===9||byte===10||byte===13||(byte>=32&&byte<127))?'text/plain':'application/octet-stream';}}
function imageMime(data:Buffer){if(data.length>=8&&data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return'image/png';if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return'image/jpeg';if(data.length>=12&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return'image/webp';if(data.length>=6&&['GIF87a','GIF89a'].includes(data.toString('ascii',0,6)))return'image/gif';return undefined;}
