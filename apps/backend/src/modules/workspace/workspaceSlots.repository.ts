import type {Database,QueryContext} from '../../infrastructure/database/Database.js';
import {number,text} from '../../infrastructure/database/rowMappers.js';

export type WorkspaceSlotLease={
  id:string;roomId:string;personaId:string;slotIndex:number;generation:number;
  materializedSnapshotId?:string;
  state:'preparing'|'ready'|'running'|'dirty'|'quarantined';
};

export type WorkspaceStatFingerprint={
  path:string;versionId:string;size:number;mtimeNs:string;ctimeNs:string;deviceId:string;fileId:string;
};

export type WorkspaceSlotCache={
  state:'valid'|'invalid'|'unsupported';
  capabilityKey?:string;fenceMtimeNs?:string;verifiedGeneration?:number;
  entries:Map<string,WorkspaceStatFingerprint>;
};

export class WorkspaceSlotRepository{
  constructor(private readonly database:Database){}

  async acquire(roomId:string,runId:string,leaseMs:number,authoritative=true):Promise<WorkspaceSlotLease|undefined>{
    return this.database.transaction(async tx=>{
      const workspaceResult=(await tx`SELECT run_id FROM run_workspace_results WHERE run_id=${runId} FOR UPDATE`)[0];
      if(!workspaceResult)return undefined;
      const existing=await this.leaseForRun(runId,tx);
      if(existing&&existing.state!=='quarantined'){
        await this.recordDriver(tx,runId,existing,authoritative);
        return existing;
      }
      const run=(await tx`SELECT persona_id FROM agent_runs WHERE id=${runId} AND room_id=${roomId}`)[0];
      if(!run)return undefined;
      const personaId=text(run.persona_id),now=new Date(),leaseExpiresAt=new Date(now.getTime()+leaseMs).toISOString();
      for(let slotIndex=0;slotIndex<2;slotIndex++)await tx`INSERT INTO workspace_slots(id,room_id,persona_id,slot_index,state,created_at,updated_at)
        VALUES(${crypto.randomUUID()},${roomId},${personaId},${slotIndex},'ready',${now.toISOString()},${now.toISOString()})
        ON CONFLICT(room_id,persona_id,slot_index) DO NOTHING`;
      const row=(await tx`SELECT * FROM workspace_slots
        WHERE room_id=${roomId} AND persona_id=${personaId} AND owner_run_id IS NULL AND state='ready'
        ORDER BY slot_index FOR UPDATE SKIP LOCKED LIMIT 1`)[0];
      if(!row)return undefined;
      const id=text(row.id),generation=number(row.generation)+1;
      await tx`UPDATE workspace_slots SET owner_run_id=${runId},generation=${generation},state='preparing',lease_expires_at=${leaseExpiresAt},last_error=NULL,updated_at=${now.toISOString()} WHERE id=${id}`;
      const lease=toLease({...row,generation,state:'preparing',owner_run_id:runId});
      await this.recordDriver(tx,runId,lease,authoritative);
      return lease;
    });
  }

  async markLegacy(runId:string){
    await this.database.sql`UPDATE run_workspace_results SET workspace_driver='legacy',workspace_slot_id=NULL,workspace_slot_generation=NULL,updated_at=now() WHERE run_id=${runId}`;
  }

  leaseForRun(runId:string,db:QueryContext=this.database.sql):Promise<WorkspaceSlotLease|undefined>{
    return db`SELECT s.* FROM workspace_slots s WHERE s.owner_run_id=${runId}`
      .then(rows=>rows[0]?toLease(rows[0]):undefined);
  }

  async markRunning(runId:string,generation:number,materializedSnapshotId:string){
    const rows=await this.database.sql`UPDATE workspace_slots SET state='running',materialized_snapshot_id=${materializedSnapshotId},updated_at=now()
      WHERE owner_run_id=${runId} AND generation=${generation} RETURNING id`;
    return Boolean(rows[0]);
  }

  async renew(runId:string,leaseExpiresAt:string){
    await this.database.sql`UPDATE workspace_slots SET lease_expires_at=${leaseExpiresAt},updated_at=now() WHERE owner_run_id=${runId}`;
  }

  async release(runId:string,generation:number,materializedSnapshotId:string){
    const rows=await this.database.sql`UPDATE workspace_slots SET owner_run_id=NULL,state='ready',materialized_snapshot_id=${materializedSnapshotId},lease_expires_at=NULL,last_error=NULL,updated_at=now()
      WHERE owner_run_id=${runId} AND generation=${generation} RETURNING id`;
    return Boolean(rows[0]);
  }

