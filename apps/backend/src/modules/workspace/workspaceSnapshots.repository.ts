import type {Database,QueryContext} from '../../infrastructure/database/Database.js';
import {number,text,timestamp} from '../../infrastructure/database/rowMappers.js';
import type {RunWorkspaceResult,WorkspaceCaptureError,WorkspaceConflictChoice,WorkspaceConflictSet,WorkspacePublishConflict} from '@agenvyl/contracts';
import {AppError} from '../../shared/errors/AppError.js';
import {entryMap,manifestHash,mergeSnapshots,sameEntry,type SnapshotDescriptor,type SnapshotEntry} from './workspaceSnapshots.js';
import {toAttachment,type WorkspaceVersionRow} from './workspace.repository.js';

export class WorkspaceSnapshotRepository{
  constructor(private readonly database:Database){}

  async current(roomId:string,db:QueryContext=this.database.sql){
    const row=(await db`SELECT current_workspace_snapshot_id,workspace_materialization_status FROM rooms WHERE id=${roomId}`)[0];
    if(!row?.current_workspace_snapshot_id)return undefined;
    return{id:text(row.current_workspace_snapshot_id),materializationStatus:text(row.workspace_materialization_status) as 'pending'|'ready'|'failed'};
  }

  async entries(snapshotId:string,db:QueryContext=this.database.sql):Promise<SnapshotEntry[]>{
    return(await db`SELECT path,kind,version_id FROM workspace_snapshot_entries WHERE snapshot_id=${snapshotId} ORDER BY path`).map(row=>({
      path:text(row.path),kind:text(row.kind) as SnapshotEntry['kind'],...(row.version_id?{versionId:text(row.version_id)}:{}),
    }));
  }

  async prepareRun(roomId:string,runId:string){
    return this.database.transaction(async tx=>{
      const room=(await tx`SELECT current_workspace_snapshot_id FROM rooms WHERE id=${roomId} FOR UPDATE`)[0];
      if(!room)throw new AppError('room_not_found',404,'Room not found');
      const baseSnapshotId=room.current_workspace_snapshot_id?text(room.current_workspace_snapshot_id):await this.createPublishedFromCurrent(roomId,tx);
      if(!room.current_workspace_snapshot_id)await tx`UPDATE rooms SET current_workspace_snapshot_id=${baseSnapshotId},workspace_materialization_status='ready' WHERE id=${roomId}`;
      const now=new Date().toISOString();
      await tx`INSERT INTO run_workspace_results(run_id,base_snapshot_id,capture_status,publish_status,created_at,updated_at)
        VALUES(${runId},${baseSnapshotId},'preparing','pending',${now},${now})
        ON CONFLICT(run_id) DO NOTHING`;
      const row=(await tx`SELECT * FROM run_workspace_results WHERE run_id=${runId}`)[0];
      return toRunWorkspaceResult(row);
    });
  }

  async markReady(runId:string){await this.database.sql`UPDATE run_workspace_results SET capture_status='ready',updated_at=now() WHERE run_id=${runId} AND capture_status='preparing'`;}
  async markFinalizing(runId:string){await this.database.sql`UPDATE run_workspace_results SET capture_status='finalizing',updated_at=now() WHERE run_id=${runId} AND capture_status=ANY(ARRAY['preparing','ready','finalizing'])`;}
  async markFailed(runId:string,error:WorkspaceCaptureError){await this.database.sql`UPDATE run_workspace_results SET capture_status='failed',publish_status='failed',errors=${this.database.sql.json([error])},updated_at=now() WHERE run_id=${runId} AND result_snapshot_id IS NULL`;}
  async markNotPublished(runId:string){await this.database.sql`UPDATE run_workspace_results SET publish_status='not_published',updated_at=now() WHERE run_id=${runId} AND result_snapshot_id IS NOT NULL`;}

