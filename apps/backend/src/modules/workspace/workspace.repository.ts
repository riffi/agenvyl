import type {Database,QueryContext} from '../../infrastructure/database/Database.js';
import {number,stringArray,text,timestamp} from '../../infrastructure/database/rowMappers.js';
import type {RunArtifact,RunArtifactSummary,RunEmbed,WorkspaceAttachment,WorkspaceEntry,WorkspaceSource,WorkspaceVersion} from '@agenvyl/contracts';
import {hasUnbuiltWebProject,selectStaticPreviewPath} from './runStaticPreview.js';

type VersionRow={id:string;entry_id?:string;room_id:string;path:string;size:number;mime_type:string;sha256:string;source:WorkspaceSource;run_ids:string[];created_at:string;origin_snapshot_id?:string};
export type RunArtifactProjection={artifacts:RunArtifact[];artifactSummary:RunArtifactSummary;staticPreview?:WorkspaceAttachment;staticPreviewStatus?:'ready'|'build_missing'|'capture_failed'};
export type PreviewBundleRow={id:string;runId:string;roomId:string;sourceSnapshotId?:string;entrypoint:string;sourceManifestSha256:string;bundleSha256?:string;bundleSize?:number;uncompressedSize:number;fileCount:number;status:'capturing'|'ready'|'failed';error?:string;createdAt:string;updatedAt:string};
export type PreviewBundleHistoryRow=PreviewBundleRow&{agent:string;runStatus:string;publishStatus:string;conflictCount:number;runCreatedAt:string;resultUpdatedAt:string};

export class WorkspaceRepository{
  constructor(private readonly database:Database){}

  async list(roomId:string,includeDeleted=false){
    const rows=includeDeleted
      ?await this.database.sql`SELECT * FROM workspace_entries WHERE room_id=${roomId} ORDER BY path`
      :await this.database.sql`SELECT * FROM workspace_entries WHERE room_id=${roomId} AND deleted_at IS NULL ORDER BY path`;
    return rows.map(toEntry);
  }

  async entry(roomId:string,path:string){const row=(await this.database.sql`SELECT * FROM workspace_entries WHERE room_id=${roomId} AND path=${path}`)[0];return row?toEntry(row):undefined;}
  async entryById(roomId:string,id:string){const row=(await this.database.sql`SELECT * FROM workspace_entries WHERE room_id=${roomId} AND id=${id}`)[0];return row?toEntry(row):undefined;}

  async saveDirectory(roomId:string,path:string,sourceTime=new Date().toISOString()){
    const existing=await this.entry(roomId,path),id=existing?.id??crypto.randomUUID();
    await this.database.sql`INSERT INTO workspace_entries(id,room_id,path,kind,size,mime_type,status,created_at,updated_at,deleted_at)
      VALUES(${id},${roomId},${path},'directory',0,'inode/directory','tracked',${sourceTime},${sourceTime},NULL)
      ON CONFLICT(room_id,path) DO UPDATE SET kind='directory',updated_at=${sourceTime},deleted_at=NULL`;
    return (await this.entry(roomId,path))!;
  }

  async saveVersion(input:{roomId:string;path:string;size:number;mimeType:string;sha256:string;source:WorkspaceSource;runIds:string[];createdAt?:string;force?:boolean;artifactChange?:RunArtifact['change']}){
    return this.database.transaction(async tx=>{
      const now=input.createdAt??new Date().toISOString();
      let entry=(await tx`SELECT * FROM workspace_entries WHERE room_id=${input.roomId} AND path=${input.path} FOR UPDATE`)[0];
      const created=!entry||entry.deleted_at!=null;
      if(!entry){const id=crypto.randomUUID();await tx`INSERT INTO workspace_entries(id,room_id,path,kind,size,mime_type,status,created_at,updated_at) VALUES(${id},${input.roomId},${input.path},'file',${input.size},${input.mimeType},'tracked',${now},${now})`;entry=(await tx`SELECT * FROM workspace_entries WHERE id=${id}`)[0];}
      const current=entry.current_version_id?(await tx`SELECT sha256 FROM workspace_versions WHERE id=${entry.current_version_id as string}`)[0]:undefined;
      if(!input.force&&current?.sha256===input.sha256&&entry.deleted_at==null){await tx`UPDATE workspace_entries SET size=${input.size},mime_type=${input.mimeType},updated_at=${now},status='tracked' WHERE id=${entry.id as string}`;return{entry:toEntry({...entry,size:input.size,mime_type:input.mimeType,updated_at:now}),version:undefined,created:false};}
      const versionId=crypto.randomUUID();
      await tx`INSERT INTO workspace_versions(id,entry_id,room_id,path,size,mime_type,sha256,source,run_ids,created_at) VALUES(${versionId},${entry.id as string},${input.roomId},${input.path},${input.size},${input.mimeType},${input.sha256},${input.source},${this.database.sql.json(input.runIds)},${now})`;
      await tx`UPDATE workspace_entries SET kind='file',size=${input.size},mime_type=${input.mimeType},status='tracked',current_version_id=${versionId},updated_at=${now},deleted_at=NULL WHERE id=${entry.id as string}`;
      if(input.artifactChange&&input.runIds.length){const attribution=input.runIds.length===1?'exact':'shared';for(const runId of input.runIds)await tx`INSERT INTO run_artifacts(run_id,version_id,change,attribution,created_at) VALUES(${runId},${versionId},${input.artifactChange},${attribution},${now}) ON CONFLICT DO NOTHING`;}
      const saved=(await tx`SELECT v.*,e.room_id FROM workspace_versions v JOIN workspace_entries e ON e.id=v.entry_id WHERE v.id=${versionId}`)[0];
      return{entry:toEntry((await tx`SELECT * FROM workspace_entries WHERE id=${entry.id as string}`)[0]),version:toVersionRow(saved),created};
    });
  }

