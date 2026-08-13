import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile,mkdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime';
import type {RoomStaticPreview,RunArtifact,RunArtifactSummary,RunEmbed,RunWorkspaceResult,WorkspaceAttachment,WorkspaceBuildPreview,WorkspaceCaptureError,WorkspaceEntry,WorkspaceVersion} from '@agenvyl/contracts';
import {AppError} from '../../shared/errors/AppError.js';
import type {RoomRepository} from '../rooms/rooms.repository.js';
import type {RoomEventService} from '../room-events/RoomEventService.js';
import type {ActiveRunRegistry} from '../runs/ActiveRunRegistry.js';
import type {RunWorkspaceRepository} from './RunWorkspaceRepository.js';
import type {WorkspaceRepository,WorkspaceVersionRow} from './workspace.repository.js';
import {runPreviewUrl,toWorkspaceVersion} from './workspace.repository.js';
import {directCaptureIgnoredDirectories,RunArtifactPolicy} from './RunArtifactPolicy.js';
import {PreviewBundleStore,type PreviewBundleFile} from './PreviewBundleStore.js';
import {hasUnbuiltWebProject,selectStaticPreviewPath} from './runStaticPreview.js';
import {scanWorkspaceTree,stableReadWorkspaceFile} from './workspaceCapture.js';
import {extractWorkspaceImageReferences} from './workspaceEmbeds.js';
import {TransparentGitWorkspace} from './TransparentGitWorkspace.js';

type WorkspaceLogger={info:(context:Record<string,unknown>,message:string)=>void;warn:(context:Record<string,unknown>,message:string)=>void};
type CapturedFile={path:string;data:Buffer;sha256:string;mimeType:string;version?:WorkspaceVersionRow};
type CaptureResult={files:CapturedFile[];paths:string[];errors:WorkspaceCaptureError[];changedPaths:Set<string>};
type RunArtifactProjection={artifacts:RunArtifact[];artifactSummary:RunArtifactSummary;staticPreview?:WorkspaceAttachment;staticPreviewStatus?:'ready'|'build_missing'|'capture_failed'};
const supportedRunImageMimeTypes=new Set(['image/png','image/jpeg','image/webp','image/gif']);

export class RoomWorkspaceService{
  private roomMutations=new Map<string,Promise<void>>();
  private readonly git=new TransparentGitWorkspace();

  constructor(
    private readonly rooms:RoomRepository,
    private readonly repository:WorkspaceRepository,
    private readonly runWorkspaces:RunWorkspaceRepository,
    private readonly events:RoomEventService,
    private readonly activeRuns:ActiveRunRegistry,
    private root:string,
    private agentRoot:string,
    readonly maxFileBytes:number,
    private readonly logger?:WorkspaceLogger,
    private readonly previewBundles?:PreviewBundleStore,
  ){}

  configureRoots(root:string,agentRoot=root){this.root=root;this.agentRoot=agentRoot;}
  roomPath(roomId:string){return path.join(path.resolve(this.root),roomId);}
  agentRoomPath(roomId:string){return path.join(path.resolve(this.agentRoot),roomId);}
  objectPath(sha:string){return path.join(path.resolve(this.root),'.versions',sha.slice(0,2),sha);}
  agentObjectPath(sha:string){return path.join(path.resolve(this.agentRoot),'.versions',sha.slice(0,2),sha);}

  async ensure(roomId:string){await this.assertRoom(roomId);const directory=this.roomPath(roomId);await this.git.initialize(directory);return directory;}

