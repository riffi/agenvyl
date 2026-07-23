import {createHash} from 'node:crypto';
import {constants,createReadStream,watch,type FSWatcher} from 'node:fs';
import {copyFile,lstat,mkdir,readdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime';
import {AppError} from '../../shared/errors/AppError.js';
import type {RoomRepository} from '../rooms/rooms.repository.js';
import type {WorkspaceRepository} from './workspace.repository.js';
import {toWorkspaceVersion} from './workspace.repository.js';
import type {RoomEventService} from '../room-events/RoomEventService.js';
import type {ActiveRunRegistry} from '../runs/ActiveRunRegistry.js';
import type {ResolveWorkspaceConflictsRequest,RunEmbed,RunWorkspaceResult,UpdatePlanResponse,WorkspaceCaptureError} from '@agenvyl/contracts';
import {extractWorkspaceImageReferences} from './workspaceEmbeds.js';
import {assertPlanModeEnabled} from '../features/planMode.js';
import type {WorkspaceSnapshotRepository} from './workspaceSnapshots.repository.js';
import {diffSnapshots,type SnapshotEntry} from './workspaceSnapshots.js';
import {RunWorkspaceCleanup} from './RunWorkspaceCleanup.js';

type WorkspaceLogger={info:(context:Record<string,unknown>,message:string)=>void;warn:(context:Record<string,unknown>,message:string)=>void};

export class RoomWorkspaceService{
  private watchers=new Map<string,FSWatcher>();
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private reconciling=new Map<string,Promise<void>>();
  private materializing=new Set<string>();
  private roomMutations=new Map<string,Promise<void>>();
  private readonly runCleanup:RunWorkspaceCleanup;
  constructor(private readonly rooms:RoomRepository,private readonly repository:WorkspaceRepository,private readonly events:RoomEventService,private readonly activeRuns:ActiveRunRegistry,private readonly root:string,private readonly agentRoot:string,readonly maxFileBytes:number,private readonly planModeEnabled?:boolean,private readonly snapshots?:WorkspaceSnapshotRepository,private readonly logger?:WorkspaceLogger){
    this.runCleanup=new RunWorkspaceCleanup(
      async task=>rm(path.join(this.roomPath(task.roomId),'.agenvyl','runs',task.runId),{recursive:true,force:true,maxRetries:5,retryDelay:100}),
      logger,
    );
  }

  roomPath(roomId:string){return path.join(path.resolve(this.root),roomId);}
  agentRoomPath(roomId:string){return path.join(path.resolve(this.agentRoot),roomId);}
  objectPath(sha:string){return path.join(path.resolve(this.root),'.versions',sha.slice(0,2),sha);}
  agentObjectPath(sha:string){return path.join(path.resolve(this.agentRoot),'.versions',sha.slice(0,2),sha);}
  runRelativePath(runId:string){return`.agenvyl/runs/${runId}/workspace`;}
  runPath(roomId:string,runId:string){return path.join(this.roomPath(roomId),'.agenvyl','runs',runId,'workspace');}

  async ensure(roomId:string){await this.assertRoom(roomId);const directory=this.roomPath(roomId);await mkdir(directory,{recursive:true});this.startWatcher(roomId,directory);return directory;}
  async list(roomId:string,includeDeleted=false){await this.ensure(roomId);await this.reconcile(roomId);const current=await this.snapshots?.current(roomId);return{path:this.agentRoomPath(roomId),current_snapshot_id:current?.id??'',materialization_status:current?.materializationStatus??'ready' as const,entries:await this.repository.list(roomId,includeDeleted)};}
  async recover(){if(!this.snapshots)return;const started=Date.now(),materializations=await this.snapshots.materializationsToRecover(),worktrees=await this.snapshots.capturedWorktrees();for(const item of materializations)await this.materializeSnapshot(item.roomId,item.snapshotId).catch(()=>{});let removed=0,deferred=0;for(const item of worktrees){if(await this.cleanupRunDirectory(item.roomId,item.runId,'recovery'))removed++;else deferred++;}this.logger?.info({metric:'workspace.recovery',durationMs:Date.now()-started,materializations:materializations.length,orphanWorktreesRemoved:removed,orphanWorktreesDeferred:deferred},'Workspace recovery completed');}

  async prepareRun(roomId:string,runId:string){
    const started=Date.now();
    if(!this.snapshots){await this.ensure(roomId);return{relativePath:'.',absolutePath:this.agentRoomPath(roomId)};}
    const roomDirectory=await this.ensure(roomId);
    await this.ensureManagedRunRoot(roomId,roomDirectory);
    const result=await this.snapshots.prepareRun(roomId,runId),target=this.runPath(roomId,runId);
    await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
    try{
      const baselineEntries=await this.snapshots.entries(result.base_snapshot_id);
      for(const entry of baselineEntries){
        const destination=path.join(target,...entry.path.split('/'));
        if(entry.kind==='directory'){await mkdir(destination,{recursive:true});continue;}
        const version=entry.versionId?await this.repository.version(roomId,entry.versionId):undefined;
        if(!version)throw new Error(`Workspace version for ${entry.path} is unavailable`);
        await mkdir(path.dirname(destination),{recursive:true});
        await copyFile(this.objectPath(version.sha256),destination,constants.COPYFILE_FICLONE);
      }
      await this.snapshots.markReady(runId);
      this.logger?.info({metric:'workspace.prepare',roomId,runId,durationMs:Date.now()-started,entryCount:baselineEntries.length},'Run workspace prepared');
      return{relativePath:this.runRelativePath(runId),absolutePath:path.join(this.agentRoomPath(roomId),'.agenvyl','runs',runId,'workspace')};
    }catch(error){
      await this.snapshots.markFailed(runId,{path:'',code:'read_failed'});
      await rm(path.dirname(target),{recursive:true,force:true});
      this.logger?.warn({metric:'workspace.prepare',roomId,runId,durationMs:Date.now()-started,error:error instanceof Error?error.message:String(error)},'Run workspace preparation failed');
      throw new AppError('workspace_prepare_failed',500,'Could not prepare the isolated run workspace');
    }
  }
  runWorkspaceResult(runId:string){return this.snapshots?.result(runId);}

  async writeRunPlan(roomId:string,runId:string,content:string){
    const data=Buffer.from(content,'utf8');
    if(!content.trim())throw new AppError('empty_plan',400,'Plan content is required');
    if(data.length>this.maxFileBytes)throw new AppError('file_too_large',413,`Plan must not exceed ${Math.floor(this.maxFileBytes/1024/1024)} MB`);
    const target=path.join(this.runPath(roomId,runId),'plan.md');await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data);
  }

  async finalizeRun(roomId:string,runId:string,status:'completed'|'failed'|'cancelled'):Promise<RunWorkspaceResult|undefined>{
    const started=Date.now();
    if(!this.snapshots){await this.settleRun(roomId);return undefined;}
    const existing=await this.snapshots.result(runId);
    if(!existing)return undefined;
    if(existing.capture_status==='failed')return existing;
    if(existing.result_snapshot_id){
      let resumed=existing;
      const baseEntries=await this.snapshots.entries(existing.base_snapshot_id),resultEntries=await this.snapshots.entries(existing.result_snapshot_id),changes=diffSnapshots(baseEntries,resultEntries).flatMap(change=>{const versionId=change.next?.versionId??change.prior?.versionId;return versionId?[{versionId,change:change.change}]:[]});
      await this.snapshots.replaceRunArtifacts(runId,changes);
      if(status==='completed'&&existing.capture_status==='complete'&&existing.publish_status==='pending'){
        resumed=await this.withPublication(roomId,async()=>{const before=(await this.snapshots!.current(roomId))?.id,published=await this.snapshots!.publishRun(roomId,runId);if(published.published_snapshot_id){await this.materializeSnapshot(roomId,published.published_snapshot_id).catch(()=>{});if(before)await this.emitPublishedChanges(roomId,before,published.published_snapshot_id)}return published});
      }else if(status!=='completed'&&existing.publish_status==='pending'){
        await this.snapshots.markNotPublished(runId);resumed=(await this.snapshots.result(runId))!;
      }
      if(status==='completed'&&resumed.published_snapshot_id&&existing.publish_status!=='pending')await this.withPublication(roomId,()=>this.materializeSnapshot(roomId,resumed.published_snapshot_id!).catch(()=>{}));
      await this.cleanupRunDirectory(roomId,runId,'finalization');
      await this.events.emit(roomId,'run.workspace.finalized',{runId,workspaceResult:resumed}).catch(()=>{});
      if(resumed.publish_status==='published'||resumed.publish_status==='partially_published')await this.events.emit(roomId,'run.workspace.publish.updated',{runId,workspaceResult:resumed}).catch(()=>{});
      this.logger?.info({metric:'workspace.capture',roomId,runId,durationMs:Date.now()-started,captureStatus:resumed.capture_status,publishStatus:resumed.publish_status,conflicts:resumed.conflict_count,recovered:true},'Run workspace finalization resumed');
      return resumed;
    }
    await this.snapshots.markFinalizing(runId);
    const base=await this.snapshots.entries(existing.base_snapshot_id),baseVersions=new Map<string,Awaited<ReturnType<WorkspaceRepository['version']>>>();
    for(const entry of base)if(entry.versionId)baseVersions.set(entry.path,await this.repository.version(roomId,entry.versionId));
    const scanned=await scanRunTree(this.runPath(roomId,runId),this.maxFileBytes),entries:SnapshotEntry[]=[],errors=[...scanned.errors];
    try{
      for(const item of scanned.entries){
        if(item.kind==='directory'){entries.push({path:item.path,kind:'directory'});continue;}
        const data=await stableRead(path.join(this.runPath(roomId,runId),...item.path.split('/'))).catch(()=>undefined);
        if(!data){errors.push({path:item.path,code:'unstable'});continue;}
        if(data.length>this.maxFileBytes){errors.push({path:item.path,code:'oversize'});continue;}
        const sha=hash(data),prior=baseVersions.get(item.path);
        if(prior?.sha256===sha){entries.push({path:item.path,kind:'file',versionId:prior.id});continue;}
        await this.storeObject(sha,data);
        const version=await this.repository.saveDetachedVersion({roomId,path:item.path,size:data.length,mimeType:mimeFor(item.path,data),sha256:sha,runId});
        entries.push({path:item.path,kind:'file',versionId:version.id});
      }
      const completeness=errors.length?'incomplete' as const:'complete' as const,resultSnapshotId=await this.snapshots.saveRunSnapshot({roomId,runId,baseSnapshotId:existing.base_snapshot_id,entries,completeness,errors});
      const resultEntries=await this.snapshots.entries(resultSnapshotId),changes=diffSnapshots(base,resultEntries).flatMap(change=>{
        const versionId=change.next?.versionId??change.prior?.versionId;
        return versionId?[{versionId,change:change.change}]:[];
      });
      await this.snapshots.replaceRunArtifacts(runId,changes);
      let result=(await this.snapshots.result(runId))!;
      if(status==='completed'&&completeness==='complete'){
        result=await this.withPublication(roomId,async()=>{const before=(await this.snapshots!.current(roomId))?.id,published=await this.snapshots!.publishRun(roomId,runId);if(published.published_snapshot_id){await this.materializeSnapshot(roomId,published.published_snapshot_id).catch(()=>{});if(before)await this.emitPublishedChanges(roomId,before,published.published_snapshot_id)}return published});
      }else await this.snapshots.markNotPublished(runId);
      result=(await this.snapshots.result(runId))!;
      for(const change of changes){
        const version=await this.repository.version(roomId,change.versionId);if(!version)continue;
        const snapshotId=change.change==='deleted'?existing.base_snapshot_id:resultSnapshotId;
        await this.events.emit(roomId,'artifact.created',{runId,artifact:{version_id:version.id,...(version.entry_id?{entry_id:version.entry_id}:{}),snapshot_id:snapshotId,path:version.path,name:path.basename(version.path),size:version.size,mime_type:version.mime_type,url:`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(version.id)}`,preview_url:`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/snapshots/${encodeURIComponent(snapshotId)}/preview/${version.path.split('/').map(encodeURIComponent).join('/')}`,change:change.change,attribution:'exact'}}).catch(()=>{});
      }
      await this.cleanupRunDirectory(roomId,runId,'finalization');
      await this.events.emit(roomId,'run.workspace.finalized',{runId,workspaceResult:result}).catch(()=>{});
      if(result.publish_status==='published'||result.publish_status==='partially_published')await this.events.emit(roomId,'run.workspace.publish.updated',{runId,workspaceResult:result}).catch(()=>{});
      this.logger?.info({metric:'workspace.capture',roomId,runId,durationMs:Date.now()-started,captureStatus:result.capture_status,publishStatus:result.publish_status,conflicts:result.conflict_count,errorCount:result.errors.length},'Run workspace finalized');
      return result;
    }catch(error){
      await this.snapshots.markFailed(runId,{path:'',code:'read_failed'});
      this.logger?.warn({metric:'workspace.capture',roomId,runId,durationMs:Date.now()-started,error:error instanceof Error?error.message:String(error)},'Run workspace finalization failed');
      throw error;
    }
  }

  async conflicts(roomId:string,runId:string){if(!this.snapshots)throw new AppError('workspace_snapshots_unavailable',409,'Workspace snapshots are unavailable');return this.snapshots.conflicts(roomId,runId);}
  async resolveConflicts(roomId:string,runId:string,input:ResolveWorkspaceConflictsRequest){
    if(!this.snapshots)throw new AppError('workspace_snapshots_unavailable',409,'Workspace snapshots are unavailable');
    let result:RunWorkspaceResult;
    try{
      result=await this.withPublication(roomId,async()=>{const before=(await this.snapshots!.current(roomId))?.id,resolved=await this.snapshots!.resolveConflicts(roomId,runId,input.expected_current_snapshot_id,input.resolutions);if(resolved.published_snapshot_id){await this.materializeSnapshot(roomId,resolved.published_snapshot_id).catch(()=>{});if(before)await this.emitPublishedChanges(roomId,before,resolved.published_snapshot_id)}return resolved});
    }catch(error){
      if(error instanceof AppError&&error.code==='workspace_conflict_stale'){
        const refreshed=await this.snapshots.result(runId);
        if(refreshed)await this.events.emit(roomId,'run.workspace.publish.updated',{runId,workspaceResult:refreshed});
      }
      throw error;
    }
    await this.events.emit(roomId,'run.workspace.publish.updated',{runId,workspaceResult:result});
    return result;
  }

  async upload(roomId:string,filePath:string|undefined,_contentType:string|undefined,body:Buffer,conflict:'fail'|'replace'|'rename'='fail'){
    return this.withRoomMutation(roomId,()=>this.uploadUnlocked(roomId,filePath,body,conflict));
  }

  private async uploadUnlocked(roomId:string,filePath:string|undefined,body:Buffer,conflict:'fail'|'replace'|'rename'){
    if(!filePath)throw new AppError('file_name_required',400,'File name is required');
    if(!body.length)throw new AppError('empty_file',400,'File is empty');
    if(body.length>this.maxFileBytes)throw new AppError('file_too_large',413,`File size must not exceed ${Math.floor(this.maxFileBytes/1024/1024)} MB`);
    let relative=safeRelative(decodeHeaderName(filePath));assertPublicPath(relative);const directory=await this.ensure(roomId);let target=path.join(directory,relative);
    const exists=await stat(target).then(item=>item.isFile()).catch(()=>false);
    if(exists&&conflict==='fail')throw new AppError('file_exists',409,'A file with this name already exists');
    if(exists&&conflict==='rename'){relative=await availableName(directory,relative);target=path.join(directory,relative);}
    await mkdir(path.dirname(target),{recursive:true});const temporary=`${target}.upload-${crypto.randomUUID()}`;await writeFile(temporary,body);await rename(temporary,target);
    return this.capture(roomId,relative,'user',[],'updated');
  }

  async createDirectory(roomId:string,relativeInput:string){return this.withRoomMutation(roomId,async()=>{const relative=safeRelative(relativeInput),directory=await this.ensure(roomId),target=path.join(directory,relative);assertPublicPath(relative);if(await stat(target).then(()=>true).catch(()=>false))throw new AppError('file_exists',409,'An item with this name already exists');await mkdir(target,{recursive:false});const entry=await this.repository.saveDirectory(roomId,relative);await this.snapshots?.refreshPublished(roomId);await this.events.emit(roomId,'workspace.changed',{entry,change:'created'});return entry;});}

  async move(roomId:string,entryId:string,nextPathInput:string){return this.withRoomMutation(roomId,async()=>{const nextPath=safeRelative(nextPathInput),entry=await this.repository.entryById(roomId,entryId);assertPublicPath(nextPath);if(!entry||entry.deleted_at)throw new AppError('file_not_found',404,'File not found');const wasPlan=entry.path==='plan.md',directory=await this.ensure(roomId),target=path.join(directory,nextPath);if(await stat(target).then(()=>true).catch(()=>false))throw new AppError('file_exists',409,'An item with this name already exists');await mkdir(path.dirname(target),{recursive:true});await rename(path.join(directory,entry.path),target);const result=await this.repository.move(roomId,entryId,nextPath);if(!result||result==='conflict')throw new AppError('file_exists',409,'An item with this name already exists');await this.snapshots?.refreshPublished(roomId);await this.events.emit(roomId,'workspace.changed',{entry:result,change:'moved'});if(wasPlan)await this.clearPlanApproval(roomId);return result;});}

  async remove(roomId:string,entryId:string){return this.withRoomMutation(roomId,async()=>{const entry=await this.repository.entryById(roomId,entryId);if(!entry||entry.deleted_at)throw new AppError('file_not_found',404,'File not found');await rm(path.join(await this.ensure(roomId),entry.path),{recursive:true,force:true});const removed=await this.repository.softDelete(roomId,entryId);await this.snapshots?.refreshPublished(roomId);for(const item of removed)await this.events.emit(roomId,'workspace.changed',{entry:item,change:'deleted'});if(entry.path==='plan.md')await this.clearPlanApproval(roomId);});}

  async restoreEntry(roomId:string,entryId:string){return this.withRoomMutation(roomId,async()=>{const entry=await this.repository.entryById(roomId,entryId);if(!entry?.deleted_at)throw new AppError('file_not_found',404,'Deleted file not found');const directory=await this.ensure(roomId),target=path.join(directory,entry.path);if(await stat(target).then(()=>true).catch(()=>false))throw new AppError('file_exists',409,'The path is already in use');if(entry.kind==='directory'){await mkdir(target,{recursive:true});const restored=await this.repository.restoreTree(roomId,entryId);for(const item of restored){if(item.kind==='directory')await mkdir(path.join(directory,item.path),{recursive:true});else if(item.current_version_id){const version=await this.repository.version(roomId,item.current_version_id);if(version){await mkdir(path.dirname(path.join(directory,item.path)),{recursive:true});await copyFile(this.objectPath(version.sha256),path.join(directory,item.path));}}await this.events.emit(roomId,'workspace.changed',{entry:item,change:'restored'});}await this.snapshots?.refreshPublished(roomId);return{entry:restored.find(item=>item.id===entryId)};}if(!entry.current_version_id)throw new AppError('version_not_found',404,'Version not found');const version=await this.repository.version(roomId,entry.current_version_id);if(!version)throw new AppError('version_not_found',404,'Version not found');await mkdir(path.dirname(target),{recursive:true});await copyFile(this.objectPath(version.sha256),target);return this.capture(roomId,entry.path,'user',[],'updated',true);});}

  async restoreVersion(roomId:string,versionId:string){return this.withRoomMutation(roomId,async()=>{const version=await this.versionRow(roomId,versionId),entry=version.entry_id?await this.repository.entryById(roomId,version.entry_id):await this.repository.entry(roomId,version.path);if(!entry)throw new AppError('file_not_found',404,'File not found');const target=path.join(await this.ensure(roomId),entry.path);await mkdir(path.dirname(target),{recursive:true});await copyFile(this.objectPath(version.sha256),target);return this.capture(roomId,entry.path,'user',[],'updated',true);});}

  async savePlanFromRun(roomId:string,runId:string,content:string){return this.writePlan(roomId,content,'agent',[runId],true);}
  async updatePlan(roomId:string,content:string,expectedVersionId:string):Promise<UpdatePlanResponse>{
    assertPlanModeEnabled(this.planModeEnabled);
    if([...this.activeRuns.values()].some(run=>run.roomId===roomId&&!run.terminal&&run.executionProfile.workflowMode==='plan')||await this.rooms.hasActivePlanRun(roomId))throw new AppError('plan_run_active',409,'Wait for the active plan update to finish');
    return this.withRoomMutation(roomId,async()=>{
      const current=await this.repository.currentVersion(roomId,'plan.md');
      if(!current||current.id!==expectedVersionId)throw new AppError('plan_version_conflict',409,'plan.md changed while it was being edited');
      try{return await this.writePlan(roomId,content,'user',[],false,expectedVersionId);}catch(error){if(error instanceof Error&&error.message==='plan_version_conflict')throw new AppError('plan_version_conflict',409,'plan.md changed while it was being edited');throw error;}
    });
  }
  async planVersionContent(roomId:string,versionId:string){const file=await this.resolveVersion(roomId,versionId);if(file.contentType!=='text/markdown')throw new AppError('invalid_approved_plan',409,'Approved plan must be Markdown');return readFile(file.path,'utf8');}

  async versions(roomId:string,entryId:string){await this.assertRoom(roomId);return(await this.repository.versions(roomId,entryId)).map(toWorkspaceVersion);}
  async version(roomId:string,versionId:string){return toWorkspaceVersion(await this.versionRow(roomId,versionId));}
  async resolveVersion(roomId:string,versionId:string){const version=await this.versionRow(roomId,versionId);return{path:this.objectPath(version.sha256),contentType:version.mime_type,version:toWorkspaceVersion(version)};}
  async resolveSnapshotFile(roomId:string,snapshotId:string,filePathInput:string){if(!this.snapshots)throw new AppError('version_not_found',404,'Snapshot not found');const filePath=safeRelative(decodeURIComponent(filePathInput)),version=await this.snapshots.snapshotFile(roomId,snapshotId,filePath);if(!version)throw new AppError('version_not_found',404,'Snapshot file not found');return{path:this.objectPath(version.sha256),contentType:version.mime_type,version:toWorkspaceVersion(version),snapshotId};}
  async resolvePreviewAsset(roomId:string,versionId:string,assetInput:string){const owner=await this.versionRow(roomId,versionId),asset=safeRelative(decodeURIComponent(assetInput)),logical=path.posix.join(path.posix.dirname(owner.path),asset),version=await this.repository.currentVersion(roomId,logical);if(!version)throw new AppError('version_not_found',404,'Related preview file not found');return{path:this.objectPath(version.sha256),contentType:version.mime_type};}
  async snapshotAgentPath(roomId:string,versionId:string){const version=await this.versionRow(roomId,versionId);return this.agentObjectPath(version.sha256);}
  streamVersion(roomId:string,versionId:string){return this.resolveVersion(roomId,versionId).then(file=>({...file,stream:createReadStream(file.path)}));}

  async settleRun(roomId:string){await this.reconcile(roomId);}
  async resolveRunEmbeds(roomId:string,runId:string,markdown:string){const supported=new Set(['image/png','image/jpeg','image/webp','image/gif']),embeds:RunEmbed[]=[],result=await this.snapshots?.result(runId),snapshotId=result?.result_snapshot_id;for(const reference of extractWorkspaceImageReferences(markdown)){if(reference.error){embeds.push({kind:'image',path:reference.path,status:'error',error:reference.error});continue;}const version=snapshotId?await this.snapshots!.snapshotFile(roomId,snapshotId,reference.path):await this.repository.currentVersion(roomId,reference.path);if(!version){embeds.push({kind:'image',path:reference.path,status:'error',error:'not_found'});continue;}if(!supported.has(version.mime_type)){embeds.push({kind:'image',path:reference.path,status:'error',error:'unsupported_type'});continue;}const content=await readFile(this.objectPath(version.sha256));if(!content.length||imageMime(content)!==version.mime_type){embeds.push({kind:'image',path:reference.path,status:'error',error:'invalid_content'});continue;}embeds.push({kind:'image',path:reference.path,status:'resolved',attachment:{version_id:version.id,...(version.entry_id?{entry_id:version.entry_id}:{}),...(snapshotId?{snapshot_id:snapshotId}:{}),path:version.path,name:path.basename(version.path),size:version.size,mime_type:version.mime_type,url:`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(version.id)}`,preview_url:snapshotId?`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/snapshots/${encodeURIComponent(snapshotId)}/preview/${reference.path.split('/').map(encodeURIComponent).join('/')}`:`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(version.id)}/preview`}});}await this.repository.saveRunEmbeds(runId,embeds);return embeds;}
  purgeCandidates(roomId:string){return this.repository.roomHashes(roomId);}
  async purgeFiles(roomId:string,hashes:string[]){this.watchers.get(roomId)?.close();this.watchers.delete(roomId);await rm(this.roomPath(roomId),{recursive:true,force:true});for(const sha of hashes)if(!await this.repository.hashExists(sha))await rm(this.objectPath(sha),{force:true});}
  close(){for(const watcher of this.watchers.values())watcher.close();for(const timer of this.timers.values())clearTimeout(timer);this.runCleanup.close();this.watchers.clear();this.timers.clear();}

  private async cleanupRunDirectory(roomId:string,runId:string,phase:'recovery'|'finalization'){
    return this.runCleanup.removeOrDefer({roomId,runId,phase});
  }

  private startWatcher(roomId:string,directory:string){if(this.watchers.has(roomId))return;try{const watcher=watch(directory,{recursive:true},()=>{if(this.materializing.has(roomId))return;const prior=this.timers.get(roomId);if(prior)clearTimeout(prior);this.timers.set(roomId,setTimeout(()=>{this.timers.delete(roomId);void this.reconcile(roomId).catch(()=>{});},350));});watcher.on('error',()=>{watcher.close();this.watchers.delete(roomId);});this.watchers.set(roomId,watcher);}catch{/* reconciliation on list/run still guarantees correctness */}}

  private async reconcile(roomId:string){const prior=this.reconciling.get(roomId);if(prior)return prior;const task=this.performReconcile(roomId).finally(()=>this.reconciling.delete(roomId));this.reconciling.set(roomId,task);return task;}
  private async performReconcile(roomId:string){const directory=this.roomPath(roomId);await mkdir(directory,{recursive:true});const disk=await walk(directory),known=await this.repository.list(roomId),seen=new Set<string>();for(const item of disk){seen.add(item.path);const existing=known.find(entry=>entry.path===item.path&&!entry.deleted_at);if(item.kind==='directory'){const entry=await this.repository.saveDirectory(roomId,item.path,item.updatedAt);if(!existing){await this.snapshots?.refreshPublished(roomId);await this.events.emit(roomId,'workspace.changed',{entry,change:'created'});}continue;}if(item.size>this.maxFileBytes){if(!existing||existing.size!==item.size||existing.status!=='oversize'){const entry=await this.repository.markOversize(roomId,item.path,item.size,mimeFor(item.path));await this.snapshots?.refreshPublished(roomId);await this.events.emit(roomId,'workspace.changed',{entry,change:existing?'updated':'created'});}continue;}const data=await readFile(path.join(directory,item.path)),sha=hash(data);if(existing?.current_version_id){const version=await this.repository.version(roomId,existing.current_version_id);if(version?.sha256===sha)continue;}const runs=this.snapshots?[]:[...this.activeRuns.values()].filter(run=>run.roomId===roomId&&run.started&&!run.terminal).map(run=>run.id);await this.captureBuffer(roomId,item.path,data,runs.length?'agent':'external',runs,existing?'updated':'created');}
    for(const entry of known.filter(item=>!item.deleted_at&&!seen.has(item.path))){const runs=this.snapshots?[]:[...this.activeRuns.values()].filter(run=>run.roomId===roomId&&run.started&&!run.terminal).map(run=>run.id),removed=await this.repository.softDelete(roomId,entry.id);if(this.snapshots)await this.snapshots.refreshPublished(roomId);for(const item of removed)await this.events.emit(roomId,'workspace.changed',{entry:item,change:'deleted'});if(entry.path==='plan.md')await this.clearPlanApproval(roomId);if(entry.current_version_id&&runs.length){const version=await this.repository.version(roomId,entry.current_version_id);if(version){const attribution=runs.length===1?'exact':'shared';await this.repository.linkArtifacts(runs,version,'deleted',attribution);for(const runId of runs)await this.events.emit(roomId,'artifact.created',{runId,artifact:{version_id:version.id,...(version.entry_id?{entry_id:version.entry_id}:{}),path:version.path,name:path.basename(version.path),size:version.size,mime_type:version.mime_type,url:`/api/v1/rooms/${roomId}/workspace/versions/${version.id}`,preview_url:`/api/v1/rooms/${roomId}/workspace/versions/${version.id}/preview`,change:'deleted',attribution}});}}}
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
  private async captureBuffer(roomId:string,relative:string,data:Buffer,source:'user'|'agent'|'external',runIds:string[],change:'created'|'updated',force=false,expectedCurrentVersionId?:string){const sha=hash(data);await this.storeObject(sha,data);const result=await this.repository.saveVersion({roomId,path:relative,size:data.length,mimeType:mimeFor(relative,data),sha256:sha,source,runIds,force,artifactChange:runIds.length?change:undefined,expectedCurrentVersionId});if(!result.version)return{entry:result.entry};if(this.snapshots&&!runIds.length)await this.snapshots.refreshPublished(roomId);await this.events.emit(roomId,'workspace.changed',{entry:result.entry,change:result.created?'created':'updated'});if(runIds.length){const attribution=runIds.length===1?'exact':'shared';for(const runId of runIds)await this.events.emit(roomId,'artifact.created',{runId,artifact:{version_id:result.version.id,...(result.version.entry_id?{entry_id:result.version.entry_id}:{}),path:result.version.path,name:path.basename(result.version.path),size:result.version.size,mime_type:result.version.mime_type,url:`/api/v1/rooms/${roomId}/workspace/versions/${result.version.id}`,preview_url:`/api/v1/rooms/${roomId}/workspace/versions/${result.version.id}/preview`,change,attribution}});}return{entry:result.entry,version:toWorkspaceVersion(result.version)};}
  private async storeObject(sha:string,data:Buffer){const object=this.objectPath(sha);await mkdir(path.dirname(object),{recursive:true});if(await stat(object).then(()=>true).catch(()=>false))return;const temporary=`${object}.${crypto.randomUUID()}.tmp`;await writeFile(temporary,data);await rename(temporary,object).catch(async error=>{await rm(temporary,{force:true});if(!await stat(object).then(()=>true).catch(()=>false))throw error;});}

  private async materializeSnapshot(roomId:string,snapshotId:string){
    if(!this.snapshots)return;
    const started=Date.now();
    const alreadyMaterializing=this.materializing.has(roomId);
    this.materializing.add(roomId);
    try{
      const root=await this.ensure(roomId),entries=await this.snapshots.entries(snapshotId),desired=new Set(entries.map(entry=>entry.path)),disk=await walk(root);let bytes=0;
      for(const item of [...disk].sort((a,b)=>b.path.length-a.path.length))if(!desired.has(item.path))await rm(path.join(root,...item.path.split('/')),{recursive:true,force:true});
      for(const entry of entries){
        const target=path.join(root,...entry.path.split('/'));
        if(entry.kind==='directory'){await mkdir(target,{recursive:true});continue;}
        const version=entry.versionId?await this.repository.version(roomId,entry.versionId):undefined;
        if(!version)throw new Error(`Published version ${entry.versionId} is unavailable`);
        bytes+=version.size;
        await mkdir(path.dirname(target),{recursive:true});const temporary=`${target}.publish-${crypto.randomUUID()}`;
        await copyFile(this.objectPath(version.sha256),temporary,constants.COPYFILE_FICLONE);await rename(temporary,target);
      }
      await this.snapshots.setMaterialization(roomId,'ready');
      this.logger?.info({metric:'workspace.materialization',roomId,snapshotId,durationMs:Date.now()-started,bytes},'Published workspace materialized');
    }catch(error){await this.snapshots.setMaterialization(roomId,'failed');this.logger?.warn({metric:'workspace.materialization',roomId,snapshotId,durationMs:Date.now()-started,error:error instanceof Error?error.message:String(error)},'Published workspace materialization failed');throw error;}
    finally{if(!alreadyMaterializing)this.materializing.delete(roomId);}
  }
  private async withRoomMutation<T>(roomId:string,operation:()=>Promise<T>):Promise<T>{
    const prior=this.roomMutations.get(roomId)??Promise.resolve();let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve}),queued=prior.catch(()=>{}).then(()=>gate);this.roomMutations.set(roomId,queued);
    await prior.catch(()=>{});
    try{return await operation()}finally{release();if(this.roomMutations.get(roomId)===queued)this.roomMutations.delete(roomId)}
  }
  private ensureManagedRunRoot(roomId:string,roomDirectory:string){
    return this.withRoomMutation(roomId,async()=>{
      const internal=path.join(roomDirectory,'.agenvyl'),marker=path.join(internal,'.managed');
      const internalEntry=await stat(internal).catch(()=>undefined);
      if(internalEntry&&(!internalEntry.isDirectory()||!await stat(marker).then(item=>item.isFile()).catch(()=>false)))throw new AppError('workspace_reserved_path_conflict',409,'The room already contains the reserved .agenvyl path');
      await mkdir(internal,{recursive:true});
      await writeFile(marker,'Agenvyl managed workspace. Do not edit.\n',{flag:'a'});
    });
  }
  private async emitPublishedChanges(roomId:string,beforeSnapshotId:string,afterSnapshotId:string){
    if(!this.snapshots||beforeSnapshotId===afterSnapshotId)return;
    const changes=diffSnapshots(await this.snapshots.entries(beforeSnapshotId),await this.snapshots.entries(afterSnapshotId));
    for(const change of changes){const entry=await this.repository.entry(roomId,change.path);if(entry)await this.events.emit(roomId,'workspace.changed',{entry,change:change.change}).catch(()=>{});}
    if(changes.some(change=>change.path==='plan.md'))await this.clearPlanApproval(roomId);
  }
  private withPublication<T>(roomId:string,operation:()=>Promise<T>){
    return this.withRoomMutation(roomId,async()=>{
      this.materializing.add(roomId);
      try{await this.reconciling.get(roomId)?.catch(()=>{});return await operation()}finally{this.materializing.delete(roomId)}
    });
  }
  private async versionRow(roomId:string,id:string){await this.assertRoom(roomId);const version=await this.repository.version(roomId,id);if(!version)throw new AppError('version_not_found',404,'Version not found');return version;}
  private async assertRoom(roomId:string){if(!await this.rooms.exists(roomId))throw new AppError('room_not_found',404,'Room not found');}
  private async clearPlanApproval(roomId:string){const state=await this.rooms.clearApprovedPlan(roomId);if(state)await this.events.emit(roomId,'room.plan.approval.updated',{approved:null});}
}

