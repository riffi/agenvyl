import type {Database,QueryContext} from '../../infrastructure/database/Database.js';
import {number,stringArray,text,timestamp} from '../../infrastructure/database/rowMappers.js';
import type {RunArtifact,RunEmbed,WorkspaceAttachment,WorkspaceEntry,WorkspaceSource,WorkspaceVersion} from '@agenvyl/contracts';

type VersionRow={id:string;entry_id:string;room_id:string;path:string;size:number;mime_type:string;sha256:string;source:WorkspaceSource;run_ids:string[];created_at:string};

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

  async saveVersion(input:{roomId:string;path:string;size:number;mimeType:string;sha256:string;source:WorkspaceSource;runIds:string[];createdAt?:string;force?:boolean;artifactChange?:RunArtifact['change'];expectedCurrentVersionId?:string}){
    return this.database.transaction(async tx=>{
      const now=input.createdAt??new Date().toISOString();
      if(input.path==='plan.md')await tx`SELECT id FROM rooms WHERE id=${input.roomId} FOR UPDATE`;
      let entry=(await tx`SELECT * FROM workspace_entries WHERE room_id=${input.roomId} AND path=${input.path} FOR UPDATE`)[0];
      const created=!entry||entry.deleted_at!=null;
      if(input.expectedCurrentVersionId!==undefined&&entry?.current_version_id!==input.expectedCurrentVersionId)throw new Error('plan_version_conflict');
      if(!entry){const id=crypto.randomUUID();await tx`INSERT INTO workspace_entries(id,room_id,path,kind,size,mime_type,status,created_at,updated_at) VALUES(${id},${input.roomId},${input.path},'file',${input.size},${input.mimeType},'tracked',${now},${now})`;entry=(await tx`SELECT * FROM workspace_entries WHERE id=${id}`)[0];}
      const current=entry.current_version_id?(await tx`SELECT sha256 FROM workspace_versions WHERE id=${entry.current_version_id as string}`)[0]:undefined;
      if(!input.force&&current?.sha256===input.sha256&&entry.deleted_at==null){await tx`UPDATE workspace_entries SET size=${input.size},mime_type=${input.mimeType},updated_at=${now},status='tracked' WHERE id=${entry.id as string}`;return{entry:toEntry({...entry,size:input.size,mime_type:input.mimeType,updated_at:now}),version:undefined,created:false};}
      const versionId=crypto.randomUUID();
      await tx`INSERT INTO workspace_versions(id,entry_id,path,size,mime_type,sha256,source,run_ids,created_at) VALUES(${versionId},${entry.id as string},${input.path},${input.size},${input.mimeType},${input.sha256},${input.source},${this.database.sql.json(input.runIds)},${now})`;
      await tx`UPDATE workspace_entries SET kind='file',size=${input.size},mime_type=${input.mimeType},status='tracked',current_version_id=${versionId},updated_at=${now},deleted_at=NULL WHERE id=${entry.id as string}`;
      if(input.artifactChange&&input.runIds.length){const attribution=input.runIds.length===1?'exact':'shared';for(const runId of input.runIds)await tx`INSERT INTO run_artifacts(run_id,version_id,change,attribution,created_at) VALUES(${runId},${versionId},${input.artifactChange},${attribution},${now}) ON CONFLICT DO NOTHING`;}
      const saved=(await tx`SELECT v.*,e.room_id FROM workspace_versions v JOIN workspace_entries e ON e.id=v.entry_id WHERE v.id=${versionId}`)[0];
      return{entry:toEntry((await tx`SELECT * FROM workspace_entries WHERE id=${entry.id as string}`)[0]),version:toVersionRow(saved),created};
    });
  }

  async markOversize(roomId:string,path:string,size:number,mimeType:string){const now=new Date().toISOString(),existing=await this.entry(roomId,path),id=existing?.id??crypto.randomUUID();await this.database.sql`INSERT INTO workspace_entries(id,room_id,path,kind,size,mime_type,status,created_at,updated_at,deleted_at) VALUES(${id},${roomId},${path},'file',${size},${mimeType},'oversize',${now},${now},NULL) ON CONFLICT(room_id,path) DO UPDATE SET size=${size},mime_type=${mimeType},status='oversize',updated_at=${now},deleted_at=NULL`;return(await this.entry(roomId,path))!;}

  async softDelete(roomId:string,id:string){const now=new Date().toISOString();const rows=await this.database.sql`UPDATE workspace_entries SET deleted_at=${now},updated_at=${now} WHERE room_id=${roomId} AND (id=${id} OR path LIKE (SELECT path||'/%' FROM workspace_entries WHERE id=${id} AND room_id=${roomId})) AND deleted_at IS NULL RETURNING *`;return rows.map(toEntry);}
  async move(roomId:string,id:string,nextPath:string){return this.database.transaction(async tx=>{const row=(await tx`SELECT * FROM workspace_entries WHERE room_id=${roomId} AND id=${id} AND deleted_at IS NULL FOR UPDATE`)[0];if(!row)return undefined;const old=text(row.path);if((await tx`SELECT 1 FROM workspace_entries WHERE room_id=${roomId} AND path=${nextPath} AND deleted_at IS NULL`).length)return'conflict' as const;await tx`UPDATE workspace_entries SET path=${nextPath}||substring(path from ${old.length+1}),updated_at=now() WHERE room_id=${roomId} AND (id=${id} OR path LIKE ${`${old}/%`})`;return toEntry((await tx`SELECT * FROM workspace_entries WHERE id=${id}`)[0]);});}
  async restoreEntry(roomId:string,id:string){const row=(await this.database.sql`UPDATE workspace_entries SET deleted_at=NULL,updated_at=now() WHERE room_id=${roomId} AND id=${id} RETURNING *`)[0];return row?toEntry(row):undefined;}
  async restoreTree(roomId:string,id:string){const rows=await this.database.sql`UPDATE workspace_entries SET deleted_at=NULL,updated_at=now() WHERE room_id=${roomId} AND (id=${id} OR path LIKE (SELECT path||'/%' FROM workspace_entries WHERE id=${id} AND room_id=${roomId})) RETURNING *`;return rows.map(toEntry);}

  async version(roomId:string,id:string,db:QueryContext=this.database.sql){const row=(await db`SELECT v.*,e.room_id FROM workspace_versions v JOIN workspace_entries e ON e.id=v.entry_id WHERE e.room_id=${roomId} AND v.id=${id}`)[0];return row?toVersionRow(row):undefined;}
  async versions(roomId:string,entryId:string){return(await this.database.sql`SELECT v.*,e.room_id FROM workspace_versions v JOIN workspace_entries e ON e.id=v.entry_id WHERE e.room_id=${roomId} AND e.id=${entryId} ORDER BY v.created_at DESC`).map(toVersionRow);}
  async versionAt(roomId:string,filePath:string,at:string){const row=(await this.database.sql`SELECT v.*,e.room_id FROM workspace_versions v JOIN workspace_entries e ON e.id=v.entry_id WHERE e.room_id=${roomId} AND v.path=${filePath} AND v.created_at<=${at} ORDER BY v.created_at DESC LIMIT 1`)[0];return row?toVersionRow(row):undefined;}
  async validateVersions(roomId:string,ids:string[],db:QueryContext=this.database.sql){if(!ids.length)return[];const rows=await db`SELECT v.*,e.room_id FROM workspace_versions v JOIN workspace_entries e ON e.id=v.entry_id WHERE e.room_id=${roomId} AND v.id=ANY(${ids})`;const map=new Map(rows.map(row=>[text(row.id),toVersionRow(row)]));return ids.map(id=>map.get(id)).filter((item):item is VersionRow=>Boolean(item));}
  async currentVersion(roomId:string,filePath:string,db:QueryContext=this.database.sql){const row=(await db`SELECT v.*,e.room_id FROM workspace_entries e JOIN workspace_versions v ON v.id=e.current_version_id WHERE e.room_id=${roomId} AND e.path=${filePath} AND e.deleted_at IS NULL AND e.kind='file' AND e.status='tracked'`)[0];return row?toVersionRow(row):undefined;}

  async messageAttachments(messageIds:string[],db:QueryContext=this.database.sql){if(!messageIds.length)return new Map<string,WorkspaceAttachment[]>();const rows=await db`SELECT ma.message_id,ma.position,v.*,e.room_id FROM message_attachments ma JOIN workspace_versions v ON v.id=ma.version_id JOIN workspace_entries e ON e.id=v.entry_id WHERE ma.message_id=ANY(${messageIds}) ORDER BY ma.message_id,ma.position`;const result=new Map<string,WorkspaceAttachment[]>();for(const row of rows){const id=text(row.message_id),items=result.get(id)??[];items.push(toAttachment(toVersionRow(row)));result.set(id,items);}return result;}
  async attachMessage(messageId:string,versionIds:string[],db:QueryContext){for(let position=0;position<versionIds.length;position++)await db`INSERT INTO message_attachments(message_id,version_id,position) VALUES(${messageId},${versionIds[position]},${position})`;}

  async linkArtifacts(runIds:string[],version:VersionRow,change:RunArtifact['change'],attribution:RunArtifact['attribution']){const now=new Date().toISOString();for(const runId of runIds)await this.database.sql`INSERT INTO run_artifacts(run_id,version_id,change,attribution,created_at) VALUES(${runId},${version.id},${change},${attribution},${now}) ON CONFLICT DO NOTHING`;}
  async artifacts(runIds:string[],db:QueryContext=this.database.sql){if(!runIds.length)return new Map<string,RunArtifact[]>();const rows=await db`SELECT ra.run_id,ra.change,ra.attribution,v.*,e.room_id FROM run_artifacts ra JOIN workspace_versions v ON v.id=ra.version_id JOIN workspace_entries e ON e.id=v.entry_id WHERE ra.run_id=ANY(${runIds}) ORDER BY ra.created_at`;const result=new Map<string,RunArtifact[]>();for(const row of rows){const id=text(row.run_id),items=result.get(id)??[];items.push({...toAttachment(toVersionRow(row)),change:text(row.change) as RunArtifact['change'],attribution:text(row.attribution) as RunArtifact['attribution']});result.set(id,items);}return result;}
  async saveRunEmbeds(runId:string,embeds:RunEmbed[]){await this.database.transaction(async tx=>{await tx`DELETE FROM run_embeds WHERE run_id=${runId}`;for(let position=0;position<embeds.length;position++){const embed=embeds[position];await tx`INSERT INTO run_embeds(run_id,position,kind,path,version_id,error) VALUES(${runId},${position},${embed.kind},${embed.path},${embed.attachment?.version_id??null},${embed.error??null})`;}});}
  async runEmbeds(runIds:string[],db:QueryContext=this.database.sql){if(!runIds.length)return new Map<string,RunEmbed[]>();const rows=await db`SELECT re.run_id,re.position,re.kind,re.path embed_path,re.error,v.id version_id,v.entry_id,v.path version_path,v.size,v.mime_type,e.room_id FROM run_embeds re LEFT JOIN workspace_versions v ON v.id=re.version_id LEFT JOIN workspace_entries e ON e.id=v.entry_id WHERE re.run_id=ANY(${runIds}) ORDER BY re.run_id,re.position`;const result=new Map<string,RunEmbed[]>();for(const row of rows){const id=text(row.run_id),items=result.get(id)??[],error=row.error?text(row.error) as NonNullable<RunEmbed['error']>:undefined;let attachment:WorkspaceAttachment|undefined;if(row.version_id){const roomId=text(row.room_id),versionId=text(row.version_id),versionPath=text(row.version_path);attachment={version_id:versionId,entry_id:text(row.entry_id),path:versionPath,name:versionPath.split('/').pop()??versionPath,size:number(row.size),mime_type:text(row.mime_type),url:versionUrl(roomId,versionId),preview_url:`${versionUrl(roomId,versionId)}/preview`};}items.push({kind:'image',path:text(row.embed_path),status:attachment?'resolved':'error',...(attachment?{attachment}:{error:error??'not_found'})});result.set(id,items);}return result;}
  async roomHashes(roomId:string){return(await this.database.sql`SELECT DISTINCT v.sha256 FROM workspace_versions v JOIN workspace_entries e ON e.id=v.entry_id WHERE e.room_id=${roomId}`).map(row=>text(row.sha256));}
  async hashExists(sha:string){return Boolean((await this.database.sql`SELECT 1 FROM workspace_versions WHERE sha256=${sha} LIMIT 1`)[0]);}
}