  async list(roomId:string,includeDeleted=false){
    const directory=await this.ensure(roomId),head=await this.git.currentHead(directory),entries=await this.workspaceEntries(roomId,directory);
    if(includeDeleted){const deleted=(await this.repository.list(roomId,true)).filter(entry=>entry.deleted_at&&!entries.some(current=>current.path===entry.path));return{path:this.agentRoomPath(roomId),head,entries:[...entries,...deleted].sort((left,right)=>left.path.localeCompare(right.path)),previewHistory:[]};}
    const projection=await this.resolveRoomPreviewProjection(roomId,head,entries.map(entry=>entry.path)).catch(error=>{
      this.logger?.warn({metric:'workspace.preview_projection',roomId,error:message(error)},'Room preview projection failed');
      return{staticPreview:undefined,previewHistory:[] as WorkspaceBuildPreview[]};
    });
    return{path:this.agentRoomPath(roomId),head,entries,...(projection.staticPreview?{staticPreview:projection.staticPreview}:{}),previewHistory:projection.previewHistory};
  }

  async recoverRuns(){for(const item of await this.runWorkspaces.abandoned())await this.finalizeRun(item.roomId,item.runId,item.status).catch(()=>{});}

  async prepareRun(roomId:string,runId:string){
    return this.withRoomOperation(roomId,async()=>{
      const started=Date.now(),directory=await this.ensure(roomId),checkpoint=await this.git.prepare(directory,runId);
      await this.runWorkspaces.prepare(roomId,runId,checkpoint.head);
      this.logger?.info({metric:'workspace.prepare',roomId,runId,driver:'direct',durationMs:Date.now()-started,baseHead:checkpoint.head},'Direct Git workspace prepared');
      return{relativePath:'.',absolutePath:this.agentRoomPath(roomId)};
    });
  }

  runWorkspaceResult(runId:string){return this.runWorkspaces.result(runId);}

  async finalizeRun(roomId:string,runId:string,status:'completed'|'failed'|'cancelled'):Promise<RunWorkspaceResult|undefined>{
    return this.withRoomOperation(roomId,async()=>{
      const started=Date.now(),existing=await this.runWorkspaces.resultForRoom(roomId,runId);
      if(!existing)return undefined;
      if(existing.capture_status==='complete'||existing.capture_status==='incomplete')return existing;
      await this.runWorkspaces.markFinalizing(runId);
      const directory=await this.ensure(roomId);
      try{
        const checkpoint=await this.git.finalize(directory,runId,status),captured=await this.captureRunTree(roomId,runId,directory,existing.base_head,checkpoint.head);
        if(captured.changedPaths.size)await this.capturePreviewBundle(roomId,runId,checkpoint.head,captured).catch(error=>this.logPreviewCaptureFailure(roomId,runId,error));
        const result=(await this.runWorkspaces.complete(runId,{resultHead:checkpoint.head,checkpointSha:checkpoint.checkpointSha,errors:captured.errors}))!;
        await this.emitFinalized(roomId,runId,result);
        this.logger?.info({metric:'workspace.capture',roomId,runId,driver:'direct',durationMs:Date.now()-started,captureStatus:result.capture_status,resultHead:checkpoint.head,changedPaths:captured.changedPaths.size},'Direct Git workspace finalized');
        return result;
      }catch(error){
        await this.runWorkspaces.markFailed(runId,{path:'',code:'read_failed'}).catch(()=>{});
        this.logger?.warn({metric:'workspace.capture',roomId,runId,driver:'direct',durationMs:Date.now()-started,error:message(error)},'Direct Git workspace finalization failed');
        throw error;
      }
    });
  }

  async resolveRunPreview(roomId:string,runId:string,assetInput=''){
    const bundle=await this.repository.previewBundleForRun(roomId,runId);
    if(bundle?.status!=='ready'||!this.previewBundles)throw new AppError('version_not_found',404,'Run preview not found');
    let relative=bundle.entrypoint;
    if(assetInput){try{relative=safeRelative(decodeURIComponent(assetInput));}catch{throw new AppError('version_not_found',404,'Run preview file not found')}}
    const file=await this.previewBundles.read(bundle.id,relative).catch(()=>{throw new AppError('version_not_found',404,'Run preview file not found')});
    return{data:file.data,contentType:file.contentType,version:{id:bundle.id,path:relative,size:file.data.length,mime_type:file.contentType,sha256:file.sha256,created_at:bundle.createdAt,source:'agent' as const,run_ids:[runId],url:runPreviewUrl(roomId,runId),preview_url:runPreviewUrl(roomId,runId)}};
  }