  async result(runId:string,db:QueryContext=this.database.sql){const row=(await db`SELECT * FROM run_workspace_results WHERE run_id=${runId}`)[0];return row?toRunWorkspaceResult(row):undefined;}
  async results(runIds:string[],db:QueryContext=this.database.sql){
    const result=new Map<string,RunWorkspaceResult>();
    if(!runIds.length)return result;
    for(const row of await db`SELECT * FROM run_workspace_results WHERE run_id=ANY(${runIds})`)result.set(text(row.run_id),toRunWorkspaceResult(row));
    return result;
  }

  async saveRunSnapshot(input:{roomId:string;runId:string;baseSnapshotId:string;entries:SnapshotEntry[];completeness:'complete'|'incomplete';errors:WorkspaceCaptureError[]}){
    return this.database.transaction(async tx=>{
      const existing=(await tx`SELECT result_snapshot_id FROM run_workspace_results WHERE run_id=${input.runId} FOR UPDATE`)[0];
      if(existing?.result_snapshot_id)return text(existing.result_snapshot_id);
      const id=crypto.randomUUID(),now=new Date().toISOString();
      await insertSnapshot(tx,{id,roomId:input.roomId,kind:'run',baseSnapshotId:input.baseSnapshotId,sourceRunId:input.runId,entries:input.entries,completeness:input.completeness,createdAt:now});
      const versionIds=input.entries.flatMap(entry=>entry.versionId?[entry.versionId]:[]);
      if(versionIds.length)await tx`UPDATE workspace_versions SET origin_snapshot_id=COALESCE(origin_snapshot_id,${id}) WHERE id=ANY(${versionIds})`;
      await tx`UPDATE run_workspace_results SET result_snapshot_id=${id},capture_status=${input.completeness},publish_status=${input.completeness==='complete'?'pending':'not_published'},errors=${tx.json(input.errors)},updated_at=${now} WHERE run_id=${input.runId}`;
      return id;
    });
  }

  async replaceRunArtifacts(runId:string,changes:Array<{versionId:string;change:'created'|'updated'|'deleted'}>){
    await this.database.transaction(async tx=>{
      await tx`DELETE FROM run_artifacts WHERE run_id=${runId}`;
      const now=new Date().toISOString();
      for(const change of changes)await tx`INSERT INTO run_artifacts(run_id,version_id,change,attribution,created_at) VALUES(${runId},${change.versionId},${change.change},'exact',${now})`;
    });
  }

  async publishRun(roomId:string,runId:string){
    return this.database.transaction(async tx=>{
      const room=(await tx`SELECT current_workspace_snapshot_id FROM rooms WHERE id=${roomId} FOR UPDATE`)[0];
      const resultRow=(await tx`SELECT * FROM run_workspace_results WHERE run_id=${runId} FOR UPDATE`)[0];
      if(!room||!resultRow)throw new AppError('workspace_result_not_found',404,'Run workspace result not found');
      if(text(resultRow.capture_status)!=='complete'||!resultRow.result_snapshot_id){
        await tx`UPDATE run_workspace_results SET publish_status='not_published',updated_at=now() WHERE run_id=${runId}`;
        return toRunWorkspaceResult((await tx`SELECT * FROM run_workspace_results WHERE run_id=${runId}`)[0]);
      }
      const currentId=text(room.current_workspace_snapshot_id),baseId=text(resultRow.base_snapshot_id),candidateId=text(resultRow.result_snapshot_id);
      const [base,current,candidate]=await Promise.all([this.entries(baseId,tx),this.entries(currentId,tx),this.entries(candidateId,tx)]);
      const merged=mergeSnapshots(base,current,candidate),publishedId=crypto.randomUUID(),now=new Date().toISOString();
      await insertSnapshot(tx,{id:publishedId,roomId,kind:'published',baseSnapshotId:currentId,sourceRunId:undefined,entries:merged.entries,completeness:'complete',createdAt:now});
      await tx`DELETE FROM workspace_publish_conflicts WHERE run_id=${runId}`;
      for(const conflict of merged.conflicts)await insertConflict(tx,runId,conflict,now);
      await applyPublishedEntries(tx,roomId,merged.entries,now);
      await tx`UPDATE rooms SET current_workspace_snapshot_id=${publishedId},workspace_materialization_status='pending' WHERE id=${roomId}`;
      const publishStatus=merged.conflicts.length?'partially_published':'published';
      await tx`UPDATE run_workspace_results SET published_snapshot_id=${publishedId},publish_status=${publishStatus},conflict_count=${merged.conflicts.length},updated_at=${now} WHERE run_id=${runId}`;
      return toRunWorkspaceResult((await tx`SELECT * FROM run_workspace_results WHERE run_id=${runId}`)[0]);
    });
  }

