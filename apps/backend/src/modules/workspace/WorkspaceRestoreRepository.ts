import type {WorkspaceHistoryRun,WorkspaceRestoreRecord,WorkspaceRestoreTarget} from '@agenvyl/contracts';
import type {Database} from '../../infrastructure/database/Database.js';
import {text,timestamp} from '../../infrastructure/database/rowMappers.js';
import {RoomEventRepository} from '../room-events/roomEvents.repository.js';

export type RestoreOperation=WorkspaceRestoreRecord&{
  requestId:string;fingerprint:string;originalHead:string;branchRef:string;outputFingerprint:string;preservedPaths:string[];
};

export class WorkspaceRestoreRepository {
  constructor(private readonly database:Database){}
  async runs(roomId:string):Promise<WorkspaceHistoryRun[]>{
    return (await this.database.sql`SELECT r.id,r.persona_handle,r.status,r.created_at,w.base_head,w.result_head,w.capture_status
      FROM agent_runs r LEFT JOIN run_workspace_results w ON w.run_id=r.id WHERE r.room_id=${roomId} ORDER BY r.created_at DESC,r.id DESC`).map(row=>({
      kind:'run',id:text(row.id),agent:text(row.persona_handle),status:text(row.status),createdAt:timestamp(row.created_at),
      ...(row.base_head?{baseHead:text(row.base_head)}:{}),...(row.result_head?{resultHead:text(row.result_head)}:{}),...(row.capture_status?{captureStatus:text(row.capture_status)}:{}),
    }));
  }
  async history(roomId:string){return (await this.database.sql`SELECT * FROM workspace_restores WHERE room_id=${roomId} ORDER BY created_at DESC,id DESC`).map(toOperation);}
  async find(roomId:string,id:string){const [row]=await this.database.sql`SELECT * FROM workspace_restores WHERE room_id=${roomId} AND id=${id}`;return row?toOperation(row):undefined;}
  async request(roomId:string,requestId:string){const [row]=await this.database.sql`SELECT * FROM workspace_restores WHERE room_id=${roomId} AND request_id=${requestId}`;return row?toOperation(row):undefined;}
  async pending(roomId?:string){return (await this.database.sql`SELECT * FROM workspace_restores WHERE status='pending' AND (${roomId??null}::text IS NULL OR room_id=${roomId??null}) ORDER BY created_at`).map(toOperation);}
  async latest(roomId:string){const [row]=await this.database.sql`SELECT * FROM workspace_restores WHERE room_id=${roomId} AND status='complete' ORDER BY completed_at DESC,id DESC LIMIT 1`;return row?toOperation(row):undefined;}
  async forHead(roomId:string,head:string){const [row]=await this.database.sql`SELECT * FROM workspace_restores WHERE room_id=${roomId} AND result_head=${head} AND status='complete' ORDER BY completed_at DESC LIMIT 1`;return row?toOperation(row):undefined;}
  async begin(input:Omit<RestoreOperation,'kind'|'createdAt'|'status'>){
    await this.database.sql`INSERT INTO workspace_restores(id,room_id,request_id,target_kind,target_id,fingerprint,original_head,branch_ref,before_head,target_head,result_head,preview_run_id,output_fingerprint,preserved_paths)
      VALUES(${input.id},${input.roomId},${input.requestId},${input.target.kind},${input.target.id},${input.fingerprint},${input.originalHead},${input.branchRef},${input.beforeHead},${input.targetHead},${input.resultHead},${input.previewRunId??null},${input.outputFingerprint},${this.database.sql.json(input.preservedPaths)})`;
    return (await this.find(input.roomId,input.id))!;
  }
  async failed(id:string,error:string){await this.database.sql`UPDATE workspace_restores SET error=${error.slice(0,2000)} WHERE id=${id} AND status='pending'`;}
  async complete(operation:RestoreOperation){
    return this.database.transaction(async tx=>{
      const [row]=await tx`UPDATE workspace_restores SET status='complete',error=NULL,completed_at=now() WHERE id=${operation.id} AND status='pending' RETURNING *`;
      if(!row)return undefined;
      return new RoomEventRepository(this.database).appendInTransaction(tx,operation.roomId,'workspace.restored',{restoration:publicRestore(toOperation(row))},timestamp(row.completed_at));
    });
  }
}

export const publicRestore=(value:RestoreOperation):WorkspaceRestoreRecord=>({
  kind:'restore',id:value.id,roomId:value.roomId,target:value.target,targetHead:value.targetHead,beforeHead:value.beforeHead,resultHead:value.resultHead,
  createdAt:value.createdAt,status:value.status,...(value.previewRunId?{previewRunId:value.previewRunId}:{}),...(value.error?{error:value.error}:{}),
});
const toOperation=(row:Record<string,unknown>):RestoreOperation=>({
  kind:'restore',id:text(row.id),roomId:text(row.room_id),target:{kind:text(row.target_kind) as WorkspaceRestoreTarget['kind'],id:text(row.target_id)},
  requestId:text(row.request_id),fingerprint:text(row.fingerprint),originalHead:text(row.original_head),branchRef:text(row.branch_ref),
  beforeHead:text(row.before_head),targetHead:text(row.target_head),resultHead:text(row.result_head),outputFingerprint:text(row.output_fingerprint),
  preservedPaths:Array.isArray(row.preserved_paths)?row.preserved_paths as string[]:[],
  createdAt:timestamp(row.created_at),status:text(row.status) as RestoreOperation['status'],...(row.preview_run_id?{previewRunId:text(row.preview_run_id)}:{}),...(row.error?{error:text(row.error)}:{}),
});