  async captureAttachmentVersions(roomId:string,versionIds:string[]){
    const result:string[]=[];
    for(const id of versionIds){
      const relative=decodeLiveId(id,'live.');
      if(!relative){result.push(id);continue;}
      const saved=await this.capture(roomId,relative,'user',[],'updated');
      result.push(saved.version?.id??(await this.repository.currentVersion(roomId,relative))?.id??id);
    }
    return result;
  }

  async upload(roomId:string,filePath:string|undefined,_contentType:string|undefined,body:Buffer,conflict:'fail'|'replace'|'rename'='fail'){
    return this.withRoomMutation(roomId,async()=>{
      if(!filePath)throw new AppError('file_name_required',400,'File name is required');
      if(!body.length)throw new AppError('empty_file',400,'File is empty');
      if(body.length>this.maxFileBytes)throw new AppError('file_too_large',413,`File size must not exceed ${Math.floor(this.maxFileBytes/1024/1024)} MB`);
      let relative=safeRelative(decodeHeaderName(filePath));assertPublicPath(relative);const directory=await this.ensure(roomId);let target=path.join(directory,relative);
      const exists=await stat(target).then(item=>item.isFile()).catch(()=>false);
      if(exists&&conflict==='fail')throw new AppError('file_exists',409,'A file with this name already exists');
      if(exists&&conflict==='rename'){relative=await availableName(directory,relative);target=path.join(directory,relative);}
      await mkdir(path.dirname(target),{recursive:true});const temporary=`${target}.upload-${crypto.randomUUID()}`;await writeFile(temporary,body);await rename(temporary,target);
      const saved=await this.capture(roomId,relative,'user',[],'updated');await this.git.checkpoint(directory,'agenvyl: workspace upload');return saved;
    });
  }