  async refreshPublished(roomId:string){
    return this.database.transaction(async tx=>{
      const room=(await tx`SELECT current_workspace_snapshot_id FROM rooms WHERE id=${roomId} FOR UPDATE`)[0];
      if(!room)throw new AppError('room_not_found',404,'Room not found');
      const prior=room.current_workspace_snapshot_id?text(room.current_workspace_snapshot_id):undefined,id=await this.createPublishedFromCurrent(roomId,tx,prior);
      await tx`UPDATE rooms SET current_workspace_snapshot_id=${id},workspace_materialization_status='ready' WHERE id=${roomId}`;
      return id;
    });
  }

  async snapshotFile(roomId:string,snapshotId:string,filePath:string){
    const row=(await this.database.sql`SELECT v.* FROM workspace_snapshots s JOIN workspace_snapshot_entries se ON se.snapshot_id=s.id JOIN workspace_versions v ON v.id=se.version_id WHERE s.room_id=${roomId} AND s.id=${snapshotId} AND se.path=${filePath} AND se.kind='file'`)[0];
    return row?toVersion(row):undefined;
  }

  async conflicts(roomId:string,runId:string):Promise<WorkspaceConflictSet>{
    const room=await this.current(roomId);
    if(!room)throw new AppError('room_not_found',404,'Room not found');
    const result=await this.result(runId);
    if(!result)throw new AppError('workspace_result_not_found',404,'Run workspace result not found');
    const rows=await this.database.sql`SELECT c.*,v.room_id FROM workspace_publish_conflicts c JOIN agent_runs r ON r.id=c.run_id LEFT JOIN workspace_versions v ON v.id=COALESCE(c.candidate_version_id,c.current_version_id,c.base_version_id) WHERE c.run_id=${runId} AND r.room_id=${roomId} AND c.resolution IS NULL ORDER BY c.path`;
    const conflicts=[];
    for(const row of rows){
      const conflict=toConflict(row);
      for(const [name,snapshotId] of [['base',result.base_snapshot_id],['current',room.id],['candidate',result.result_snapshot_id]] as const){
        const side=conflict[name];
        if(!side?.version_id||!snapshotId)continue;
        const version=await this.database.sql`SELECT * FROM workspace_versions WHERE room_id=${roomId} AND id=${side.version_id}`.then(items=>items[0]);
        if(version)side.attachment=toAttachment(toVersion(version),snapshotId);
      }
      conflicts.push(conflict);
    }
    return{run_id:runId,expected_current_snapshot_id:room.id,conflicts};
  }