  async saveDetachedVersion(input:{roomId:string;path:string;size:number;mimeType:string;sha256:string;runId:string;createdAt?:string}){
    const existing=(await this.database.sql`SELECT * FROM workspace_versions WHERE room_id=${input.roomId} AND path=${input.path} AND sha256=${input.sha256} AND run_ids=${this.database.sql.json([input.runId])} ORDER BY created_at DESC LIMIT 1`)[0];
    if(existing)return toVersionRow(existing);
    const id=crypto.randomUUID(),createdAt=input.createdAt??new Date().toISOString();
    const rows=await this.database.sql`INSERT INTO workspace_versions(id,entry_id,room_id,path,size,mime_type,sha256,source,run_ids,created_at) VALUES(${id},NULL,${input.roomId},${input.path},${input.size},${input.mimeType},${input.sha256},'agent',${this.database.sql.json([input.runId])},${createdAt}) RETURNING *`;
    return toVersionRow(rows[0]);
  }

  async markOversize(roomId:string,path:string,size:number,mimeType:string){const now=new Date().toISOString(),existing=await this.entry(roomId,path),id=existing?.id??crypto.randomUUID();await this.database.sql`INSERT INTO workspace_entries(id,room_id,path,kind,size,mime_type,status,created_at,updated_at,deleted_at) VALUES(${id},${roomId},${path},'file',${size},${mimeType},'oversize',${now},${now},NULL) ON CONFLICT(room_id,path) DO UPDATE SET size=${size},mime_type=${mimeType},status='oversize',updated_at=${now},deleted_at=NULL`;return(await this.entry(roomId,path))!;}

  async softDelete(roomId:string,id:string){const now=new Date().toISOString();const rows=await this.database.sql`UPDATE workspace_entries SET deleted_at=${now},updated_at=${now} WHERE room_id=${roomId} AND (id=${id} OR path LIKE (SELECT path||'/%' FROM workspace_entries WHERE id=${id} AND room_id=${roomId})) AND deleted_at IS NULL RETURNING *`;return rows.map(toEntry);}
  async move(roomId:string,id:string,nextPath:string){return this.database.transaction(async tx=>{const row=(await tx`SELECT * FROM workspace_entries WHERE room_id=${roomId} AND id=${id} AND deleted_at IS NULL FOR UPDATE`)[0];if(!row)return undefined;const old=text(row.path);if((await tx`SELECT 1 FROM workspace_entries WHERE room_id=${roomId} AND path=${nextPath} AND deleted_at IS NULL`).length)return'conflict' as const;await tx`UPDATE workspace_entries SET path=CASE WHEN id=${id} THEN ${nextPath} ELSE ${nextPath} || substring(path from ${old.length+1}) END,updated_at=now() WHERE room_id=${roomId} AND (id=${id} OR path LIKE ${`${old}/%`})`;return toEntry((await tx`SELECT * FROM workspace_entries WHERE id=${id}`)[0]);});}
  async restoreEntry(roomId:string,id:string){const row=(await this.database.sql`UPDATE workspace_entries SET deleted_at=NULL,updated_at=now() WHERE room_id=${roomId} AND id=${id} RETURNING *`)[0];return row?toEntry(row):undefined;}
  async restoreTree(roomId:string,id:string){const rows=await this.database.sql`UPDATE workspace_entries SET deleted_at=NULL,updated_at=now() WHERE room_id=${roomId} AND (id=${id} OR path LIKE (SELECT path||'/%' FROM workspace_entries WHERE id=${id} AND room_id=${roomId})) RETURNING *`;return rows.map(toEntry);}

