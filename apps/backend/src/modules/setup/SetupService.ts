import type {CompleteSetupRequest,ConfigureSetupHarnessesRequest,HarnessSettingsState,SetupState} from '@agenvyl/contracts';
import {isConfigureConnectorInstancesRequest} from '@agenvyl/connector-contract';
import type {Database} from '../../infrastructure/database/Database.js';
import type {HttpConnectorClient} from '../../integrations/connector/HttpConnectorClient.js';
import {AppError} from '../../shared/errors/AppError.js';
import {isAvailableStarterRoute,selectStarterAgentRoutes,type StarterAgentRoute,type StarterHarnessCatalog} from './starterAgentRoutes.js';

const templates=[
  {handle:'architect',name:'Architect',role:'Architecture',color:'#3b82f6',prompt:'Analyze the system, contracts, risks, and trade-offs before implementation.'},
  {handle:'builder',name:'Builder',role:'Implementation',color:'#8b5cf6',prompt:'Turn the agreed plan into concrete, testable implementation.'},
  {handle:'reviewer',name:'Reviewer',role:'Review',color:'#14b8a6',prompt:'Review the result for regressions, unsafe assumptions, and missing verification.'},
] as const;

export class SetupService{
  constructor(private readonly database:Database,private readonly connector:HttpConnectorClient,private readonly workspaceRoot:string){}
  async state():Promise<SetupState>{
    const[row]=await this.database.sql`SELECT completed_at,locale,first_room_id FROM installation_state WHERE id=true`;
    const [discovery,instances,configuration]=await Promise.all([this.connector.discover().catch(()=>({apiVersion:'v2' as const,candidates:[]})),this.connector.instances().catch(()=>({apiVersion:'v2' as const,connectorEpoch:'',instances:[]})),this.connector.configuration().catch(()=>({apiVersion:'v2' as const,instances:[]}))]);
    const configured=new Map(configuration.instances.map(instance=>[instance.id,instance]));
    return{completed:Boolean(row.completed_at),locale:row.locale==='ru'?'ru':'en',workspaceRoot:this.workspaceRoot,...(row.first_room_id?{firstRoomId:String(row.first_room_id)}:{}),instances:instances.instances.map(instance=>({id:instance.id,type:instance.type,status:instance.status,...(instance.managed!==undefined?{managed:instance.managed}:{}),...(configured.get(instance.id)?.allowDangerFullAccess!==undefined?{allowDangerFullAccess:configured.get(instance.id)?.allowDangerFullAccess}:{}),...(configured.get(instance.id)?.allowSubscriptionOAuth!==undefined?{allowSubscriptionOAuth:configured.get(instance.id)?.allowSubscriptionOAuth}:{})})),candidates:discovery.candidates};
  }
  async harnessSettings():Promise<HarnessSettingsState>{
    const[configuration,runtime,discovery,personaRows]=await Promise.all([
      this.connector.configuration(),
      this.connector.instances(),
      this.connector.discover(),
      this.database.sql`SELECT id,name,handle,harness_instance_id,archived_at FROM personas ORDER BY archived_at NULLS FIRST,name`,
    ]);
    const runtimeById=new Map(runtime.instances.map(instance=>[instance.id,instance]));
    return{connectorEpoch:runtime.connectorEpoch,candidates:discovery.candidates,instances:configuration.instances.map(instance=>{
      const current=runtimeById.get(instance.id);
      const personas=personaRows.filter(row=>String(row.harness_instance_id)===instance.id).map(row=>({id:String(row.id),name:String(row.name),handle:String(row.handle),archived:Boolean(row.archived_at)}));
      return{...instance,status:instance.enabled?(current?.status??'unavailable'):'disabled',capabilities:current?.capabilities??[],...(current?.error?{error:current.error}:{}),personas};
    })};
  }
  async configure(input:ConfigureSetupHarnessesRequest){
    if(!isConfigureConnectorInstancesRequest(input))throw new AppError('invalid_setup_harnesses',400,'Harness selection is invalid');
    if(input.instances.some(instance=>instance.type==='antigravity'&&instance.enabled&&!instance.permissionMode))throw new AppError('agy_confirmation_required',400,'AGY requires an explicit permission mode');
    const current=await this.connector.configuration();
    const nextById=new Map(input.instances.map(instance=>[instance.id,instance]));
    const changed=current.instances.filter(instance=>!nextById.has(instance.id)||nextById.get(instance.id)?.type!==instance.type);
    if(changed.length){
      const ids=changed.map(instance=>instance.id);
      const personas=await this.database.sql`SELECT id,name,handle,harness_instance_id,archived_at FROM personas WHERE harness_instance_id=ANY(${ids}) ORDER BY archived_at NULLS FIRST,name`;
      if(personas.length)throw new AppError('harness_instance_in_use',409,'A harness used by agents cannot be removed or change type',{instances:ids,personas:personas.map(row=>({id:String(row.id),name:String(row.name),handle:String(row.handle),harness_instance_id:String(row.harness_instance_id),archived:Boolean(row.archived_at)}))});
    }
    const restricted=current.instances.filter(instance=>instance.type==='codex'&&instance.allowDangerFullAccess&&!nextById.get(instance.id)?.allowDangerFullAccess).map(instance=>instance.id);
    if(restricted.length){const personas=await this.database.sql`SELECT id,name,handle,harness_instance_id,permission_profile_id,archived_at FROM personas WHERE harness_instance_id=ANY(${restricted}) AND permission_profile_id='danger-full-access' ORDER BY archived_at NULLS FIRST,name`;if(personas.length)throw new AppError('codex_danger_mode_in_use',409,'Reassign agents using danger-full-access before disabling full access',{instances:restricted,personas:personas.map(row=>({id:String(row.id),name:String(row.name),handle:String(row.handle),permission_profile_id:String(row.permission_profile_id),archived:Boolean(row.archived_at)}))});}
    return this.connector.configureInstances(input);
  }
  async complete(input:CompleteSetupRequest){
    validate(input);
    if(input.workspace_root!==this.workspaceRoot)throw new AppError('invalid_workspace_root',400,'Workspace root does not match this installation');
    const starterRoutes=input.route?await this.starterRoutes(input.route):[];
    const now=new Date().toISOString(),roomId=crypto.randomUUID();
    return this.database.transaction(async tx=>{
      const[state]=await tx`SELECT completed_at,first_room_id FROM installation_state WHERE id=true FOR UPDATE`;
      if(state.completed_at)return{roomId:String(state.first_room_id)};
      await tx`UPDATE local_user_profiles SET display_name=${input.profile.display_name.trim()},handle=${input.profile.handle.trim().toLowerCase()},updated_at=${now} WHERE id='local-user'`;
      await tx`INSERT INTO rooms(id,title,created_at) VALUES(${roomId},${input.room_title.trim()},${now})`;
      const existing=await tx`SELECT id FROM personas WHERE archived_at IS NULL ORDER BY created_at`;
      if(starterRoutes.length&&!existing.length)for(const[templateIndex,template]of templates.entries()){const id=crypto.randomUUID(),versionId=crypto.randomUUID(),route=starterRoutes[templateIndex]!;
        await tx`INSERT INTO personas(id,handle,name,role,color,requested_model,effective_model,harness_instance_id,harness_type,model_id,permission_profile_id,agent_variant_id,current_version_id,created_at,updated_at) VALUES(${id},${template.handle},${template.name},${template.role},${template.color},${route.model_id},NULL,${route.harness_instance_id},${route.harness_type},${route.model_id},${route.permission_profile_id},${route.agent_variant_id},${versionId},${now},${now})`;
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
}

function validate(input:CompleteSetupRequest){
  if(!input||!['en','ru'].includes(input.locale)||!input.workspace_root||!input.profile?.display_name?.trim()||!/^[a-z0-9][a-z0-9_-]*$/.test(input.profile?.handle?.trim().toLowerCase()??'')||!input.room_title?.trim()||(input.route&&(!input.route.harness_instance_id||!input.route.harness_type||!input.route.model_id)))throw new AppError('invalid_setup',400,'Setup details are invalid');
}
