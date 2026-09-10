import type {WorkspaceHistory,WorkspaceHistoryRun,WorkspaceRestorePreview,WorkspaceRestoreRequest,WorkspaceRestoreTarget} from '@agenvyl/contracts';
import {createHash} from 'node:crypto';
import {AppError} from '../../shared/errors/AppError.js';
import type {RoomEventService} from '../room-events/RoomEventService.js';
import {GitWorkspaceRestore} from './GitWorkspaceRestore.js';
import type {WorkspaceRepository} from './workspace.repository.js';
import {publicRestore,type RestoreOperation} from './WorkspaceRestoreRepository.js';
import {workspaceOutputFingerprint} from './workspaceOutputFingerprint.js';

type RestoreHost={
  ensure:(roomId:string)=>Promise<string>;
  withOperation:<T>(roomId:string,operation:()=>Promise<T>)=>Promise<T>;
  active:(roomId:string)=>boolean;
  syncFiles:(roomId:string,before:string,after:string)=>Promise<void>;
  previewAvailable:(roomId:string,runId:string)=>Promise<boolean>;
  maxFileBytes:number;
};
const terminal=new Set(['completed','failed','cancelled']);
const finalized=new Set(['complete','incomplete','failed']);

export class WorkspaceRestoreService {
  private readonly git=new GitWorkspaceRestore();
  private readonly blockedRooms=new Set<string>();
  onAvailable?:()=>void;
  isBlocked(roomId:string){return this.blockedRooms.has(roomId);}
  constructor(private readonly repository:WorkspaceRepository,private readonly events:RoomEventService,private readonly host:RestoreHost){}
  async assertAvailable(roomId:string){
    if((await this.repository.restores.pending(roomId)).length)throw new AppError('workspace_restore_pending',409,'Workspace recovery is pending. Retry the restoration before starting an agent or editing files.');
  }
  async history(roomId:string):Promise<WorkspaceHistory>{
    return this.host.withOperation(roomId,async()=>{
      const root=await this.host.ensure(roomId),runs=await this.repository.restores.runs(roomId),restores=await this.repository.restores.history(roomId);
      let unavailableReason=this.host.active(roomId)?'Wait for all agents to finish or stop, including file finalization.':undefined;
      if(restores.some(item=>item.status==='pending'))unavailableReason='Workspace recovery is pending. Retry the pending restoration.';
      try{await this.git.assertHealthy(root);}catch(error){unavailableReason=message(error);}
      const items:WorkspaceHistory['items']=[];
      for(const run of runs){
        const reason=runReason(run)??(!await this.git.hasCommit(root,run.baseHead!)?'The saved Git checkpoint is unavailable.':undefined);
        items.push({...run,...(reason?{unavailableReason:reason}:{})});
      }
      for(const restore of restores){
        const reason=restore.status==='complete'&&!await this.git.hasCommit(root,restore.beforeHead)?'The saved Git checkpoint is unavailable.':undefined;
        items.push({...publicRestore(restore),...(reason?{unavailableReason:reason}:{})});
      }
      return{items:items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),...(unavailableReason?{unavailableReason}:{})};
    });
  }
  preview(roomId:string,target:WorkspaceRestoreTarget){return this.host.withOperation(roomId,()=>this.preparePreview(roomId,target).then(value=>value.preview));}
  execute(roomId:string,request:WorkspaceRestoreRequest){
    return this.withRestoration(roomId,async()=>{
      const existing=await this.repository.restores.request(roomId,request.requestId);
      if(existing){
        if(existing.target.kind!==request.target.kind||existing.target.id!==request.target.id||existing.fingerprint!==request.fingerprint)throw new AppError('workspace_restore_request_conflict',409,'This request ID belongs to a different restoration.');
        if(existing.status==='pending'){this.assertIdle(roomId);await this.finish(existing);}
        return publicRestore((await this.repository.restores.find(roomId,existing.id))!);
      }
      const {preview,snapshot,outputFingerprint,root}=await this.preparePreview(roomId,request.target);
      if(preview.fingerprint!==request.fingerprint)throw new AppError('workspace_restore_stale',409,'Workspace changed. Review the updated changes before restoring.');
      const id=crypto.randomUUID(),commits=await this.git.createCommits(root,snapshot,preview.targetHead,id);
      const checked=await this.git.snapshot(root);
      if(checked.fingerprint!==snapshot.fingerprint||await workspaceOutputFingerprint(root,this.host.maxFileBytes)!==outputFingerprint)throw new AppError('workspace_restore_stale',409,'Workspace changed. Review the updated changes before restoring.');
      const operation=await this.repository.restores.begin({id,roomId,requestId:request.requestId,target:request.target,fingerprint:request.fingerprint,
        originalHead:snapshot.head,branchRef:snapshot.branchRef,...commits,targetHead:preview.targetHead,previewRunId:preview.previewRunId,outputFingerprint,preservedPaths:snapshot.preservedPaths});
      await this.finish(operation);
      return publicRestore((await this.repository.restores.find(roomId,id))!);
    });
  }
  retry(roomId:string,id:string){
    return this.withRestoration(roomId,async()=>{
      this.assertIdle(roomId);
      const operation=await this.repository.restores.find(roomId,id);
      if(!operation)throw new AppError('workspace_restore_not_found',404,'Restoration not found.');
      if(operation.status==='pending')await this.finish(operation);
      return publicRestore((await this.repository.restores.find(roomId,id))!);
    });
  }
  async recover(){
    const pending=await this.repository.restores.pending();
    for(const operation of pending)this.blockedRooms.add(operation.roomId);
    for(const operation of pending){
      await this.withRestoration(operation.roomId,async()=>{this.assertIdle(operation.roomId);await this.finish(operation);}).catch(()=>{});
    }
  }
  async context(roomId:string){
    const restore=await this.repository.restores.latest(roomId);
    if(!restore)return '';
    return `\n\n<workspace_restoration>\nThe user restored this room workspace at ${restore.createdAt} (operation ${restore.id}) to Git checkpoint ${restore.targetHead}, recorded as ${restore.resultHead}. Later work may have continued from that restored state. Conversation history and your session were retained; earlier descriptions of files may no longer match the workspace. Re-read the current files before editing. Ignored output, dependencies, local databases and external actions were not restored. Run a fresh build when needed; do not assume existing output matches current source.\n</workspace_restoration>`;
  }
  private assertIdle(roomId:string){if(this.host.active(roomId))throw new AppError('workspace_writer_active',409,'Wait for all agents to finish or stop, including file finalization.');}
  private withRestoration<T>(roomId:string,operation:()=>Promise<T>){
    this.blockedRooms.add(roomId);
    return this.host.withOperation(roomId,async()=>{
      try{return await operation();}finally{
        if(!(await this.repository.restores.pending(roomId)).length){this.blockedRooms.delete(roomId);this.onAvailable?.();}
      }
    });
  }
  private async preparePreview(roomId:string,target:WorkspaceRestoreTarget){
    this.assertIdle(roomId);await this.assertAvailable(roomId);
    const root=await this.host.ensure(roomId),runs=await this.repository.restores.runs(roomId);
    let targetHead:string,cutoff:string;
    if(target.kind==='run'){
      const run=runs.find(item=>item.id===target.id);
      if(!run)throw new AppError('workspace_restore_not_found',404,'Run not found in this room.');
      const reason=runReason(run);if(reason)throw new AppError('workspace_restore_unavailable',409,reason);
      targetHead=run.baseHead!;cutoff=run.createdAt;
    }else{
      const restore=await this.repository.restores.find(roomId,target.id);
      if(!restore||restore.status!=='complete')throw new AppError('workspace_restore_unavailable',409,'A completed restoration is required.');
      targetHead=restore.beforeHead;cutoff=restore.createdAt;
    }
    const snapshot=await this.git.snapshot(root);
    await this.git.assertSafeTarget(root,snapshot.tree,targetHead);
    const changes=await this.git.changes(root,snapshot.tree,targetHead),outputFingerprint=await workspaceOutputFingerprint(root,this.host.maxFileBytes);
    const previewRunId=await this.matchingPreview(roomId,targetHead);
    const previewAgent=previewRunId?runs.find(run=>run.id===previewRunId)?.agent:undefined;
    const preview:WorkspaceRestorePreview={target,targetHead,changes,affectedRuns:runs.filter(run=>run.createdAt>=cutoff&&run.baseHead),
      fingerprint:createHash('sha256').update(JSON.stringify([snapshot.fingerprint,target,targetHead,previewRunId??null,outputFingerprint])).digest('hex'),
      savesUncommittedChanges:(await this.git.changes(root,snapshot.head,snapshot.tree)).length>0,
      ...(previewRunId?{previewRunId,previewAgent}:{})};
    return{preview,snapshot,outputFingerprint,root};
  }
  private async matchingPreview(roomId:string,head:string){
    const exact=(await this.repository.previewBundles(roomId)).find(bundle=>bundle.sourceHead===head);
    if(exact)return await this.host.previewAvailable(roomId,exact.runId)?exact.runId:undefined;
    const restored=await this.repository.restores.forHead(roomId,head);
    return restored?.previewRunId&&await this.host.previewAvailable(roomId,restored.previewRunId)?restored.previewRunId:undefined;
  }
  private async finish(operation:RestoreOperation){
    try{
      const root=await this.host.ensure(operation.roomId);
      await this.git.apply(root,operation);
      await this.host.syncFiles(operation.roomId,operation.beforeHead,operation.resultHead);
      const event=await this.repository.restores.complete(operation);
      if(event)this.events.publishPersisted(operation.roomId,event);
    }catch(error){await this.repository.restores.failed(operation.id,message(error));throw error;}
  }
}

const runReason=(run:WorkspaceHistoryRun)=>!terminal.has(run.status)?'This run has not finished.':!run.baseHead?'No saved starting checkpoint.':!finalized.has(run.captureStatus??'')?'File finalization has not finished.':undefined;
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
