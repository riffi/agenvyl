import {DEFAULT_ROOM_TITLE,type CompleteSetupRequest,type ConfigureSetupHarnessesRequest,type HarnessSettingsState,type RestartHarnessResult,type SetupState,type TestHarnessInstanceRequest,type TestHarnessInstanceResult} from '@agenvyl/contracts';
import {isConfigureConnectorInstancesRequest,isTestConnectorInstanceRequest} from '@agenvyl/connector-contract';
import type {FastifyBaseLogger} from 'fastify';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import type {Database} from '../../infrastructure/database/Database.js';
import type {HttpConnectorClient} from '../../integrations/connector/HttpConnectorClient.js';
import {ConnectorClientError} from '../../integrations/connector/HttpConnectorClient.js';
import {AppError} from '../../shared/errors/AppError.js';
import type {HarnessCatalogService} from '../connector/HarnessCatalogService.js';
import type {RoomWorkspaceService} from '../workspace/RoomWorkspaceService.js';
import {HarnessMetadataCache,unavailableHarnessCache} from '../connector/HarnessMetadataCache.js';
import {isAvailableStarterRoute,selectStarterAgentRoutes,type StarterAgentRoute,type StarterHarnessCatalog} from './starterAgentRoutes.js';
import {pickWorkspaceDirectory} from './workspaceDirectoryPicker.js';

const templates=[
  {handle:'architect',name:'Architect',color:'#3b82f6',prompt:'Analyze the system, contracts, risks, and trade-offs before implementation.'},
  {handle:'builder',name:'Builder',color:'#8b5cf6',prompt:'Turn the agreed plan into concrete, testable implementation.'},
  {handle:'reviewer',name:'Reviewer',color:'#14b8a6',prompt:'Review the result for regressions, unsafe assumptions, and missing verification.'},
] as const;