  async createDirectory(roomId:string,relativeInput:string){return this.withRoomMutation(roomId,async()=>{const relative=safeRelative(relativeInput),directory=await this.ensure(roomId),target=path.join(directory,relative);assertPublicPath(relative);if(await stat(target).then(()=>true).catch(()=>false))throw new AppError('file_exists',409,'An item with this name already exists');await mkdir(target,{recursive:false});const entry=await this.liveEntry(directory,{path:relative,kind:'directory'});await this.git.checkpoint(directory,'agenvyl: workspace directory');await this.events.emit(roomId,'workspace.changed',{entry,change:'created'});return entry;});}
  async move(roomId:string,entryId:string,nextPathInput:string){return this.withRoomMutation(roomId,async()=>{const nextPath=safeRelative(nextPathInput),directory=await this.ensure(roomId),entry=await this.resolveEntry(roomId,directory,entryId);assertPublicPath(nextPath);if(!entry||entry.deleted_at)throw new AppError('file_not_found',404,'File not found');const target=path.join(directory,nextPath);if(await stat(target).then(()=>true).catch(()=>false))throw new AppError('file_exists',409,'An item with this name already exists');await mkdir(path.dirname(target),{recursive:true});await rename(path.join(directory,entry.path),target);await this.git.checkpoint(directory,'agenvyl: workspace move');const result=await this.liveEntry(directory,{path:nextPath,kind:entry.kind});await this.events.emit(roomId,'workspace.changed',{entry:result,change:'moved'});return result;});}
  async remove(roomId:string,entryId:string){return this.withRoomMutation(roomId,async()=>{const directory=await this.ensure(roomId),entry=await this.resolveEntry(roomId,directory,entryId);if(!entry||entry.deleted_at)throw new AppError('file_not_found',404,'File not found');await rm(path.join(directory,entry.path),{recursive:true,force:true});await this.git.checkpoint(directory,'agenvyl: workspace delete');await this.events.emit(roomId,'workspace.changed',{entry:{...entry,deleted_at:new Date().toISOString()},change:'deleted'});});}
  async restoreEntry(roomId:string,entryId:string){return this.withRoomMutation(roomId,async()=>{const entry=await this.repository.entryById(roomId,entryId);if(!entry?.deleted_at)throw new AppError('file_not_found',404,'Deleted file not found');const directory=await this.ensure(roomId),target=path.join(directory,entry.path);if(await stat(target).then(()=>true).catch(()=>false))throw new AppError('file_exists',409,'The path is already in use');if(entry.kind==='directory'){await mkdir(target,{recursive:true});const restored=await this.repository.restoreTree(roomId,entryId);for(const item of restored){if(item.kind==='directory')await mkdir(path.join(directory,item.path),{recursive:true});else if(item.current_version_id){const version=await this.repository.version(roomId,item.current_version_id);if(version){await mkdir(path.dirname(path.join(directory,item.path)),{recursive:true});await copyFile(this.objectPath(version.sha256),path.join(directory,item.path));}}await this.events.emit(roomId,'workspace.changed',{entry:item,change:'restored'});}await this.git.checkpoint(directory,'agenvyl: workspace restore');return{entry:restored.find(item=>item.id===entryId)};}if(!entry.current_version_id)throw new AppError('version_not_found',404,'Version not found');const version=await this.versionRow(roomId,entry.current_version_id);await mkdir(path.dirname(target),{recursive:true});await copyFile(this.objectPath(version.sha256),target);const saved=await this.capture(roomId,entry.path,'user',[],'updated',true);await this.git.checkpoint(directory,'agenvyl: workspace restore');return saved;});}
  async restoreVersion(roomId:string,versionId:string){return this.withRoomMutation(roomId,async()=>{if(decodeLiveId(versionId,'live.'))return{entry:undefined,version:await this.liveVersion(roomId,versionId)};const version=await this.versionRow(roomId,versionId),entry=version.entry_id?await this.repository.entryById(roomId,version.entry_id):await this.repository.entry(roomId,version.path);if(!entry)throw new AppError('file_not_found',404,'File not found');const directory=await this.ensure(roomId),target=path.join(directory,entry.path);await mkdir(path.dirname(target),{recursive:true});await copyFile(this.objectPath(version.sha256),target);const saved=await this.capture(roomId,entry.path,'user',[],'updated',true);await this.git.checkpoint(directory,'agenvyl: restore file version');return saved;});}
  async versions(roomId:string,entryId:string){await this.assertRoom(roomId);const relative=decodeLiveId(entryId,'path.');if(!relative)return(await this.repository.versions(roomId,entryId)).map(toWorkspaceVersion);const current=await this.liveVersion(roomId,liveVersionId(relative)),entry=await this.repository.entry(roomId,relative),history=entry?(await this.repository.versions(roomId,entry.id)).map(toWorkspaceVersion):[];return[current,...history.filter(version=>version.sha256!==current.sha256)];}
  async version(roomId:string,versionId:string){return decodeLiveId(versionId,'live.')?this.liveVersion(roomId,versionId):toWorkspaceVersion(await this.versionRow(roomId,versionId));}
  async resolveVersion(roomId:string,versionId:string){const relative=decodeLiveId(versionId,'live.');if(relative){const version=await this.liveVersion(roomId,versionId);return{path:path.join(this.roomPath(roomId),relative),contentType:version.mime_type,version};}const version=await this.versionRow(roomId,versionId);return{path:this.objectPath(version.sha256),contentType:version.mime_type,version:toWorkspaceVersion(version)};}
  async resolvePreviewAsset(roomId:string,versionId:string,assetInput:string){const relative=decodeLiveId(versionId,'live.');if(relative){const asset=safeRelative(decodeURIComponent(assetInput)),logical=path.posix.join(path.posix.dirname(relative),asset),target=path.join(this.roomPath(roomId),logical);if(!await stat(target).then(item=>item.isFile()).catch(()=>false))throw new AppError('version_not_found',404,'Related preview file not found');return{path:target,contentType:mimeFor(logical)};}const owner=await this.versionRow(roomId,versionId),asset=safeRelative(decodeURIComponent(assetInput)),logical=path.posix.join(path.posix.dirname(owner.path),asset),version=await this.repository.currentVersion(roomId,logical);if(!version)throw new AppError('version_not_found',404,'Related preview file not found');return{path:this.objectPath(version.sha256),contentType:version.mime_type};}
  async immutableVersionAgentPath(roomId:string,versionId:string){const relative=decodeLiveId(versionId,'live.');if(relative)return path.join(this.agentRoomPath(roomId),...relative.split('/'));const version=await this.versionRow(roomId,versionId);return this.agentObjectPath(version.sha256);}
  streamVersion(roomId:string,versionId:string){return this.resolveVersion(roomId,versionId).then(file=>({...file,stream:createReadStream(file.path)}));}

