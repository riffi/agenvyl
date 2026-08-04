import type {Database} from '../../infrastructure/database/Database.js';

export type ProjectRow={id:string;name:string;path:string;pathKey:string;createdAt:string;updatedAt:string};

export class ProjectRepository{
  constructor(private readonly database:Database){}
  async list(){return(await this.database.sql`SELECT id,name,path,path_key,created_at,updated_at FROM local_projects ORDER BY lower(name),id`).map(toProjectRow);}
  async find(id:string){const row=(await this.database.sql`SELECT id,name,path,path_key,created_at,updated_at FROM local_projects WHERE id=${id}`)[0];return row?toProjectRow(row):undefined;}
  async create(input:{name:string;path:string;pathKey:string}){
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await this.database.sql`INSERT INTO local_projects(id,name,path,path_key,created_at,updated_at) VALUES(${id},${input.name},${input.path},${input.pathKey},${now},${now})`;
    return(await this.find(id))!;
  }
  async update(id:string,input:{name:string;path:string;pathKey:string}){
    const rows=await this.database.sql`UPDATE local_projects SET name=${input.name},path=${input.path},path_key=${input.pathKey},updated_at=now() WHERE id=${id} RETURNING id`;
    return rows.length?this.find(id):undefined;
  }
  async delete(id:string){return this.database.transaction(async tx=>{
    const rows=await tx`DELETE FROM local_projects WHERE id=${id} RETURNING id`;
    return Boolean(rows.length);
  });}
}

const toProjectRow=(row:Record<string,unknown>):ProjectRow=>({id:String(row.id),name:String(row.name),path:String(row.path),pathKey:String(row.path_key),createdAt:timestamp(row.created_at),updatedAt:timestamp(row.updated_at)});
const timestamp=(value:unknown)=>value instanceof Date?value.toISOString():String(value);
