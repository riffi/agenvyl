import type {Database,QueryContext} from '../../infrastructure/database/Database.js';
import type {LocalUserProfile} from '../../types.js';

export class UserProfileRepository{
  constructor(private readonly database:Database){}
  async get(db:QueryContext=this.database.sql):Promise<LocalUserProfile>{const[row]=await db`SELECT id,display_name,handle,created_at,updated_at FROM local_user_profiles WHERE id='local-user'`;return map(row);}
  async update(displayName:string,handle:string):Promise<LocalUserProfile>{return this.database.transaction(async tx=>{await tx`SELECT id FROM local_user_profiles WHERE id='local-user' FOR UPDATE`;const[row]=await tx`UPDATE local_user_profiles SET display_name=${displayName},handle=${handle},updated_at=now() WHERE id='local-user' RETURNING id,display_name,handle,created_at,updated_at`;return map(row);});}
}

function map(row:Record<string,unknown>):LocalUserProfile{return{id:String(row.id),displayName:String(row.display_name),handle:String(row.handle),createdAt:timestamp(row.created_at),updatedAt:timestamp(row.updated_at)};}
function timestamp(value:unknown){return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