  async resolveRunEmbeds(roomId:string,runId:string,markdown:string){
    return this.withRoomOperation(roomId,async()=>{
      const embeds:RunEmbed[]=[];
      for(const reference of extractWorkspaceImageReferences(markdown)){
        if(reference.error){embeds.push({kind:'image',path:reference.path,status:'error',error:reference.error});continue;}
        embeds.push(await this.resolveRunImage(roomId,runId,reference.path));
      }
      await this.repository.saveRunEmbeds(runId,embeds);return embeds;
    });
  }

  async purgeCandidates(roomId:string){return{hashes:await this.repository.roomHashes(roomId),previewIds:await this.repository.previewBundleIds(roomId)};}
  async purgeFiles(roomId:string,candidates:{hashes:string[];previewIds:string[]}){await rm(this.roomPath(roomId),{recursive:true,force:true});for(const sha of candidates.hashes)if(!await this.repository.hashExists(sha))await rm(this.objectPath(sha),{force:true});await this.previewBundles?.remove(candidates.previewIds);}

  private async captureRunTree(roomId:string,runId:string,root:string,baseHead:string,resultHead:string):Promise<CaptureResult>{
    const scanned=await scanWorkspaceTree(root,this.maxFileBytes,'',directCaptureIgnoredDirectories),files:CapturedFile[]=[],paths:string[]=[],errors=[...scanned.errors],changed=await this.git.changedPaths(root,baseHead,resultHead),changedPaths=new Set(changed.map(item=>item.path));
    for(const item of scanned.entries){
      paths.push(item.path);
      if(item.kind==='directory')continue;
      const read=await stableReadWorkspaceFile(path.join(root,...item.path.split('/'))).catch(()=>undefined);
      if(!read){errors.push({path:item.path,code:'unstable'});continue;}
      const sha256=hash(read.data),gitChange=changed.find(value=>value.path===item.path)?.change;
      const saved=changedPaths.has(item.path)?await this.captureBuffer(roomId,item.path,read.data,'agent',[runId],gitChange==='created'?'created':'updated'):undefined;
      files.push({path:item.path,data:read.data,sha256,mimeType:saved?.version?.mime_type??mimeFor(item.path,read.data),...(saved?.version?{version:saved.version}:{})});
    }
    for(const item of changed.filter(value=>value.change==='deleted')){
      const version=await this.repository.currentVersion(roomId,item.path);
      if(version)await this.repository.linkArtifacts([runId],version,'deleted','exact');
    }
    const policy=await this.artifactPolicy(root);await this.repository.applyRunArtifactVisibility(runId,policy);
    return{files,paths,errors,changedPaths};
  }