function toEntry(row:Record<string,unknown>):WorkspaceEntry{const path=text(row.path);return{id:text(row.id),path,name:path.split('/').pop()??path,kind:text(row.kind) as WorkspaceEntry['kind'],size:number(row.size),mime_type:text(row.mime_type),updated_at:timestamp(row.updated_at),...(row.current_version_id?{current_version_id:text(row.current_version_id)}:{}),deleted_at:row.deleted_at?timestamp(row.deleted_at):null,status:text(row.status) as WorkspaceEntry['status']};}
function toVersionRow(row:Record<string,unknown>):VersionRow{return{id:text(row.id),entry_id:text(row.entry_id),room_id:text(row.room_id),path:text(row.path),size:number(row.size),mime_type:text(row.mime_type),sha256:text(row.sha256),source:text(row.source) as WorkspaceSource,run_ids:stringArray(row.run_ids),created_at:timestamp(row.created_at)};}
export function toWorkspaceVersion(value:VersionRow):WorkspaceVersion{return{...value,url:versionUrl(value.room_id,value.id),preview_url:`${versionUrl(value.room_id,value.id)}/preview`};}
export function toAttachment(value:VersionRow):WorkspaceAttachment{return{version_id:value.id,entry_id:value.entry_id,path:value.path,name:value.path.split('/').pop()??value.path,size:value.size,mime_type:value.mime_type,url:versionUrl(value.room_id,value.id),preview_url:`${versionUrl(value.room_id,value.id)}/preview`};}
function versionUrl(roomId:string,id:string){return`/api/v1/rooms/${encodeURIComponent(roomId)}/workspace/versions/${encodeURIComponent(id)}`;}
export type WorkspaceVersionRow=VersionRow;