  async resolveConflicts(roomId:string,runId:string,expectedCurrentSnapshotId:string,resolutions:Array<{path:string;choice:WorkspaceConflictChoice}>){
    const latest=await this.current(roomId);
    if(!latest)throw new AppError('room_not_found',404,'Room not found');
    if(latest.id!==expectedCurrentSnapshotId){
      await this.recalculateConflicts(roomId,runId,latest.id);
      throw new AppError('workspace_conflict_stale',409,'Workspace changed while conflicts were being resolved');
    }
    return this.database.transaction(async tx=>{
      const room=(await tx`SELECT current_workspace_snapshot_id FROM rooms WHERE id=${roomId} FOR UPDATE`)[0];
      if(!room)throw new AppError('room_not_found',404,'Room not found');
      if(text(room.current_workspace_snapshot_id)!==expectedCurrentSnapshotId)throw new AppError('workspace_conflict_stale',409,'Workspace changed while conflicts were being resolved');
      const conflicts=await tx`SELECT * FROM workspace_publish_conflicts c JOIN agent_runs r ON r.id=c.run_id WHERE c.run_id=${runId} AND r.room_id=${roomId} AND c.resolution IS NULL ORDER BY c.path`;
      const choices=new Map(resolutions.map(item=>[item.path,item.choice]));
      if(conflicts.length!==choices.size||conflicts.some(row=>!choices.has(text(row.path))))throw new AppError('invalid_workspace_conflict_resolution',400,'Every pending conflict must be resolved exactly once');
      const current=entryMap(await this.entries(expectedCurrentSnapshotId,tx)),now=new Date().toISOString();
      for(const row of conflicts){
        const path=text(row.path),choice=choices.get(path)!;
        if(choice==='delete')current.delete(path);
        else{
          const selectedDescriptor=choice==='candidate'?descriptor(row,'candidate'):descriptor(row,'current');
          if(selectedDescriptor)current.set(path,selectedDescriptor);else current.delete(path);
        }
        await tx`UPDATE workspace_publish_conflicts SET resolution=${choice},resolved_at=${now} WHERE run_id=${runId} AND path=${path}`;
      }
      const entries=[...current].map(([path,value])=>({path,...value})).sort((a,b)=>a.path.localeCompare(b.path)),snapshotId=crypto.randomUUID();
      await insertSnapshot(tx,{id:snapshotId,roomId,kind:'published',baseSnapshotId:expectedCurrentSnapshotId,sourceRunId:undefined,entries,completeness:'complete',createdAt:now});
      await applyPublishedEntries(tx,roomId,entries,now);
      await tx`UPDATE rooms SET current_workspace_snapshot_id=${snapshotId},workspace_materialization_status='pending' WHERE id=${roomId}`;
      await tx`UPDATE run_workspace_results SET published_snapshot_id=${snapshotId},publish_status='published',conflict_count=0,updated_at=${now} WHERE run_id=${runId}`;
      return toRunWorkspaceResult((await tx`SELECT * FROM run_workspace_results WHERE run_id=${runId}`)[0]);
    });
  }

  async setMaterialization(roomId:string,status:'ready'|'failed'){await this.database.sql`UPDATE rooms SET workspace_materialization_status=${status} WHERE id=${roomId}`;}
  async materializationsToRecover(){return(await this.database.sql`SELECT id,current_workspace_snapshot_id FROM rooms WHERE deleted_at IS NULL AND current_workspace_snapshot_id IS NOT NULL AND workspace_materialization_status<>'ready'`).map(row=>({roomId:text(row.id),snapshotId:text(row.current_workspace_snapshot_id)}));}
  async capturedWorktrees(){return(await this.database.sql`SELECT r.room_id,w.run_id FROM run_workspace_results w JOIN agent_runs r ON r.id=w.run_id WHERE w.result_snapshot_id IS NOT NULL`).map(row=>({roomId:text(row.room_id),runId:text(row.run_id)}));}