async function walk(root:string,prefix=''):Promise<Array<{path:string;kind:'file'|'directory';size:number;updatedAt:string}>>{const result:Array<{path:string;kind:'file'|'directory';size:number;updatedAt:string}>=[];for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})){if(entry.name==='.agenvyl'||entry.name==='.hermes'||entry.name==='.versions'||entry.isSymbolicLink())continue;const relative=prefix?`${prefix}/${entry.name}`:entry.name,details=await stat(path.join(root,relative));if(entry.isDirectory()){result.push({path:relative,kind:'directory',size:0,updatedAt:details.mtime.toISOString()});result.push(...await walk(root,relative));}else if(entry.isFile())result.push({path:relative,kind:'file',size:details.size,updatedAt:details.mtime.toISOString()});}return result;}
async function scanRunTree(root:string,maxBytes:number,prefix=''):Promise<{entries:Array<{path:string;kind:'file'|'directory'}>;errors:WorkspaceCaptureError[]}>{
  const entries:Array<{path:string;kind:'file'|'directory'}>=[],errors:WorkspaceCaptureError[]=[];
  for(const dirent of await readdir(path.join(root,prefix),{withFileTypes:true})){
    const relative=prefix?`${prefix}/${dirent.name}`:dirent.name,target=path.join(root,...relative.split('/')),details=await lstat(target);
    if(!prefix&&dirent.name==='.agenvyl'){errors.push({path:relative,code:'reserved'});continue;}
    if(details.isSymbolicLink()){errors.push({path:relative,code:'symlink'});continue;}
    if(details.isDirectory()){entries.push({path:relative,kind:'directory'});const nested=await scanRunTree(root,maxBytes,relative);entries.push(...nested.entries);errors.push(...nested.errors);continue;}
    if(!details.isFile())continue;
    if(details.size>maxBytes){errors.push({path:relative,code:'oversize'});continue;}
    entries.push({path:relative,kind:'file'});
  }
  return{entries,errors};
}
async function stableRead(filePath:string){
  for(let attempt=0;attempt<3;attempt++){
    const before=await stat(filePath),data=await readFile(filePath),after=await stat(filePath);
    if(before.size===after.size&&before.mtimeMs===after.mtimeMs)return data;
  }
  throw new Error('File changed while workspace snapshot was captured');
}
function safeRelative(value:string){const normalized=value.normalize('NFC').trim().replaceAll('\\','/').replace(/^\/+|\/+$/g,'');if(!normalized||normalized==='.'||normalized==='..'||normalized.split('/').some(part=>!part||part==='.'||part==='..'||part.includes('\0'))||path.posix.normalize(normalized)!==normalized)throw new AppError('invalid_file_name',400,'Invalid file path');return normalized;}
function assertPublicPath(value:string){if(value==='.agenvyl'||value.startsWith('.agenvyl/'))throw new AppError('workspace_reserved_path',400,'.agenvyl is reserved for isolated run workspaces');}
function decodeHeaderName(value:string){try{return decodeURIComponent(value);}catch{throw new AppError('invalid_file_name',400,'Invalid file name');}}
async function availableName(root:string,relative:string){const parsed=path.posix.parse(relative);for(let index=2;index<10_000;index++){const candidate=path.posix.join(parsed.dir,`${parsed.name} (${index})${parsed.ext}`);if(!await stat(path.join(root,candidate)).then(()=>true).catch(()=>false))return candidate;}throw new AppError('file_exists',409,'Could not find an available name');}
function hash(data:Buffer){return createHash('sha256').update(data).digest('hex');}
const sourceMimeTypes=new Map([
  ['.ts','text/typescript'],['.tsx','text/typescript'],['.jsx','text/javascript'],
  ['.py','text/x-python'],['.rb','text/x-ruby'],['.rs','text/x-rust'],['.go','text/x-go'],
  ['.java','text/x-java-source'],['.kt','text/x-kotlin'],['.swift','text/x-swift'],
  ['.c','text/x-c'],['.h','text/x-c'],['.cc','text/x-c++'],['.cpp','text/x-c++'],['.hpp','text/x-c++'],
  ['.sh','text/x-shellscript'],['.bash','text/x-shellscript'],['.ps1','text/x-powershell'],
  ['.sql','text/x-sql'],['.graphql','text/x-graphql'],['.gql','text/x-graphql'],
  ['.toml','text/x-toml'],['.ini','text/plain'],['.env','text/plain'],['.gitignore','text/plain'],
]);
function mimeFor(name:string,data?:Buffer){
  const extension=path.extname(name).toLowerCase(),sourceType=sourceMimeTypes.get(extension);
  if(sourceType)return sourceType;
  const detected=mime.getType(name);
  if(detected)return detected;
  if(!data?.length)return'application/octet-stream';
  const sample=data.subarray(0,Math.min(data.length,64*1024));
  if(sample.includes(0))return'application/octet-stream';
  try{new TextDecoder('utf-8',{fatal:true}).decode(sample);return'text/plain';}catch{return'application/octet-stream';}
}
function imageMime(data:Buffer){if(data.length>=8&&data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return'image/png';if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return'image/jpeg';if(data.length>=12&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return'image/webp';if(data.length>=6&&['GIF87a','GIF89a'].includes(data.toString('ascii',0,6)))return'image/gif';return undefined;}
