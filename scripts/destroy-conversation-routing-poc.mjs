import postgres from 'postgres';
import {rm} from 'node:fs/promises';
import {assertSafePocTargets,databaseName,databaseUrl,exists,pocDatabaseName,pocRoot,sourceDatabaseUrl} from './conversation-routing-poc-common.mjs';

assertSafePocTargets();
if(databaseName(sourceDatabaseUrl())===pocDatabaseName)throw new Error('Refusing to destroy while the configured source database is the POC database');
const maintenance=postgres(databaseUrl('postgres'),{max:1});
try{
  const sessions=await maintenance`SELECT pid FROM pg_stat_activity WHERE datname=${pocDatabaseName} AND pid<>pg_backend_pid()`;
  if(sessions.length)throw new Error(`POC runtime still has ${sessions.length} active database connection(s); stop it before destroy`);
  if((await maintenance`SELECT 1 FROM pg_database WHERE datname=${pocDatabaseName}`).length)await maintenance.unsafe(`DROP DATABASE "${pocDatabaseName}"`);
}finally{await maintenance.end()}
if(await exists(pocRoot))await rm(pocRoot,{recursive:true,force:false});
process.stdout.write(`Removed POC database ${pocDatabaseName} and ${pocRoot}. The Git branch was not deleted.\n`);
