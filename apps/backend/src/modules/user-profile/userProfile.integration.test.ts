import {describe,expect,it,vi} from 'vitest';
import {buildApp} from '../../app.js';
import {connectTestDatabase,testDatabaseUrl} from '../../testDatabase.js';

describe('local user profile API',()=>{
  it('reads, normalizes and atomically updates the singleton profile',async()=>{
    const url=testDatabaseUrl('user_profile_api'),app=await buildApp({databaseUrl:url,connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32),fetch:vi.fn<typeof fetch>(),distPath:'missing-dist'});
    expect((await app.inject('/api/v1/user-profile')).json()).toMatchObject({id:'local-user',displayName:'Пользователь',handle:'user'});
    const updated=await app.inject({method:'PUT',url:'/api/v1/user-profile',payload:{display_name:'  Владимир  ',handle:' @VlAdImIr '}});
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({id:'local-user',displayName:'Владимир',handle:'vladimir'});
    expect((await app.inject('/api/v1/user-profile')).json()).toMatchObject({displayName:'Владимир',handle:'vladimir'});
    await app.close();
  });

  it('returns typed validation, reserved and persona-conflict errors without partial updates',async()=>{
    const url=testDatabaseUrl('user_profile_validation'),app=await buildApp({databaseUrl:url,connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32),fetch:vi.fn<typeof fetch>(),distPath:'missing-dist'});
    const cases=[
      [{display_name:' ',handle:'valid'},400,'display_name_required'],
      [{display_name:'Human',handle:'bad handle'},400,'invalid_handle'],
      [{display_name:'Human',handle:'ALL'},400,'reserved_handle'],
      [{display_name:'Human',handle:'ArChItEcT'},409,'user_handle_conflict'],
    ] as const;
    for(const[payload,status,error]of cases){const response=await app.inject({method:'PUT',url:'/api/v1/user-profile',payload});expect(response.statusCode).toBe(status);expect(response.json().error).toBe(error);}
    expect((await app.inject('/api/v1/user-profile')).json()).toMatchObject({displayName:'Пользователь',handle:'user'});
    const sql=connectTestDatabase(url);await sql`UPDATE personas SET archived_at=now() WHERE handle='architect'`;
    const archivedConflict=await app.inject({method:'PUT',url:'/api/v1/user-profile',payload:{display_name:'Human',handle:'architect'}});
    expect(archivedConflict.statusCode).toBe(409);expect(archivedConflict.json().error).toBe('user_handle_conflict');
    await sql.end();await app.close();
  });
});