  async version(roomId:string,id:string,db:QueryContext=this.database.sql){const row=(await db`SELECT * FROM workspace_versions WHERE room_id=${roomId} AND id=${id}`)[0];return row?toVersionRow(row):undefined;}
  async versions(roomId:string,entryId:string){return(await this.database.sql`SELECT v.* FROM workspace_versions v WHERE v.room_id=${roomId} AND v.entry_id=${entryId} ORDER BY v.created_at DESC`).map(toVersionRow);}
  async validateVersions(roomId:string,ids:string[],db:QueryContext=this.database.sql){if(!ids.length)return[];const rows=await db`SELECT * FROM workspace_versions WHERE room_id=${roomId} AND id=ANY(${ids})`;const map=new Map(rows.map(row=>[text(row.id),toVersionRow(row)]));return ids.map(id=>map.get(id)).filter((item):item is VersionRow=>Boolean(item));}
  async currentVersion(roomId:string,filePath:string,db:QueryContext=this.database.sql){const row=(await db`SELECT v.* FROM workspace_entries e JOIN workspace_versions v ON v.id=e.current_version_id WHERE e.room_id=${roomId} AND e.path=${filePath} AND e.deleted_at IS NULL AND e.kind='file' AND e.status='tracked'`)[0];return row?toVersionRow(row):undefined;}
  async versionHashes(versionIds:string[],db:QueryContext=this.database.sql){
    const result=new Map<string,string>();
    if(!versionIds.length)return result;
    for(const row of await db`SELECT id,sha256 FROM workspace_versions WHERE id=ANY(${versionIds})`)result.set(text(row.id),text(row.sha256));
    return result;
  }

  async messageAttachments(messageIds:string[],db:QueryContext=this.database.sql){if(!messageIds.length)return new Map<string,WorkspaceAttachment[]>();const rows=await db`SELECT ma.message_id,ma.position,ma.snapshot_id,v.* FROM message_attachments ma JOIN workspace_versions v ON v.id=ma.version_id WHERE ma.message_id=ANY(${messageIds}) ORDER BY ma.message_id,ma.position`;const result=new Map<string,WorkspaceAttachment[]>();for(const row of rows){const id=text(row.message_id),items=result.get(id)??[],version=toVersionRow(row),snapshotId=row.snapshot_id?text(row.snapshot_id):undefined;items.push(toAttachment(version,snapshotId));result.set(id,items);}return result;}
  async attachMessage(messageId:string,versionIds:string[],db:QueryContext){for(let position=0;position<versionIds.length;position++){const version=(await db`SELECT origin_snapshot_id FROM workspace_versions WHERE id=${versionIds[position]}`)[0],snapshotId=version?.origin_snapshot_id?text(version.origin_snapshot_id):null;await db`INSERT INTO message_attachments(message_id,version_id,position,snapshot_id) VALUES(${messageId},${versionIds[position]},${position},${snapshotId})`;}}