  async quarantine(runId:string,generation:number,error:string){
    const now=new Date(),expiresAt=new Date(now.getTime()+24*60*60_000);
    const rows=await this.database.sql`UPDATE workspace_slots SET owner_run_id=NULL,state='quarantined',lease_expires_at=NULL,
      quarantine_started_at=${now.toISOString()},quarantine_expires_at=${expiresAt.toISOString()},last_error=${error},cache_state='invalid',updated_at=${now.toISOString()}
      WHERE owner_run_id=${runId} AND generation=${generation} RETURNING id`;
    return Boolean(rows[0]);
  }

  async cacheForRun(runId:string):Promise<WorkspaceSlotCache|undefined>{
    const slot=(await this.database.sql`SELECT * FROM workspace_slots WHERE owner_run_id=${runId}`)[0];
    if(!slot)return undefined;
    const rows=await this.database.sql`SELECT * FROM workspace_slot_entries WHERE slot_id=${text(slot.id)} ORDER BY path`;
    return{
      state:text(slot.cache_state) as WorkspaceSlotCache['state'],
      ...(slot.cache_capability_key?{capabilityKey:text(slot.cache_capability_key)}:{}),
      ...(slot.cache_fence_mtime_ns?{fenceMtimeNs:text(slot.cache_fence_mtime_ns)}:{}),
      ...(slot.cache_verified_generation!==null&&slot.cache_verified_generation!==undefined?{verifiedGeneration:number(slot.cache_verified_generation)}:{}),
      entries:new Map(rows.map(row=>{const value=toFingerprint(row);return[value.path,value]})),
    };
  }

  async saveCache(runId:string,generation:number,input:{state:WorkspaceSlotCache['state'];capabilityKey?:string;fenceMtimeNs?:string;verifiedGeneration?:number;entries:WorkspaceStatFingerprint[]}){
    return this.database.transaction(async tx=>{
      const slot=(await tx`SELECT id FROM workspace_slots WHERE owner_run_id=${runId} AND generation=${generation} FOR UPDATE`)[0];
      if(!slot)return false;
      const slotId=text(slot.id);
      await tx`DELETE FROM workspace_slot_entries WHERE slot_id=${slotId}`;
      for(const entry of input.entries)await tx`INSERT INTO workspace_slot_entries(slot_id,path,version_id,size_bytes,mtime_ns,ctime_ns,device_id,file_id)
        VALUES(${slotId},${entry.path},${entry.versionId},${entry.size},${entry.mtimeNs},${entry.ctimeNs},${entry.deviceId},${entry.fileId})`;
      await tx`UPDATE workspace_slots SET cache_state=${input.state},cache_capability_key=${input.capabilityKey??null},
        cache_fence_mtime_ns=${input.fenceMtimeNs??null},cache_verified_generation=${input.verifiedGeneration??null},updated_at=now() WHERE id=${slotId}`;
      return true;
    });
  }

  async invalidateCache(runId:string,generation:number,state:'invalid'|'unsupported'='invalid'){
    await this.database.sql`UPDATE workspace_slots SET cache_state=${state},updated_at=now() WHERE owner_run_id=${runId} AND generation=${generation}`;
  }

  async recoverableQuarantines(){
    return(await this.database.sql`SELECT * FROM workspace_slots WHERE state='quarantined' AND owner_run_id IS NULL AND quarantine_expires_at>now() ORDER BY updated_at`).map(toLease);
  }

  async restoreQuarantine(slotId:string){
    const rows=await this.database.sql`UPDATE workspace_slots SET state='ready',materialized_snapshot_id=NULL,quarantine_started_at=NULL,
      quarantine_expires_at=NULL,last_error=NULL,cache_state='invalid',updated_at=now() WHERE id=${slotId} AND state='quarantined' AND owner_run_id IS NULL RETURNING id`;
    return Boolean(rows[0]);
  }

  private async recordDriver(db:QueryContext,runId:string,lease:WorkspaceSlotLease,authoritative:boolean){
    if(authoritative)await db`UPDATE run_workspace_results SET workspace_driver='warm',workspace_slot_id=${lease.id},workspace_slot_generation=${lease.generation},updated_at=now() WHERE run_id=${runId}`;
    else await db`UPDATE run_workspace_results SET workspace_driver='legacy',workspace_slot_id=NULL,workspace_slot_generation=NULL,updated_at=now() WHERE run_id=${runId}`;
  }
}

const toLease=(row:Record<string,unknown>):WorkspaceSlotLease=>({
  id:text(row.id),roomId:text(row.room_id),personaId:text(row.persona_id),slotIndex:number(row.slot_index),generation:number(row.generation),
  ...(row.materialized_snapshot_id?{materializedSnapshotId:text(row.materialized_snapshot_id)}:{}),
  state:text(row.state) as WorkspaceSlotLease['state'],
});

const toFingerprint=(row:Record<string,unknown>):WorkspaceStatFingerprint=>({
  path:text(row.path),versionId:text(row.version_id),size:number(row.size_bytes),mtimeNs:text(row.mtime_ns),ctimeNs:text(row.ctime_ns),deviceId:text(row.device_id),fileId:text(row.file_id),
});
