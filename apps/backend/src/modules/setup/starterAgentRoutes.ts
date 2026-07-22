import type {CompleteSetupRequest} from '@agenvyl/contracts';
import type {ConnectorCatalog,ConnectorCatalogModel} from '@agenvyl/connector-contract';

export type StarterAgentRoute=NonNullable<CompleteSetupRequest['route']>;

export type StarterHarnessCatalog={
  id:string;
  type:string;
  catalog:ConnectorCatalog;
};

export const isAvailableStarterRoute=(route:StarterAgentRoute,source:StarterHarnessCatalog)=>{
  if(source.id!==route.harness_instance_id||source.type!==route.harness_type)return false;
  const model=source.catalog.models.find(candidate=>candidate.id===route.model_id);
  if(!model)return false;
  return(!route.permission_profile_id||source.catalog.controls.permissionProfiles.some(item=>item.id===route.permission_profile_id))&&(!route.agent_variant_id||source.catalog.controls.agentVariants.some(item=>item.id===route.agent_variant_id));
};

export const selectStarterAgentRoutes=(preferred:StarterAgentRoute,sources:StarterHarnessCatalog[],count:number)=>{
  const candidates=sources.flatMap(source=>source.catalog.models.map(model=>routeFor(source,model)));
  const available=uniqueRoutes([preferred,...candidates]);
  const selected:StarterAgentRoute[]=[preferred];
  const usedHarnessTypes=new Set([preferred.harness_type]);
  const usedModels=new Set([preferred.model_id]);

  takeMatching(available,selected,count,route=>!usedHarnessTypes.has(route.harness_type),route=>usedHarnessTypes.add(route.harness_type));
  takeMatching(available,selected,count,route=>!usedModels.has(route.model_id),route=>usedModels.add(route.model_id));
  takeMatching(available,selected,count,()=>true);
  for(let index=0;selected.length<count;index++)selected.push(selected[index%selected.length]!);
  return selected;
};

const routeFor=(source:StarterHarnessCatalog,model:ConnectorCatalogModel):StarterAgentRoute=>({
  harness_instance_id:source.id,
  harness_type:source.type,
  model_id:model.id,
  permission_profile_id:source.catalog.controls.permissionProfiles[0]?.id??null,
  agent_variant_id:source.catalog.controls.agentVariants[0]?.id??null,
});

const takeMatching=(candidates:StarterAgentRoute[],selected:StarterAgentRoute[],count:number,predicate:(route:StarterAgentRoute)=>boolean,onTake?:(route:StarterAgentRoute)=>void)=>{
  for(const route of candidates){
    if(selected.length>=count)return;
    if(selected.some(item=>routeKey(item)===routeKey(route))||!predicate(route))continue;
    selected.push(route);
    onTake?.(route);
  }
};

const uniqueRoutes=(routes:StarterAgentRoute[])=>[...new Map(routes.map(route=>[routeKey(route),route])).values()];
const routeKey=(route:StarterAgentRoute)=>`${route.harness_instance_id}\0${route.model_id}\0${route.permission_profile_id??''}\0${route.agent_variant_id??''}`;
