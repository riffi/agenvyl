import type {RunWorkspaceResult,WorkspaceCaptureError} from '@agenvyl/contracts';
import type {Database,QueryContext} from '../../infrastructure/database/Database.js';
import {text,timestamp} from '../../infrastructure/database/rowMappers.js';

export class RunWorkspaceRepository{
  constructor(private readonly database:Database){}

  async prepare(roomId:string,runId:string,baseHead:string){
    const now=new Date().toISOString();
    await this.database.transaction(async tx=>{
      await tx`SELECT id FROM rooms WHERE id=${roomId} FOR UPDATE`;
      await tx`INSERT INTO run_workspace_results(run_id,base_head,capture_status,errors,created_at,updated_at)
        VALUES(${runId},${baseHead},'ready','[]'::jsonb,${now},${now})
        ON CONFLICT(run_id) DO NOTHING`;
    });
    return this.result(runId);
  }

  async markFinalizing(runId:string){await this.database.sql`UPDATE run_workspace_results SET capture_status='finalizing',updated_at=now() WHERE run_id=${runId} AND capture_status='ready'`;}

  async complete(runId:string,input:{resultHead:string;checkpointSha?:string;errors:WorkspaceCaptureError[]}){
    const captureStatus=input.errors.length?'incomplete':'complete';
    await this.database.sql`UPDATE run_workspace_results SET result_head=${input.resultHead},checkpoint_sha=${input.checkpointSha??null},capture_status=${captureStatus},errors=${this.database.sql.json(input.errors)},updated_at=now() WHERE run_id=${runId}`;
    return this.result(runId);
  }

  async markFailed(runId:string,error:WorkspaceCaptureError){await this.database.sql`UPDATE run_workspace_results SET capture_status='failed',errors=${this.database.sql.json([error])},updated_at=now() WHERE run_id=${runId}`;}
  result(runId:string,db:QueryContext=this.database.sql){return db`SELECT * FROM run_workspace_results WHERE run_id=${runId}`.then(rows=>rows[0]?toResult(rows[0]):undefined);}
  resultForRoom(roomId:string,runId:string){return this.database.sql`SELECT w.* FROM run_workspace_results w JOIN agent_runs r ON r.id=w.run_id WHERE r.room_id=${roomId} AND w.run_id=${runId}`.then(rows=>rows[0]?toResult(rows[0]):undefined);}
  async results(runIds:string[],db:QueryContext=this.database.sql){if(!runIds.length)return new Map<string,RunWorkspaceResult>();return new Map((await db`SELECT * FROM run_workspace_results WHERE run_id=ANY(${runIds})`).map(row=>[text(row.run_id),toResult(row)]));}
  abandoned(){return this.database.sql`SELECT w.run_id,r.room_id,r.status FROM run_workspace_results w JOIN agent_runs r ON r.id=w.run_id WHERE w.capture_status IN ('ready','finalizing') AND r.status IN ('completed','failed','cancelled')`.then(rows=>rows.map(row=>({runId:text(row.run_id),roomId:text(row.room_id),status:text(row.status) as 'completed'|'failed'|'cancelled'})));}
}

const toResult=(row:Record<string,unknown>):RunWorkspaceResult=>({
  base_head:text(row.base_head),
  ...(row.result_head?{result_head:text(row.result_head)}:{}),
  ...(row.checkpoint_sha?{checkpoint_sha:text(row.checkpoint_sha)}:{}),
  capture_status:text(row.capture_status) as RunWorkspaceResult['capture_status'],
  errors:Array.isArray(row.errors)?row.errors as WorkspaceCaptureError[]:[],
  updated_at:timestamp(row.updated_at),
});