export class SetupService{
  private readonly discoveryCache:HarnessMetadataCache<Awaited<ReturnType<HttpConnectorClient['discover']>>>;
  private readonly now:()=>number;
  private readonly logger?:Pick<FastifyBaseLogger,'info'|'warn'>;
  private readonly roomWorkspace?:Pick<RoomWorkspaceService,'configureRoots'>;
  private readonly directoryPicker:()=>Promise<string|undefined>;
  constructor(
    private readonly database:Database,
    private readonly connector:HttpConnectorClient,
    private workspaceRoot:string,
    private readonly catalogCache:Pick<HarnessCatalogService,'invalidate'>,
    options:{ttlMs?:number;retryMs?:number;now?:()=>number;logger?:Pick<FastifyBaseLogger,'info'|'warn'>;roomWorkspace?:Pick<RoomWorkspaceService,'configureRoots'>;directoryPicker?:()=>Promise<string|undefined>}={},
  ){
    this.now=options.now??Date.now;
    this.logger=options.logger;
    this.roomWorkspace=options.roomWorkspace;
    this.directoryPicker=options.directoryPicker??(()=>pickWorkspaceDirectory());
    this.discoveryCache=new HarnessMetadataCache({...options,error:{code:'discovery_unavailable',message:'Harness discovery refresh failed'}});
  }
  async state():Promise<SetupState>{
    const[row]=await this.database.sql`SELECT completed_at,locale,first_room_id FROM installation_state WHERE id=true`;
    const [discovery,instances,configuration]=await Promise.all([
      this.discovery().catch(()=>({value:{apiVersion:'v2' as const,candidates:[]},cache:unavailableHarnessCache({code:'discovery_unavailable',message:'Harness discovery is unavailable'})})),
      this.connector.instances().catch(()=>({apiVersion:'v2' as const,connectorEpoch:'',instances:[]})),
      this.connector.configuration().catch(()=>({apiVersion:'v2' as const,instances:[]})),
    ]);
    const runtime=new Map(instances.instances.map(instance=>[instance.id,instance]));
    return{completed:Boolean(row.completed_at),locale:row.locale==='ru'?'ru':'en',workspaceRoot:this.workspaceRoot,...(row.first_room_id?{firstRoomId:String(row.first_room_id)}:{}),instances:configuration.instances.map(instance=>{
      const current=runtime.get(instance.id);
      return{...instance,status:instance.enabled?(current?.status??'unavailable'):'disabled',...(current?.error?{error:current.error}:{})};
    }),candidates:discovery.value.candidates,discoveryCache:discovery.cache};
  }
  async harnessSettings(options:{forceRefresh?:boolean}={}):Promise<HarnessSettingsState>{
    const connectorState=Promise.all([
      this.connector.configuration(),
      this.connector.instances(),
      this.discovery(options.forceRefresh),
    ]).catch(()=>{
      throw new AppError('connector_unavailable',503,'Connector settings are unavailable');
    });
    const[[configuration,runtime,discovery],personaRows]=await Promise.all([
      connectorState,
      this.database.sql`SELECT id,name,handle,harness_instance_id,archived_at FROM personas ORDER BY archived_at NULLS FIRST,name`,
    ]);
    const runtimeById=new Map(runtime.instances.map(instance=>[instance.id,instance]));
    return{connectorEpoch:runtime.connectorEpoch,candidates:discovery.value.candidates,discoveryCache:discovery.cache,instances:configuration.instances.map(instance=>{
      const current=runtimeById.get(instance.id);
      const personas=personaRows.filter(row=>String(row.harness_instance_id)===instance.id).map(row=>({id:String(row.id),name:String(row.name),handle:String(row.handle),archived:Boolean(row.archived_at)}));
      return{...instance,status:instance.enabled?(current?.status??'unavailable'):'disabled',capabilities:current?.capabilities??[],activeExecutions:current?.activeExecutions??0,...(current?.error?{error:current.error}:{}),personas};
    })};
  }
  async restartHarness(instanceId:string):Promise<RestartHarnessResult>{
    try{
      const result=await this.connector.restart(instanceId);
      this.catalogCache.invalidate();
      return{instanceId:result.instance.id,status:result.instance.status,models:result.catalog.models};
    }catch(error){
      if(error instanceof ConnectorClientError&&error.code==='connector_command_rejected')throw new AppError(error.serverCode??'restart_rejected',error.status??409,error.message);
      throw new AppError('connector_unavailable',503,'Managed OpenCode restart failed');
    }
  }
  async configure(input:ConfigureSetupHarnessesRequest){
    if(!isConfigureConnectorInstancesRequest(input))throw new AppError('invalid_setup_harnesses',400,'Harness selection is invalid');
    const current=await this.connector.configuration();
    const nextById=new Map(input.instances.map(instance=>[instance.id,instance]));
    const changed=current.instances.filter(instance=>!nextById.has(instance.id)||nextById.get(instance.id)?.type!==instance.type);
    if(changed.length){
      const ids=changed.map(instance=>instance.id);
      const personas=await this.database.sql`SELECT id,name,handle,harness_instance_id,archived_at FROM personas WHERE harness_instance_id=ANY(${ids}) ORDER BY archived_at NULLS FIRST,name`;
      if(personas.length)throw new AppError('harness_instance_in_use',409,'A harness used by agents cannot be removed or change type',{instances:ids,personas:personas.map(row=>({id:String(row.id),name:String(row.name),handle:String(row.handle),harness_instance_id:String(row.harness_instance_id),archived:Boolean(row.archived_at)}))});
    }
    const configured=await this.connector.configureInstances(input);
    this.catalogCache.invalidate();
    this.discoveryCache.invalidate();
    return configured;
  }
  async testHarness(input:TestHarnessInstanceRequest):Promise<TestHarnessInstanceResult>{
    if(!isTestConnectorInstanceRequest(input))throw new AppError('invalid_harness_instance',400,'Harness instance is invalid');
    try{
      const{apiVersion:_apiVersion,...result}=await this.connector.testInstance(input);
      return result;
    }catch{
      throw new AppError('connector_unavailable',503,'Connector connection testing is unavailable');
    }
  }
  async selectWorkspaceDirectory(){
    try{return{path:await this.directoryPicker()??null};}
    catch{throw new AppError('directory_picker_unavailable',503,'The system folder picker is unavailable');}
  }
  async complete(input:CompleteSetupRequest){
    validate(input);
    const workspaceRoot=path.resolve(input.workspace_root.trim());
    if(!path.isAbsolute(input.workspace_root.trim()))throw new AppError('invalid_workspace_root',400,'Workspace root must be an absolute path');
    const[existingState]=await this.database.sql`SELECT completed_at,first_room_id FROM installation_state WHERE id=true`;
    if(existingState.completed_at)return{roomId:String(existingState.first_room_id)};
    if(workspaceRoot!==path.resolve(this.workspaceRoot)){
      try{
        await mkdir(workspaceRoot,{recursive:true});
        await this.connector.configureWorkspaceRoot(workspaceRoot);
        this.roomWorkspace?.configureRoots(workspaceRoot);
      }
      catch{throw new AppError('invalid_workspace_root',400,'Workspace root could not be configured');}
      this.workspaceRoot=workspaceRoot;
    }
    const starterRoutes=input.route?await this.starterRoutes(input.route):[];
    const now=new Date().toISOString(),roomId=crypto.randomUUID(),explicitRoomTitle=input.room_title?.trim();
    return this.database.transaction(async tx=>{
      const[state]=await tx`SELECT completed_at,first_room_id FROM installation_state WHERE id=true FOR UPDATE`;
      if(state.completed_at)return{roomId:String(state.first_room_id)};
      await tx`UPDATE local_user_profiles SET display_name=${input.profile.display_name.trim()},handle=${input.profile.handle.trim().toLowerCase()},updated_at=${now} WHERE id='local-user'`;
      await tx`INSERT INTO rooms(id,title,title_source,created_at) VALUES(${roomId},${explicitRoomTitle||DEFAULT_ROOM_TITLE},${explicitRoomTitle?'manual':'pending'},${now})`;
      const existing=await tx`SELECT id FROM personas WHERE archived_at IS NULL ORDER BY created_at`;
      if(starterRoutes.length&&!existing.length)for(const[templateIndex,template]of templates.entries()){const id=crypto.randomUUID(),versionId=crypto.randomUUID(),route=starterRoutes[templateIndex]!;
        await tx`INSERT INTO personas(id,handle,name,color,requested_model,effective_model,harness_instance_id,harness_type,model_id,permission_profile_id,agent_variant_id,current_version_id,created_at,updated_at) VALUES(${id},${template.handle},${template.name},${template.color},${route.model_id},NULL,${route.harness_instance_id},${route.harness_type},${route.model_id},${route.permission_profile_id},${route.agent_variant_id},${versionId},${now},${now})`;
        await tx`INSERT INTO persona_versions(id,persona_id,version,requested_model,system_prompt,created_at,harness_instance_id,harness_type,model_id,permission_profile_id,agent_variant_id) VALUES(${versionId},${id},1,${route.model_id},${template.prompt},${now},${route.harness_instance_id},${route.harness_type},${route.model_id},${route.permission_profile_id},${route.agent_variant_id})`;
        await tx`INSERT INTO room_participants(room_id,persona_id) VALUES(${roomId},${id})`;
      }
      else for(const persona of existing)await tx`INSERT INTO room_participants(room_id,persona_id) VALUES(${roomId},${String(persona.id)})`;
      await tx`UPDATE installation_state SET completed_at=${now},locale=${input.locale},workspace_root=${this.workspaceRoot},first_room_id=${roomId},updated_at=${now} WHERE id=true`;
      return{roomId};
    });
  }
  private async starterRoutes(preferred:StarterAgentRoute){
    try{
      const instances=(await this.connector.instances()).instances.filter(instance=>instance.status!=='unavailable');
      const sources=(await Promise.all(instances.map(async instance=>{
        try{return{id:instance.id,type:instance.type,catalog:await this.connector.catalog(instance.id)} satisfies StarterHarnessCatalog;}
        catch{return undefined;}
      }))).filter((source):source is StarterHarnessCatalog=>Boolean(source));
      const preferredSource=sources.find(source=>source.id===preferred.harness_instance_id&&source.type===preferred.harness_type);
      if(!preferredSource||!isAvailableStarterRoute(preferred,preferredSource))throw new Error('route');
      return selectStarterAgentRoutes(preferred,sources,templates.length);
    }catch{throw new AppError('setup_route_unavailable',400,'Selected harness route is unavailable');}
  }
  private discovery(forceRefresh=false){
    return this.discoveryCache.read(async()=>{
      const startedAt=this.now();
      try{
        const value=await this.connector.discover();
        this.logger?.info({durationMs:this.now()-startedAt,candidates:value.candidates.length},'Harness discovery refresh completed');
        return value;
      }catch(error){
        this.logger?.warn({durationMs:this.now()-startedAt,err:error},'Harness discovery refresh failed; stale data will be used when available');
        throw error;
      }
    },forceRefresh);
  }
}

function validate(input:CompleteSetupRequest){
  if(!input||!['en','ru'].includes(input.locale)||!input.workspace_root||!input.profile?.display_name?.trim()||!/^[a-z0-9][a-z0-9_-]*$/.test(input.profile?.handle?.trim().toLowerCase()??'')||(input.route&&(!input.route.harness_instance_id||!input.route.harness_type||!input.route.model_id)))throw new AppError('invalid_setup',400,'Setup details are invalid');
}