  private async resolveRunImage(roomId:string,runId:string,relative:string):Promise<RunEmbed>{
    const target=path.join(this.roomPath(roomId),...relative.split('/')),read=await stableReadWorkspaceFile(target).catch(()=>undefined);
    if(!read)return{kind:'image',path:relative,status:'error',error:'not_found'};
    if(read.data.length>this.maxFileBytes)return{kind:'image',path:relative,status:'error',error:'limit_exceeded'};
    const mimeType=mimeFor(relative,read.data);
    if(!supportedRunImageMimeTypes.has(mimeType))return{kind:'image',path:relative,status:'error',error:'unsupported_type'};
    if(!read.data.length||imageMime(read.data)!==mimeType)return{kind:'image',path:relative,status:'error',error:'invalid_content'};
    const saved=await this.captureBuffer(roomId,relative,read.data,'agent',[runId],'updated'),version=saved.version??await this.repository.currentVersion(roomId,relative);
    if(!version)return{kind:'image',path:relative,status:'error',error:'not_found'};
    const url=`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(version.id)}`;
    return{kind:'image',path:relative,status:'resolved',attachment:{version_id:version.id,...(version.entry_id?{entry_id:version.entry_id}:{}),path:version.path,name:path.basename(version.path),size:version.size,mime_type:version.mime_type,url,preview_url:`${url}/preview`}};
  }

  private async capturePreviewBundle(roomId:string,runId:string,sourceHead:string,captured:CaptureResult){
    if(!this.previewBundles)return;
    const existing=await this.repository.previewBundleForRun(roomId,runId);if(existing?.status==='ready')return;
    const entrypoint=selectStaticPreviewPath(captured.paths);if(!entrypoint)return;
    const root=path.posix.dirname(entrypoint),selected=captured.files.filter(file=>root==='.'||file.path.startsWith(`${root}/`)),files:PreviewBundleFile[]=selected.map(file=>({path:root==='.'?file.path:file.path.slice(root.length+1),data:file.data,mimeType:file.mimeType}));
    const relativeEntrypoint=root==='.'?entrypoint:entrypoint.slice(root.length+1),sourceManifestSha256=manifest(selected),uncompressedSize=files.reduce((total,file)=>total+file.data.length,0),record=await this.repository.beginPreviewBundle({roomId,runId,sourceHead,entrypoint:relativeEntrypoint,sourceManifestSha256,uncompressedSize,fileCount:files.length});
    if(record.status==='ready')return;
    try{const metadata=await this.previewBundles.write(record.id,relativeEntrypoint,files);await this.repository.completePreviewBundle(record.id,metadata.bundleSha256,metadata.bundleSize);}catch(error){await this.repository.failPreviewBundle(record.id,message(error));throw error}
  }

  private async resolveRoomPreviewProjection(roomId:string,currentHead:string,currentPaths:string[]):Promise<{staticPreview?:RoomStaticPreview;previewHistory:WorkspaceBuildPreview[]}>{
    const bundles=await this.repository.previewBundles(roomId),previewHistory=bundles.map((bundle,index)=>({runId:bundle.runId,...(bundle.sourceHead?{sourceHead:bundle.sourceHead}:{}),agent:bundle.agent,createdAt:bundle.runCreatedAt,runStatus:bundle.runStatus as WorkspaceBuildPreview['runStatus'],sameBuildAsPrevious:Boolean(bundles[index+1]&&bundles[index+1]!.bundleSha256===bundle.bundleSha256),attachment:{version_id:bundle.id,path:bundle.entrypoint,name:path.posix.basename(bundle.entrypoint),size:bundle.bundleSize??bundle.uncompressedSize,mime_type:'text/html',url:runPreviewUrl(roomId,bundle.runId),preview_url:runPreviewUrl(roomId,bundle.runId)}}));
    const exact=previewHistory.find(item=>item.sourceHead===currentHead);if(exact)return{staticPreview:{status:'ready',runId:exact.runId,attachment:exact.attachment},previewHistory};
    if(!hasUnbuiltWebProject(currentPaths))return{previewHistory};
    return{staticPreview:previewHistory.length?{status:'outdated',runId:previewHistory[0]!.runId}:{status:'build_missing'},previewHistory};
  }