  async linkArtifacts(runIds:string[],version:VersionRow,change:RunArtifact['change'],attribution:RunArtifact['attribution']){const now=new Date().toISOString();for(const runId of runIds)await this.database.sql`INSERT INTO run_artifacts(run_id,version_id,change,attribution,visibility,created_at) VALUES(${runId},${version.id},${change},${attribution},'project',${now}) ON CONFLICT DO NOTHING`;}
  async beginPreviewBundle(input:{roomId:string;runId:string;sourceSnapshotId:string;entrypoint:string;sourceManifestSha256:string;uncompressedSize:number;fileCount:number}){
    const existing=(await this.database.sql`SELECT * FROM preview_bundles WHERE run_id=${input.runId}`)[0];
    if(existing&&text(existing.status)==='ready')return toPreviewBundleRow(existing);
    const id=existing?text(existing.id):crypto.randomUUID(),now=new Date().toISOString();
    const row=(await this.database.sql`INSERT INTO preview_bundles(id,run_id,room_id,source_snapshot_id,entrypoint,source_manifest_sha256,uncompressed_size,file_count,status,created_at,updated_at)
      VALUES(${id},${input.runId},${input.roomId},${input.sourceSnapshotId},${input.entrypoint},${input.sourceManifestSha256},${input.uncompressedSize},${input.fileCount},'capturing',${now},${now})
      ON CONFLICT(run_id) DO UPDATE SET source_snapshot_id=EXCLUDED.source_snapshot_id,entrypoint=EXCLUDED.entrypoint,source_manifest_sha256=EXCLUDED.source_manifest_sha256,uncompressed_size=EXCLUDED.uncompressed_size,file_count=EXCLUDED.file_count,status='capturing',bundle_sha256=NULL,bundle_size=NULL,error=NULL,updated_at=EXCLUDED.updated_at RETURNING *`)[0];
    return toPreviewBundleRow(row);
  }
  async completePreviewBundle(id:string,bundleSha256:string,bundleSize:number){const row=(await this.database.sql`UPDATE preview_bundles SET bundle_sha256=${bundleSha256},bundle_size=${bundleSize},status='ready',error=NULL,updated_at=now() WHERE id=${id} RETURNING *`)[0];return row?toPreviewBundleRow(row):undefined;}
  async failPreviewBundle(id:string,error:string){await this.database.sql`UPDATE preview_bundles SET status='failed',error=${error.slice(0,2000)},updated_at=now() WHERE id=${id}`;}
  async previewBundleForRun(roomId:string,runId:string){const row=(await this.database.sql`SELECT * FROM preview_bundles WHERE room_id=${roomId} AND run_id=${runId}`)[0];return row?toPreviewBundleRow(row):undefined;}
  async previewBundles(roomId:string):Promise<PreviewBundleHistoryRow[]>{return(await this.database.sql`SELECT pb.*,r.persona_handle,r.status run_status,r.created_at run_created_at,rwr.publish_status,rwr.conflict_count,rwr.updated_at result_updated_at FROM preview_bundles pb JOIN agent_runs r ON r.id=pb.run_id LEFT JOIN run_workspace_results rwr ON rwr.run_id=pb.run_id WHERE pb.room_id=${roomId} AND pb.status='ready' ORDER BY r.updated_at DESC,pb.created_at DESC,pb.id DESC`).map(toPreviewBundleHistoryRow);}
  async previewBundleIds(roomId:string){return(await this.database.sql`SELECT id FROM preview_bundles WHERE room_id=${roomId}`).map(row=>text(row.id));}
  async artifactProjections(runIds:string[],db:QueryContext=this.database.sql){
    const result=new Map<string,RunArtifactProjection>();
    if(!runIds.length)return result;
    const ensure=(runId:string)=>{const existing=result.get(runId);if(existing)return existing;const created:RunArtifactProjection={artifacts:[],artifactSummary:{total_count:0,project_count:0,hidden_count:0}};result.set(runId,created);return created};
    for(const row of await db`SELECT ra.run_id,ra.change,ra.attribution,CASE WHEN ra.change='deleted' THEN rwr.base_snapshot_id ELSE rwr.result_snapshot_id END artifact_snapshot_id,v.* FROM run_artifacts ra JOIN workspace_versions v ON v.id=ra.version_id LEFT JOIN run_workspace_results rwr ON rwr.run_id=ra.run_id WHERE ra.run_id=ANY(${runIds}) AND ra.visibility='project' ORDER BY ra.created_at,v.path`){
      const runId=text(row.run_id),snapshotId=row.artifact_snapshot_id?text(row.artifact_snapshot_id):undefined;
      ensure(runId).artifacts.push({...toAttachment(toVersionRow(row),snapshotId),change:text(row.change) as RunArtifact['change'],attribution:text(row.attribution) as RunArtifact['attribution']});
    }
    for(const row of await db`SELECT run_id,COUNT(*)::int total_count,COUNT(*) FILTER(WHERE visibility='project')::int project_count,COUNT(*) FILTER(WHERE visibility='hidden')::int hidden_count FROM run_artifacts WHERE run_id=ANY(${runIds}) GROUP BY run_id`){
      ensure(text(row.run_id)).artifactSummary={total_count:number(row.total_count),project_count:number(row.project_count),hidden_count:number(row.hidden_count)};
    }
    for(const row of await db`SELECT * FROM preview_bundles WHERE run_id=ANY(${runIds})`){
      const runId=text(row.run_id),projection=ensure(runId),preview=toPreviewBundleRow(row);
      if(preview.status==='failed'){projection.staticPreviewStatus='capture_failed';continue}
      if(preview.status!=='ready')continue;
      projection.staticPreview=previewAttachment(preview);
      projection.staticPreviewStatus='ready';
    }
    const previewRows=await db`SELECT rwr.run_id,rwr.result_snapshot_id,se.path preview_path,v.* FROM run_workspace_results rwr JOIN workspace_snapshot_entries se ON se.snapshot_id=rwr.result_snapshot_id LEFT JOIN workspace_versions v ON v.id=se.version_id WHERE rwr.run_id=ANY(${runIds}) AND se.kind='file' AND (se.path='package.json' OR se.path='index.html' OR lower(se.path)=ANY(ARRAY['dist/index.html','build/index.html','out/index.html']) OR lower(se.path) LIKE '%/dist/index.html' OR lower(se.path) LIKE '%/build/index.html' OR lower(se.path) LIKE '%/out/index.html') ORDER BY rwr.run_id,se.path`;
    const candidates=new Map<string,Array<Record<string,unknown>>>();
    for(const row of previewRows){const runId=text(row.run_id),items=candidates.get(runId)??[];items.push(row);candidates.set(runId,items);}
    for(const runId of runIds){
      const projection=ensure(runId);
      if(projection.staticPreview||projection.staticPreviewStatus==='capture_failed')continue;
      const rows=candidates.get(runId)??[],paths=rows.map(row=>text(row.preview_path)),previewPath=selectStaticPreviewPath(paths);
      if(!previewPath){if(hasUnbuiltWebProject(paths))projection.staticPreviewStatus='build_missing';continue;}
      const row=rows.find(item=>text(item.preview_path)===previewPath);
      if(!row?.id)continue;
      const snapshotId=text(row.result_snapshot_id),attachment=toAttachment(toVersionRow(row),snapshotId);
      projection.staticPreview={...attachment,preview_url:runPreviewUrl(text(row.room_id),runId)};
      projection.staticPreviewStatus='ready';
    }
    return result;
  }
  async saveRunEmbeds(runId:string,embeds:RunEmbed[]){await this.database.transaction(async tx=>{await tx`DELETE FROM run_embeds WHERE run_id=${runId}`;for(let position=0;position<embeds.length;position++){const embed=embeds[position];await tx`INSERT INTO run_embeds(run_id,position,kind,path,version_id,error) VALUES(${runId},${position},${embed.kind},${embed.path},${embed.attachment?.version_id??null},${embed.error??null})`;}});}
  async runEmbeds(runIds:string[],db:QueryContext=this.database.sql){if(!runIds.length)return new Map<string,RunEmbed[]>();const rows=await db`SELECT re.run_id,re.position,re.kind,re.path embed_path,re.error,rwr.result_snapshot_id,v.id version_id,v.entry_id,v.path version_path,v.size,v.mime_type,v.room_id FROM run_embeds re LEFT JOIN workspace_versions v ON v.id=re.version_id LEFT JOIN run_workspace_results rwr ON rwr.run_id=re.run_id WHERE re.run_id=ANY(${runIds}) ORDER BY re.run_id,re.position`;const result=new Map<string,RunEmbed[]>();for(const row of rows){const id=text(row.run_id),items=result.get(id)??[],error=row.error?text(row.error) as NonNullable<RunEmbed['error']>:undefined;let attachment:WorkspaceAttachment|undefined;if(row.version_id){const roomId=text(row.room_id),versionId=text(row.version_id),versionPath=text(row.version_path),snapshotId=row.result_snapshot_id?text(row.result_snapshot_id):undefined;attachment={version_id:versionId,...(row.entry_id?{entry_id:text(row.entry_id)}:{}),...(snapshotId?{snapshot_id:snapshotId}:{}),path:versionPath,name:versionPath.split('/').pop()??versionPath,size:number(row.size),mime_type:text(row.mime_type),url:versionUrl(roomId,versionId),preview_url:snapshotId?snapshotPreviewUrl(roomId,snapshotId,versionPath):`${versionUrl(roomId,versionId)}/preview`};}items.push({kind:'image',path:text(row.embed_path),status:attachment?'resolved':'error',...(attachment?{attachment}:{error:error??'not_found'})});result.set(id,items);}return result;}
  async roomHashes(roomId:string){return(await this.database.sql`SELECT DISTINCT sha256 FROM workspace_versions WHERE room_id=${roomId}`).map(row=>text(row.sha256));}
  async hashExists(sha:string){return Boolean((await this.database.sql`SELECT 1 FROM workspace_versions WHERE sha256=${sha} LIMIT 1`)[0]);}
}