  private async recalculateConflicts(roomId:string,runId:string,currentSnapshotId:string){
    await this.database.transaction(async tx=>{
      const result=(await tx`SELECT w.* FROM run_workspace_results w JOIN agent_runs r ON r.id=w.run_id WHERE w.run_id=${runId} AND r.room_id=${roomId} FOR UPDATE OF w`)[0];
      if(!result?.result_snapshot_id)throw new AppError('workspace_result_not_found',404,'Run workspace result not found');
      const pending=(await tx`SELECT path FROM workspace_publish_conflicts WHERE run_id=${runId} AND resolution IS NULL`).map(row=>text(row.path));
      const [baseEntries,currentEntries,candidateEntries]=await Promise.all([this.entries(text(result.base_snapshot_id),tx),this.entries(currentSnapshotId,tx),this.entries(text(result.result_snapshot_id),tx)]),base=entryMap(baseEntries),current=entryMap(currentEntries),candidate=entryMap(candidateEntries),now=new Date().toISOString(),conflicts=[];
      for(const path of pending){const b=base.get(path),c=current.get(path),r=candidate.get(path);if(sameEntry(r,c))continue;conflicts.push({path,...(b?{base:b}:{}),...(c?{current:c}:{}),...(r?{candidate:r}:{})});}
      await tx`DELETE FROM workspace_publish_conflicts WHERE run_id=${runId} AND resolution IS NULL`;
      for(const conflict of conflicts)await insertConflict(tx,runId,conflict,now);
      await tx`UPDATE run_workspace_results SET published_snapshot_id=${currentSnapshotId},publish_status=${conflicts.length?'partially_published':'published'},conflict_count=${conflicts.length},updated_at=${now} WHERE run_id=${runId}`;
    });
  }

  private async createPublishedFromCurrent(roomId:string,tx:QueryContext,baseSnapshotId?:string){
    const rows=await tx`SELECT path,kind,current_version_id FROM workspace_entries WHERE room_id=${roomId} AND deleted_at IS NULL AND status='tracked' AND (kind='directory' OR current_version_id IS NOT NULL) ORDER BY path`;
    const entries=rows.map(row=>({path:text(row.path),kind:text(row.kind) as SnapshotEntry['kind'],...(row.current_version_id?{versionId:text(row.current_version_id)}:{})}));
    const id=crypto.randomUUID();
    await insertSnapshot(tx,{id,roomId,kind:'published',baseSnapshotId,sourceRunId:undefined,entries,completeness:'complete',createdAt:new Date().toISOString()});
    const versionIds=entries.flatMap(entry=>entry.versionId?[entry.versionId]:[]);
    if(versionIds.length)await tx`UPDATE workspace_versions SET origin_snapshot_id=COALESCE(origin_snapshot_id,${id}) WHERE id=ANY(${versionIds})`;
    return id;
  }
}

const insertSnapshot=async(db:QueryContext,input:{id:string;roomId:string;kind:'published'|'run';baseSnapshotId?:string;sourceRunId?:string;entries:SnapshotEntry[];completeness:'complete'|'incomplete';createdAt:string})=>{
  await db`INSERT INTO workspace_snapshots(id,room_id,kind,base_snapshot_id,source_run_id,manifest_sha256,completeness,created_at) VALUES(${input.id},${input.roomId},${input.kind},${input.baseSnapshotId??null},${input.sourceRunId??null},${manifestHash(input.entries)},${input.completeness},${input.createdAt})`;
  for(const entry of input.entries)await db`INSERT INTO workspace_snapshot_entries(snapshot_id,path,kind,version_id) VALUES(${input.id},${entry.path},${entry.kind},${entry.versionId??null})`;
};

const insertConflict=async(db:QueryContext,runId:string,conflict:{path:string;base?:SnapshotDescriptor;current?:SnapshotDescriptor;candidate?:SnapshotDescriptor},createdAt:string)=>{
  await db`INSERT INTO workspace_publish_conflicts(run_id,path,base_kind,base_version_id,current_kind,current_version_id,candidate_kind,candidate_version_id,created_at)
    VALUES(${runId},${conflict.path},${conflict.base?.kind??null},${conflict.base?.versionId??null},${conflict.current?.kind??null},${conflict.current?.versionId??null},${conflict.candidate?.kind??null},${conflict.candidate?.versionId??null},${createdAt})`;
};