  private artifactProjection(runId:string):Promise<RunArtifactProjection>{return this.repository.artifactProjections([runId]).then(items=>items.get(runId)??{artifacts:[],artifactSummary:{total_count:0,project_count:0,hidden_count:0}});}
  private async emitFinalized(roomId:string,runId:string,workspaceResult:RunWorkspaceResult){const projection=await this.artifactProjection(runId);await this.events.emit(roomId,'run.workspace.finalized',{runId,workspaceResult,...projection}).catch(()=>{});}
  private logPreviewCaptureFailure(roomId:string,runId:string,error:unknown){this.logger?.warn({metric:'workspace.preview_capture',roomId,runId,error:message(error)},'Immutable preview bundle capture failed');}
  private async artifactPolicy(root:string){return new RunArtifactPolicy(await readFile(path.join(root,'.gitignore'),'utf8').catch(()=>''));}
  private async capture(roomId:string,relative:string,source:'user'|'agent'|'external',runIds:string[],change:'created'|'updated',force=false){return this.captureBuffer(roomId,relative,await readFile(path.join(this.roomPath(roomId),relative)),source,runIds,change,force);}
  private async captureBuffer(roomId:string,relative:string,data:Buffer,source:'user'|'agent'|'external',runIds:string[],change:'created'|'updated',force=false){const sha=hash(data);await this.storeObject(sha,data);const result=await this.repository.saveVersion({roomId,path:relative,size:data.length,mimeType:mimeFor(relative,data),sha256:sha,source,runIds,force,artifactChange:runIds.length?change:undefined});if(result.version)await this.events.emit(roomId,'workspace.changed',{entry:result.entry,change:result.created?'created':'updated'});return{entry:result.entry,version:result.version};}
  private async storeObject(sha:string,data:Buffer){const object=this.objectPath(sha);await mkdir(path.dirname(object),{recursive:true});if(await stat(object).then(()=>true).catch(()=>false))return;const temporary=`${object}.${crypto.randomUUID()}.tmp`;await writeFile(temporary,data);await rename(temporary,object).catch(async error=>{await rm(temporary,{force:true});if(!await stat(object).then(()=>true).catch(()=>false))throw error;});}
  private async workspaceEntries(roomId:string,directory:string){
    await this.assertRoom(roomId);
    const scanned=await scanWorkspaceTree(directory,this.maxFileBytes,'',directCaptureIgnoredDirectories),entries:WorkspaceEntry[]=[];
    for(const item of scanned.entries)entries.push(await this.liveEntry(directory,item));
    return entries;
  }
  private async liveEntry(directory:string,item:{path:string;kind:'file'|'directory'}):Promise<WorkspaceEntry>{
    const details=await stat(path.join(directory,...item.path.split('/'))),updatedAt=details.mtime.toISOString();
    return{id:liveEntryId(item.path),path:item.path,name:path.posix.basename(item.path),kind:item.kind,size:item.kind==='file'?details.size:0,mime_type:item.kind==='file'?mimeFor(item.path):'inode/directory',updated_at:updatedAt,...(item.kind==='file'?{current_version_id:liveVersionId(item.path)}:{}),deleted_at:null,status:'tracked'};
  }
  private async resolveEntry(roomId:string,directory:string,entryId:string){
    const relative=decodeLiveId(entryId,'path.');
    if(!relative)return this.repository.entryById(roomId,entryId);
    const details=await stat(path.join(directory,...relative.split('/'))).catch(()=>undefined);
    if(!details)return undefined;
    return this.liveEntry(directory,{path:relative,kind:details.isDirectory()?'directory':'file'});
  }
  private async liveVersion(roomId:string,versionId:string):Promise<WorkspaceVersion>{
    await this.assertRoom(roomId);
    const relative=decodeLiveId(versionId,'live.');
    if(!relative)throw new AppError('version_not_found',404,'Version not found');
    const target=path.join(this.roomPath(roomId),...relative.split('/')),read=await stableReadWorkspaceFile(target).catch(()=>undefined);
    if(!read)throw new AppError('version_not_found',404,'Version not found');
    const sha256=hash(read.data),url=`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(versionId)}`;
    return{id:versionId,entry_id:liveEntryId(relative),path:relative,size:read.data.length,mime_type:mimeFor(relative,read.data),sha256,created_at:new Date().toISOString(),source:'external',run_ids:[],url,preview_url:`${url}/preview`};
  }
  private async versionRow(roomId:string,id:string){await this.assertRoom(roomId);const version=await this.repository.version(roomId,id);if(!version)throw new AppError('version_not_found',404,'Version not found');return version;}
  private async assertRoom(roomId:string){if(!await this.rooms.exists(roomId))throw new AppError('room_not_found',404,'Room not found');}
  private withRoomMutation<T>(roomId:string,operation:()=>Promise<T>):Promise<T>{return this.withRoomOperation(roomId,async()=>{if([...this.activeRuns.values()].some(run=>run.roomId===roomId&&run.started&&!run.terminal))throw new AppError('workspace_writer_active',409,'Workspace changes are blocked while an agent is writing in this room');return operation();});}
  private async withRoomOperation<T>(roomId:string,operation:()=>Promise<T>):Promise<T>{const prior=this.roomMutations.get(roomId)??Promise.resolve();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),queued=prior.catch(()=>{}).then(()=>gate);this.roomMutations.set(roomId,queued);await prior.catch(()=>{});try{return await operation();}finally{release();if(this.roomMutations.get(roomId)===queued)this.roomMutations.delete(roomId)}}
}