function toEntry(row:Record<string,unknown>):WorkspaceEntry{const path=text(row.path);return{id:text(row.id),path,name:path.split('/').pop()??path,kind:text(row.kind) as WorkspaceEntry['kind'],size:number(row.size),mime_type:text(row.mime_type),updated_at:timestamp(row.updated_at),...(row.current_version_id?{current_version_id:text(row.current_version_id)}:{}),deleted_at:row.deleted_at?timestamp(row.deleted_at):null,status:text(row.status) as WorkspaceEntry['status']};}
function toVersionRow(row:Record<string,unknown>):VersionRow{return{id:text(row.id),...(row.entry_id?{entry_id:text(row.entry_id)}:{}),room_id:text(row.room_id),path:text(row.path),size:number(row.size),mime_type:text(row.mime_type),sha256:text(row.sha256),source:text(row.source) as WorkspaceSource,run_ids:stringArray(row.run_ids),created_at:timestamp(row.created_at),...(row.origin_snapshot_id?{origin_snapshot_id:text(row.origin_snapshot_id)}:{})};}
export function toWorkspaceVersion(value:VersionRow):WorkspaceVersion{const snapshotId=value.origin_snapshot_id;return{...value,url:versionUrl(value.room_id,value.id),preview_url:snapshotId?snapshotPreviewUrl(value.room_id,snapshotId,value.path):`${versionUrl(value.room_id,value.id)}/preview`};}
export function toAttachment(value:VersionRow,snapshotId?:string):WorkspaceAttachment{return{version_id:value.id,...(value.entry_id?{entry_id:value.entry_id}:{}),...(snapshotId?{snapshot_id:snapshotId}:{}),path:value.path,name:value.path.split('/').pop()??value.path,size:value.size,mime_type:value.mime_type,url:versionUrl(value.room_id,value.id),preview_url:snapshotId?snapshotPreviewUrl(value.room_id,snapshotId,value.path):`${versionUrl(value.room_id,value.id)}/preview`};}
export function previewAttachment(value:PreviewBundleRow):WorkspaceAttachment{return{version_id:value.id,...(value.sourceSnapshotId?{snapshot_id:value.sourceSnapshotId}:{}),path:value.entrypoint,name:value.entrypoint.split('/').pop()??value.entrypoint,size:value.bundleSize??value.uncompressedSize,mime_type:'text/html',url:runPreviewUrl(value.roomId,value.runId),preview_url:runPreviewUrl(value.roomId,value.runId)};}
function versionUrl(roomId:string,id:string){return`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(id)}`;}
export function snapshotPreviewUrl(roomId:string,snapshotId:string,filePath:string){return`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/snapshots/${encodeURIComponent(snapshotId)}/preview/${filePath.split('/').map(encodeURIComponent).join('/')}`;}
export function runPreviewUrl(roomId:string,runId:string){return`/api/v1/rooms/${encodeURIComponent(roomId)}/runs/${encodeURIComponent(runId)}/preview/`;}
export type WorkspaceVersionRow=VersionRow;
const toPreviewBundleRow=(row:Record<string,unknown>):PreviewBundleRow=>({id:text(row.id),runId:text(row.run_id),roomId:text(row.room_id),...(row.source_snapshot_id?{sourceSnapshotId:text(row.source_snapshot_id)}:{}),entrypoint:text(row.entrypoint),sourceManifestSha256:text(row.source_manifest_sha256),...(row.bundle_sha256?{bundleSha256:text(row.bundle_sha256)}:{}),...(row.bundle_size!=null?{bundleSize:number(row.bundle_size)}:{}),uncompressedSize:number(row.uncompressed_size),fileCount:number(row.file_count),status:text(row.status) as PreviewBundleRow['status'],...(row.error?{error:text(row.error)}:{}),createdAt:timestamp(row.created_at),updatedAt:timestamp(row.updated_at)});
const toPreviewBundleHistoryRow=(row:Record<string,unknown>):PreviewBundleHistoryRow=>({...toPreviewBundleRow(row),agent:text(row.persona_handle),runStatus:text(row.run_status),publishStatus:row.publish_status?text(row.publish_status):'not_published',conflictCount:row.conflict_count==null?0:number(row.conflict_count),runCreatedAt:timestamp(row.run_created_at),resultUpdatedAt:row.result_updated_at?timestamp(row.result_updated_at):timestamp(row.updated_at)});
