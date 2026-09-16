import type {QueryContext} from '../../infrastructure/database/Database.js';

export async function currentRoomProject(tx:QueryContext,roomId:string){
  const[row]=await tx`SELECT p.id project_id_snapshot,p.name project_name_snapshot,p.path project_path_snapshot,'unknown'::text project_availability FROM rooms r LEFT JOIN local_projects p ON p.id=r.project_id WHERE r.id=${roomId} AND r.deleted_at IS NULL FOR UPDATE OF r`;
  return row;
}

export function sameRunProject(source:Record<string,unknown>,current:Record<string,unknown>|undefined){
  return current!==undefined&&(source.project_id_snapshot??null)===(current.project_id_snapshot??null)&&(source.project_path_snapshot??null)===(current.project_path_snapshot??null);
}