const safeRelative=(input:string)=>{const normalized=input.replace(/\\/g,'/').replace(/^\/+/,''),segments=normalized.split('/').filter(Boolean);if(!segments.length||segments.some(segment=>segment==='.'||segment==='..'||segment.includes('\0')))throw new AppError('invalid_file_name',400,'Invalid file path');return segments.join('/');};
const liveEntryId=(relative:string)=>`path.${Buffer.from(relative).toString('base64url')}`;
const liveVersionId=(relative:string)=>`live.${Buffer.from(relative).toString('base64url')}`;
const decodeLiveId=(id:string,prefix:'path.'|'live.')=>{if(!id.startsWith(prefix))return undefined;try{return safeRelative(Buffer.from(id.slice(prefix.length),'base64url').toString('utf8'));}catch{return undefined}};
const assertPublicPath=(relative:string)=>{if(relative.split('/').some(segment=>segment==='.agenvyl'||segment==='.git'||segment==='.versions'))throw new AppError('workspace_reserved_path',400,'This path is reserved');};
const decodeHeaderName=(value:string)=>{try{return decodeURIComponent(value)}catch{return value}};
const availableName=async(root:string,relative:string)=>{const extension=path.extname(relative),base=relative.slice(0,relative.length-extension.length);for(let index=2;index<10_000;index++){const candidate=`${base} (${index})${extension}`;if(!await stat(path.join(root,candidate)).then(()=>true).catch(()=>false))return candidate;}throw new AppError('file_exists',409,'Could not find an available file name');};
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const manifest=(files:CapturedFile[])=>createHash('sha256').update(files.slice().sort((a,b)=>a.path.localeCompare(b.path)).map(file=>`${file.path}\u001f${file.sha256}`).join('\n')).digest('hex');
const mimeFor=(filePath:string,data?:Buffer)=>imageMime(data)??({'.ts':'text/typescript','.tsx':'text/typescript','.js':'text/javascript','.jsx':'text/javascript','.md':'text/markdown'}[path.extname(filePath).toLowerCase()]??mime.getType(filePath)??'application/octet-stream');
const imageMime=(data?:Buffer)=>{if(!data)return undefined;if(data.length>=8&&data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return'image/png';if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return'image/jpeg';if(data.length>=12&&data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP')return'image/webp';if(data.length>=6&&['GIF87a','GIF89a'].includes(data.subarray(0,6).toString()))return'image/gif';return undefined;};
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
