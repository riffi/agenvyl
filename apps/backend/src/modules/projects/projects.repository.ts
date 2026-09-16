import type {Database} from '../../infrastructure/database/Database.js';

export type ProjectRow={id:string;name:string;path:string;pathKey:string;createdAt:string;updatedAt:string};

export class ProjectRepository{
  constructor(private readonly database:Database){}
  async previewSettings(id:string){const [row]=await this.database.sql`SELECT preview_entrypoint,build_command FROM local_projects WHERE id=${id}`;return{entrypoint:row?.preview_entrypoint as string|null??null,build_command:row?.build_command as string|null??null};}
  async savePreviewSettings(id:string,input:{entrypoint:string|null;build_command:string|null}){await this.database.sql`UPDATE local_projects SET preview_entrypoint=${input.entrypoint},build_command=${input.build_command},updated_at=now() WHERE id=${id}`;return input;}
  async roomProject(roomId:string){const[row]=await this.database.sql`SELECT project_id FROM rooms WHERE id=${roomId} AND deleted_at IS NULL`;return row?.project_id?String(row.project_id):undefined;}
  async list(){return(await this.database.sql`SELECT id,name,path,path_key,created_at,updated_at FROM local_projects ORDER BY lower(name),id`).map(toProjectRow);}
  async find(id:string){const row=(await this.database.sql`SELECT id,name,path,path_key,created_at,updated_at FROM local_projects WHERE id=${id}`)[0];return row?toProjectRow(row):undefined;}
  async create(input:{name:string;path:string;pathKey:string}){
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await this.database.sql`INSERT INTO local_projects(id,name,path,path_key,created_at,updated_at) VALUES(${id},${input.name},${input.path},${input.pathKey},${now},${now})`;
    return(await this.find(id))!;
  }
  async update(id:string,input:{name:string;path:string;pathKey:string}){
    const rows=await this.database.sql`UPDATE local_projects SET name=${input.name},preview_entrypoint=CASE WHEN path_key=${input.pathKey} THEN preview_entrypoint ELSE NULL END,build_command=CASE WHEN path_key=${input.pathKey} THEN build_command ELSE NULL END,path=${input.path},path_key=${input.pathKey},updated_at=now() WHERE id=${id} RETURNING id`;
    return rows.length?this.find(id):undefined;
  }
  async delete(id:string){return this.database.transaction(async tx=>{
    const rows=await tx`DELETE FROM local_projects WHERE id=${id} RETURNING id`;
    return Boolean(rows.length);
  });}
}

const toProjectRow=(row:Record<string,unknown>):ProjectRow=>({id:String(row.id),name:String(row.name),path:String(row.path),pathKey:String(row.path_key),createdAt:timestamp(row.created_at),updatedAt:timestamp(row.updated_at)});
const timestamp=(value:unknown)=>value instanceof Date?value.toISOString():String(value);
