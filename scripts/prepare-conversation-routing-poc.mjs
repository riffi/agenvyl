import postgres from 'postgres';
import {cp,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assertSafePocTargets,databaseName,databaseUrl,exists,pocArtifactRoot,pocDatabaseName,pocRoot,pocWorkspaceRoot,repositoryRoot,snapshotFiles,sourceDatabaseUrl} from './conversation-routing-poc-common.mjs';

assertSafePocTargets();
const sourceUrl=sourceDatabaseUrl(),sourceName=databaseName(sourceUrl);
if(sourceName===pocDatabaseName)fail('Source database must not be the POC database');
await requireStoppedRuntime();
const sourceWorkspace=resolve(process.env.AGENVYL_SOURCE_WORKSPACE_ROOT?.trim()||process.env.AGENVYL_WORKSPACE_ROOT?.trim()||resolve(repositoryRoot,'data','room-workspaces'));
const sourceArtifacts=resolve(process.env.AGENVYL_SOURCE_ARTIFACT_ROOT?.trim()||process.env.AGENVYL_ARTIFACT_ROOT?.trim()||resolve(repositoryRoot,'data','artifacts'));
if([sourceWorkspace,sourceArtifacts].some(path=>path===pocRoot||path.startsWith(`${pocRoot}\\`)||path.startsWith(`${pocRoot}/`)))fail('Source paths must be outside the POC directory');
if(await exists(pocRoot))fail(`POC directory already exists: ${pocRoot}`);

const source=postgres(sourceUrl,{max:1});
const before=await databaseSnapshot(source),workspaceBefore=await snapshotFiles(sourceWorkspace),artifactsBefore=await snapshotFiles(sourceArtifacts);
await source.end();
const maintenance=postgres(databaseUrl('postgres'),{max:1});
try{
  const sessions=await maintenance`SELECT pid FROM pg_stat_activity WHERE datname=${sourceName} AND pid<>pg_backend_pid()`;
  if(sessions.length)fail(`Source runtime/database still has ${sessions.length} active connection(s)`);
  if((await maintenance`SELECT 1 FROM pg_database WHERE datname=${pocDatabaseName}`).length)fail(`POC database ${pocDatabaseName} already exists; run poc:routing:destroy first`);
  await maintenance.unsafe(`CREATE DATABASE ${quoteIdentifier(pocDatabaseName)} WITH TEMPLATE ${quoteIdentifier(sourceName)}`);
}finally{await maintenance.end();}

await mkdir(pocRoot,{recursive:false});
try{
  await copyDirectory(sourceWorkspace,pocWorkspaceRoot);
  await copyDirectory(sourceArtifacts,pocArtifactRoot);
  const poc=postgres(databaseUrl(pocDatabaseName),{max:1});
  try{
    await applyMissingMigrations(poc);
    await poc.begin(async tx=>{
      await tx`UPDATE rooms SET project_id=NULL`;
      await tx`UPDATE installation_state SET workspace_root=${pocWorkspaceRoot} WHERE id=true`;
      await tx`UPDATE agent_runs SET status='failed',error='POC copy: source runtime was intentionally detached',error_code='poc_copy_detached',upstream_run_id=NULL,connector_execution_id=NULL,connector_epoch=NULL,connector_cursor=NULL,upstream_status=NULL,updated_at=now() WHERE status IN('queued','streaming','finalizing','stopping','waiting_approval','waiting_clarification')`;
      await tx`DELETE FROM run_continuation_chains`;
      await tx`UPDATE pending_agent_follow_ups SET status='failed',updated_at=now() WHERE status IN('queued','dispatching')`;
      await tx`UPDATE room_messages SET delivery_status='failed',delivery_error='POC copy detached the original execution',delivery_updated_at=now() WHERE delivery_status IN('queued','dispatching')`;
    });
  }finally{await poc.end();}
  const verify=postgres(sourceUrl,{max:1});
  try{assertSame(before,await databaseSnapshot(verify),'source database');}finally{await verify.end();}
  assertSame(workspaceBefore,await snapshotFiles(sourceWorkspace),'source workspace hashes');
  assertSame(artifactsBefore,await snapshotFiles(sourceArtifacts),'source artifact hashes');
}catch(error){
  await rm(pocRoot,{recursive:true,force:true});
  const cleanup=postgres(databaseUrl('postgres'),{max:1});
  try{await cleanup.unsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(pocDatabaseName)}`)}finally{await cleanup.end()}
  throw error;
}

process.stdout.write(`Conversation routing POC prepared.\nDatabase: ${pocDatabaseName}\nWorkspace: ${pocWorkspaceRoot}\nArtifacts: ${pocArtifactRoot}\nSet AGENVYL_EXPERIMENT_CONVERSATION_ROUTING=true and point the POC runtime at these isolated targets.\n`);

async function requireStoppedRuntime(){const url=process.env.AGENVYL_CORE_URL?.trim()||'http://127.0.0.1:8791/health';try{const response=await fetch(url,{signal:AbortSignal.timeout(800)});if(response.ok)fail(`Main runtime is responding at ${url}; stop it before preparing the POC`)}catch(error){if(error?.name==='AbortError'||error?.name==='TimeoutError'||String(error?.cause?.code??'').startsWith('ECONNREFUSED'))return;if(error?.message?.startsWith('Main runtime'))throw error;}}
async function databaseSnapshot(sql){const[rooms]=await sql`SELECT COUNT(*)::int count FROM rooms`,[messages]=await sql`SELECT COUNT(*)::int count FROM room_messages`,migrations=await sql`SELECT version,name FROM schema_migrations ORDER BY version`;return{rooms:Number(rooms.count),messages:Number(messages.count),migrations:migrations.map(row=>[Number(row.version),String(row.name)])};}
async function applyMissingMigrations(sql){const directory=resolve(repositoryRoot,'apps','backend','src','infrastructure','database','migrations'),files=(await readdir(directory)).filter(file=>/^\d{3}_.+\.sql$/.test(file)).sort();for(const file of files){const version=Number(file.slice(0,3));if((await sql`SELECT 1 FROM schema_migrations WHERE version=${version}`).length)continue;const name=file.slice(4,-4);await sql.begin(async tx=>{await tx.unsafe(await readFile(resolve(directory,file),'utf8'));await tx`INSERT INTO schema_migrations(version,name) VALUES(${version},${name})`})}}
async function copyDirectory(source,target){if(await exists(source))await cp(source,target,{recursive:true,force:false,errorOnExist:true});else await mkdir(target,{recursive:true})}
function quoteIdentifier(value){return`"${value.replaceAll('"','""')}"`}
function assertSame(before,after,label){if(JSON.stringify(before)!==JSON.stringify(after))fail(`${label} changed while preparing the POC`)}
function fail(message){throw new Error(message)}