const applyPublishedEntries=async(db:QueryContext,roomId:string,entries:SnapshotEntry[],now:string)=>{
  const paths=entries.map(entry=>entry.path);
  if(paths.length)await db`UPDATE workspace_entries SET deleted_at=${now},updated_at=${now} WHERE room_id=${roomId} AND deleted_at IS NULL AND NOT(path=ANY(${paths}))`;
  else await db`UPDATE workspace_entries SET deleted_at=${now},updated_at=${now} WHERE room_id=${roomId} AND deleted_at IS NULL`;
  for(const entry of entries){
    let row=(await db`SELECT id FROM workspace_entries WHERE room_id=${roomId} AND path=${entry.path}`)[0];
    const id=row?text(row.id):crypto.randomUUID();
    if(entry.kind==='directory'){
      await db`INSERT INTO workspace_entries(id,room_id,path,kind,size,mime_type,status,created_at,updated_at,deleted_at) VALUES(${id},${roomId},${entry.path},'directory',0,'inode/directory','tracked',${now},${now},NULL)
        ON CONFLICT(room_id,path) DO UPDATE SET kind='directory',size=0,mime_type='inode/directory',status='tracked',current_version_id=NULL,updated_at=${now},deleted_at=NULL`;
      continue;
    }
    const version=(await db`SELECT size,mime_type FROM workspace_versions WHERE id=${entry.versionId!} AND room_id=${roomId}`)[0];
    if(!version)throw new Error(`Snapshot version ${entry.versionId} is unavailable`);
    await db`INSERT INTO workspace_entries(id,room_id,path,kind,size,mime_type,status,current_version_id,created_at,updated_at,deleted_at) VALUES(${id},${roomId},${entry.path},'file',${number(version.size)},${text(version.mime_type)},'tracked',${entry.versionId!},${now},${now},NULL)
      ON CONFLICT(room_id,path) DO UPDATE SET kind='file',size=${number(version.size)},mime_type=${text(version.mime_type)},status='tracked',current_version_id=${entry.versionId!},updated_at=${now},deleted_at=NULL`;
    await db`UPDATE workspace_versions SET entry_id=COALESCE(entry_id,${id}) WHERE id=${entry.versionId!}`;
  }
};

const descriptor=(row:Record<string,unknown>,prefix:'base'|'current'|'candidate'):SnapshotDescriptor|undefined=>{
  const kind=row[`${prefix}_kind`];
  if(!kind)return undefined;
  const version=row[`${prefix}_version_id`];
  return{kind:text(kind) as SnapshotDescriptor['kind'],...(version?{versionId:text(version)}:{})};
};

const toRunWorkspaceResult=(row:Record<string,unknown>):RunWorkspaceResult=>({
  base_snapshot_id:text(row.base_snapshot_id),
  ...(row.result_snapshot_id?{result_snapshot_id:text(row.result_snapshot_id)}:{}),
  ...(row.published_snapshot_id?{published_snapshot_id:text(row.published_snapshot_id)}:{}),
  capture_status:text(row.capture_status) as RunWorkspaceResult['capture_status'],
  publish_status:text(row.publish_status) as RunWorkspaceResult['publish_status'],
  conflict_count:number(row.conflict_count),
  errors:Array.isArray(row.errors)?row.errors as WorkspaceCaptureError[]:[],
});

const toVersion=(row:Record<string,unknown>):WorkspaceVersionRow=>({
  id:text(row.id),...(row.entry_id?{entry_id:text(row.entry_id)}:{}),room_id:text(row.room_id),path:text(row.path),size:number(row.size),mime_type:text(row.mime_type),sha256:text(row.sha256),source:text(row.source) as WorkspaceVersionRow['source'],run_ids:Array.isArray(row.run_ids)?row.run_ids.map(String):[],created_at:timestamp(row.created_at),...(row.origin_snapshot_id?{origin_snapshot_id:text(row.origin_snapshot_id)}:{}),
});

const toConflict=(row:Record<string,unknown>):WorkspacePublishConflict=>{
  const side=(prefix:'base'|'current'|'candidate')=>{
    const value=descriptor(row,prefix);
    if(!value)return undefined;
    return{kind:value.kind,...(value.versionId?{version_id:value.versionId}:{})};
  };
  return{path:text(row.path),...(side('base')?{base:side('base')}:{}),...(side('current')?{current:side('current')}:{}),...(side('candidate')?{candidate:side('candidate')}:{})};
};
