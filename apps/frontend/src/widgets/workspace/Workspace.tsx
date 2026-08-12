import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from 'react-router-dom';
import { Menu, MessageCircle, Paperclip, Plus } from "lucide-react";
import { harnessCatalogRefreshInterval, harnessKeys, harnessesApi, type HarnessCatalog } from '../../entities/harness';
import { fakePersonas, personaKeys, personasApi, type Persona } from "../../entities/persona";
import {personaGroupKeys,personaGroupsApi,type PersonaGroup} from '../../entities/persona-group';
import { applyRoomTitle, roomKeys, roomsApi, useRoomStream, type Room } from "../../entities/room";
import {userProfileApi,userProfileKey,type LocalUserProfile} from '../../entities/user-profile';
import {projectKeys,projectsApi} from '../../entities/project';
import { CreateRoomDialog, RoomAgentManager,RoomProjectDialog } from "../../features/room-dialogs";
import {AttachmentPicker,useRoomAttachments} from '../../features/send-message';
import { FakeRoomGateway, HttpRoomGateway, type RoomGateway } from "../../features/room-session";
import { Button, EmptyState } from "../../shared/ui";
import { applyWorkspaceRequestUpdate, WorkspaceWindow, workspaceRequestForTarget, workspaceRequestFromSearch, workspaceSearchWithRequest, type OpenWorkspaceArtifact, type WorkspaceOpenRequest, type WorkspaceRequestUpdate, type WorkspaceTarget } from '../workspace-window';
import { Composer, type ComposerHandle, type ComposerInterventionTarget } from "../composer";
import { PersonasScreen } from "../personas-screen";
import { RoomHeader } from "../room-header";
import { RunDrawer } from "../run-drawer";
import { Sidebar, useSidebarCollapse } from "../sidebar";
import { Timeline } from "../timeline";
import {DEFAULT_ROOM_TITLE,type RoomPersona} from '@agenvyl/contracts';
import styles from "./Workspace.module.css";
const unknownPersona = (handle: string): Persona => ({
  id: "",
  handle,
  name: `@${handle}`,
  color: "#64748b",
  requested_model: null,
  harness_instance_id:'unknown',harness_type:'unknown',model_id:'unknown',permission_profile_id:null,agent_variant_id:null,
  default_reasoning_effort:null,
  group_id:null,
  archived_at: null,
});
const fakeRooms: Room[] = [{id:'demo-room',title:'WebSocket architecture',created_at:new Date().toISOString(),participant_count:4,last_message_at:null,last_message_text:null,workflow_mode:'work'}];
const fakeModels = [
  { key: "sol", root: "anthropic/claude-sonnet-4", provider: "anthropic" },
  { key: "qwen", root: "qwen/qwen3-coder", provider: "qwen" },
  { key: "gpt", root: "openai/gpt-5", provider: "openai" },
  { key: "deepseek", root: "deepseek/deepseek-r1", provider: "deepseek" },
];
const fakeGroups:PersonaGroup[]=[{id:'fake-coding',name:'Engineering',position:0}];
const fakeCache={state:'fresh' as const,refreshedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+5*60_000).toISOString()};
const fakeHarnessCatalog:HarnessCatalog={connectorEpoch:'fake',cache:fakeCache,instances:[{id:'local-hermes',type:'hermes',status:'healthy',capabilities:['model_catalog','text_streaming','tools','approvals'],models:fakeModels.map(model=>({id:model.key,label:model.root})),controls:{nativeWorkflowModes:[],permissionProfiles:[],agentVariants:[]},catalogCache:{state:'fresh',refreshedAt:fakeCache.refreshedAt}}]};
const fakeUserProfile:LocalUserProfile={id:'local-user',displayName:'User',handle:'user',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};

export function WorkspaceApp({
  view,
  roomId,
  navigateToRoom,
  navigateToPersonas,
  navigateToHarnessSettings,
  navigateToProjects,
  selectedPersonaId,
  navigateToPersona,
}: {
  view: 'chat' | 'personas';
  roomId: string;
  navigateToRoom: (roomId: string, options?: { replace?: boolean }) => void;
  navigateToPersonas: () => void;
  navigateToHarnessSettings?:()=>void;
  navigateToProjects?:()=>void;
  selectedPersonaId?:string;
  navigateToPersona:(id?:string,options?:{replace?:boolean})=>void;
}) {
  const [searchParams,setSearchParams]=useSearchParams();
  const sidebarCollapse=useSidebarCollapse();
  const fake=useMemo(()=>{const query=new URLSearchParams(location.search).get('gateway');return query==='fake'||(query!=='real'&&import.meta.env.VITE_GATEWAY_MODE==='fake')},[]);
  const queryClient=useQueryClient();
  const [demoRooms,setDemoRooms]=useState<Room[]>(fakeRooms);
  const pendingDemoTitles=useRef(new Set<string>());
  const [demoUserProfile,setDemoUserProfile]=useState<LocalUserProfile>(fakeUserProfile);
  const personaNavigationGuardRef=useRef<((label:string,action:()=>void)=>void)|undefined>(undefined);
  const guardedNavigation=(label:string,action:()=>void)=>view==='personas'&&personaNavigationGuardRef.current?personaNavigationGuardRef.current(label,action):action();
  const [demoPersonas,setDemoPersonas]=useState<Persona[]>([...fakePersonas]);
  const timelineQuery=useQuery({queryKey:['rooms',roomId,'timeline'],queryFn:({signal})=>roomsApi.timeline(roomId,{limit:30,signal}),enabled:!fake&&Boolean(roomId),refetchOnMount:'always'});
  const snapshot=timelineQuery.data;
  const gateway=useMemo<RoomGateway>(()=>{const pendingDemoRoom=pendingDemoTitles.current.has(roomId);return fake?new FakeRoomGateway(pendingDemoRoom,pendingDemoRoom?'plan':'work'):new HttpRoomGateway(roomId,snapshot?.lastSequence,snapshot?.runs)},[fake,roomId,snapshot]);
  const {state,prepend} = useRoomStream(gateway,snapshot,fake);
  const [loadingOlder,setLoadingOlder]=useState(false);
  const loadOlder=async()=>{if(fake||loadingOlder||!state.hasMore||!state.nextCursor)return;setLoadingOlder(true);try{prepend(await roomsApi.timeline(roomId,{before:state.nextCursor,limit:30}));}finally{setLoadingOlder(false)}};
  const roomsQuery=useQuery({queryKey:roomKeys.all,queryFn:({signal})=>roomsApi.list(signal),enabled:!fake});
  const trashQuery=useQuery({queryKey:[...roomKeys.all,'trash'],queryFn:({signal})=>roomsApi.trash(signal),enabled:!fake});
  const roomPersonasQuery=useQuery({queryKey:personaKeys.byRoom(roomId),queryFn:({signal})=>roomsApi.participants(roomId,signal),enabled:!fake&&Boolean(roomId)});
  const personaCatalogQuery=useQuery({queryKey:personaKeys.catalog(),queryFn:({signal})=>personasApi.list({includeArchived:true,signal}),enabled:!fake});
  const personaGroupsQuery=useQuery({queryKey:personaGroupKeys.all,queryFn:({signal})=>personaGroupsApi.list(signal),enabled:!fake});
  const harnessCatalogQuery=useQuery({
    queryKey:harnessKeys.catalog,
    queryFn:({signal})=>harnessesApi.catalog(signal),
    enabled:!fake,
    staleTime:5*60_000,
    gcTime:15*60_000,
    refetchOnWindowFocus:false,
    refetchInterval:query=>harnessCatalogRefreshInterval(query.state.data),
  });
  const userProfileQuery=useQuery({queryKey:userProfileKey,queryFn:({signal})=>userProfileApi.get(signal),enabled:!fake});
  const projectsQuery=useQuery({queryKey:projectKeys.all,queryFn:({signal})=>projectsApi.list(signal),enabled:!fake});
  const rooms=fake?demoRooms:roomsQuery.data??[];
  const queriedRoomPersonas:RoomPersona[]=fake?demoPersonas.map(persona=>({persona,reasoning_effort_override:null})):roomPersonasQuery.data??[];
  const roomPersonas=queriedRoomPersonas.map(participant=>state.participantUpdates[participant.persona.id]??participant);
  const personas=roomPersonas.map(participant=>participant.persona);
  const personaCatalog=fake?[...fakePersonas]:personaCatalogQuery.data??[];
  const groups=fake?fakeGroups:personaGroupsQuery.data??[];
  const harnessCatalog=fake?fakeHarnessCatalog:harnessCatalogQuery.data;
  const catalogLoading=!fake&&(roomPersonasQuery.isPending||personaCatalogQuery.isPending||personaGroupsQuery.isPending||harnessCatalogQuery.isPending);
  const catalogFailure=roomPersonasQuery.error??personaCatalogQuery.error??personaGroupsQuery.error??harnessCatalogQuery.error??roomsQuery.error;
  const catalogError=catalogFailure instanceof Error?catalogFailure.message:catalogFailure?String(catalogFailure):undefined;
  const harnessError=harnessCatalogQuery.error instanceof Error?harnessCatalogQuery.error.message:harnessCatalogQuery.error?String(harnessCatalogQuery.error):undefined;
  const [menu, setMenu] = useState(false),
    [creatingRoom,setCreatingRoom]=useState(false),
    [managingAgents,setManagingAgents]=useState(false),
    [projectRoom,setProjectRoom]=useState<Room>(),
    [refreshingHarness,setRefreshingHarness]=useState(false),
    [refreshHarnessError,setRefreshHarnessError]=useState<string>(),
    [selected, setSelected] = useState<string>();
  const [instructionRunId,setInstructionRunId]=useState<string>();
  const attachments=useRoomAttachments(roomId);
  const [attachmentPicker,setAttachmentPicker]=useState(false);
  const [workspaceTransient,setWorkspaceTransient]=useState<WorkspaceOpenRequest>();
  const urlWorkspaceRequest=useMemo(()=>workspaceRequestFromSearch(searchParams),[searchParams]);
  const workspaceRequest=useMemo<WorkspaceOpenRequest|undefined>(()=>urlWorkspaceRequest?{
    ...urlWorkspaceRequest,
    ...workspaceTransient,
    target:{...workspaceTransient?.target,...urlWorkspaceRequest.target},
    mode:urlWorkspaceRequest.mode??workspaceTransient?.mode,
    section:urlWorkspaceRequest.section??workspaceTransient?.section,
    buildRunId:urlWorkspaceRequest.buildRunId??workspaceTransient?.buildRunId,
    treeVisible:urlWorkspaceRequest.treeVisible,
  }:undefined,[urlWorkspaceRequest,workspaceTransient]);
  const composerRef=useRef<ComposerHandle>(null);
  const mentionPersona=useCallback((handle:string)=>composerRef.current?.insertMention(handle),[]);
  const [draggingFiles,setDraggingFiles]=useState(false);
  const dragDepth=useRef(0);
  const invalidateRooms=()=>queryClient.invalidateQueries({queryKey:roomKeys.all});
  const invalidatePersonas=()=>queryClient.invalidateQueries({queryKey:personaKeys.all});
  const invalidateGroups=()=>queryClient.invalidateQueries({queryKey:personaGroupKeys.all});
  const refreshHarnessCatalog=async()=>{
    if(fake)return;
    setRefreshingHarness(true);setRefreshHarnessError(undefined);
    try{
      const next=await harnessesApi.catalog(undefined,true);
      queryClient.setQueryData(harnessKeys.catalog,next);
    }catch(issue){
      setRefreshHarnessError(issue instanceof Error?issue.message:String(issue));
    }finally{setRefreshingHarness(false);}
  };
  useEffect(()=>{if(!fake&&view==='chat'&&roomsQuery.data?.length&&!roomsQuery.data.some(room=>room.id===roomId))navigateToRoom(roomsQuery.data[0].id,{replace:true})},[fake,view,roomId,roomsQuery.data,navigateToRoom]);
  useEffect(()=>{setAttachmentPicker(false);setDraggingFiles(false);setInstructionRunId(undefined);dragDepth.current=0},[roomId]);
  useEffect(() => () => gateway.dispose(), [gateway]);
  const createRoomMutation=useMutation({mutationFn:({personaIds,projectId}:{personaIds:string[];projectId:string|null})=>roomsApi.create(personaIds,projectId),onSuccess:()=>invalidateRooms()});
  const assignProjectMutation=useMutation({mutationFn:({id,projectId}:{id:string;projectId:string|null})=>roomsApi.assignProject(id,projectId),onSuccess:()=>invalidateRooms()});
  const renameRoomMutation=useMutation({mutationFn:({id,title}:{id:string;title:string})=>roomsApi.rename(id,title),onSuccess:()=>invalidateRooms()});
  const deleteRoomMutation=useMutation({mutationFn:(id:string)=>roomsApi.remove(id),onSuccess:()=>invalidateRooms()});
  const restoreRoomMutation=useMutation({mutationFn:(id:string)=>roomsApi.restore(id),onSuccess:()=>invalidateRooms()});
  const purgeRoomMutation=useMutation({mutationFn:(id:string)=>roomsApi.purge(id),onSuccess:()=>invalidateRooms()});
  const userProfileMutation=useMutation({mutationFn:userProfileApi.update,onSuccess:profile=>queryClient.setQueryData(userProfileKey,profile)});
  const createRoom=async(personaIds:string[],projectId:string|null)=>{if(fake){const id=crypto.randomUUID();pendingDemoTitles.current.add(id);setDemoRooms(current=>[{id,title:DEFAULT_ROOM_TITLE,created_at:new Date().toISOString(),participant_count:personaIds.length,last_message_at:null,last_message_text:null,project:null,workflow_mode:'plan'},...current]);setDemoPersonas([...fakePersonas].filter(persona=>personaIds.includes(persona.id)));navigateToRoom(id);return}const room=await createRoomMutation.mutateAsync({personaIds,projectId});navigateToRoom(room.id);};
  const renameRoom=async(room:Room,title:string)=>{if(fake){pendingDemoTitles.current.delete(room.id);setDemoRooms(current=>current.map(item=>item.id===room.id?{...item,title}:item));return}await renameRoomMutation.mutateAsync({id:room.id,title});};
  const saveRoomAgents=async(next:Set<string>)=>{if(fake){setDemoPersonas([...fakePersonas].filter(persona=>next.has(persona.id)));setDemoRooms(current=>current.map(room=>room.id===roomId?{...room,participant_count:next.size}:room));return}const current=new Set(personas.map(persona=>persona.id));await Promise.all([...next].filter(id=>!current.has(id)).map(id=>roomsApi.addParticipant(roomId,id)).concat([...current].filter(id=>!next.has(id)).map(id=>roomsApi.removeParticipant(roomId,id))));await Promise.all([invalidatePersonas(),invalidateRooms()]);};
  const updateParticipantReasoning=async(personaId:string,value:string|null)=>{if(fake)return;const updated=await roomsApi.updateParticipant(roomId,personaId,{reasoning_effort_override:value});queryClient.setQueryData<RoomPersona[]>(personaKeys.byRoom(roomId),current=>current?.map(item=>item.persona.id===personaId?updated:item)??[updated]);};
  const updateWorkflowMode=async(workflowMode:import('@agenvyl/contracts').WorkflowMode)=>{if(fake){if(gateway instanceof FakeRoomGateway)gateway.setWorkflowMode(workflowMode);setDemoRooms(current=>current.map(room=>room.id===roomId?{...room,workflow_mode:workflowMode}:room));return}await roomsApi.updateWorkflowMode(roomId,workflowMode);queryClient.setQueryData<Room[]>(roomKeys.all,current=>current?.map(room=>room.id===roomId?{...room,workflow_mode:workflowMode}:room));};
  const deleteRoom=async(room:Room)=>{if(fake)return;await deleteRoomMutation.mutateAsync(room.id);const next=rooms.filter(item=>item.id!==room.id);if(room.id===roomId&&next[0])navigateToRoom(next[0].id,{replace:true});};
  const active = Object.values(state.runs).filter((r) =>
    [
      "queued",
      "streaming",
      "finalizing",
      "stopping",
      "waiting_approval",
      "waiting_clarification",
    ].includes(r.status),
  ).length;
  const selectedRun = selected ? state.runs[selected] : undefined;
  const instructionRun=instructionRunId?state.runs[instructionRunId]:undefined;
  const interventionTarget:ComposerInterventionTarget|undefined=instructionRun?{runId:instructionRun.id,agent:instructionRun.agent,active:instructionRun.status==='streaming'&&!(instructionRun.requests??[]).some(request=>!request.resolved)&&!instructionRun.interventions.some(intervention=>intervention.status==='pending')}:undefined;
  const selectedPersona = selectedRun
    ? (personaCatalog.find((p) => p.handle === selectedRun.agent) ??
      unknownPersona(selectedRun.agent))
    : undefined;
  const openPersonas = () => {
    setMenu(false);
    guardedNavigation('the agent catalog',navigateToPersonas);
  };
  const currentRoom=rooms.find(room=>room.id===roomId);
  const pushWorkspace=useCallback((request:WorkspaceOpenRequest)=>{
    setWorkspaceTransient(request);
    setSearchParams(workspaceSearchWithRequest(searchParams,request),{replace:false});
  },[searchParams,setSearchParams]);
  const openWorkspace=useCallback((target?:WorkspaceTarget)=>pushWorkspace(workspaceRequestForTarget(target)),[pushWorkspace]);
  const openArtifact=useCallback<OpenWorkspaceArtifact>((attachment,gallery,opener,options)=>{
    const candidates=gallery?.some(item=>item.version_id===attachment.version_id)?gallery:[attachment,...(gallery??[])];
    pushWorkspace({
      origin:'artifact',
      target:{entryId:attachment.entry_id,versionId:attachment.version_id,path:attachment.path},
      treeVisible:false,
      gallery:candidates,
      opener,
      followCurrent:false,
      ...options,
    });
  },[pushWorkspace]);
  const updateWorkspaceRequest=useCallback((update:WorkspaceRequestUpdate)=>{
    if(!workspaceRequest)return;
    const next=applyWorkspaceRequestUpdate(workspaceRequest,update);
    setWorkspaceTransient(next);
    setSearchParams(workspaceSearchWithRequest(searchParams,next),{replace:true});
  },[searchParams,setSearchParams,workspaceRequest]);
  const closeWorkspace=useCallback(()=>setSearchParams(workspaceSearchWithRequest(searchParams),{replace:true}),[searchParams,setSearchParams]);
  useEffect(()=>{if(!urlWorkspaceRequest)setWorkspaceTransient(undefined)},[urlWorkspaceRequest]);
  useEffect(()=>{if(!state.latestTitle)return;if(fake){pendingDemoTitles.current.delete(roomId);setDemoRooms(current=>applyRoomTitle(current,roomId,state.latestTitle!)??current);return}queryClient.setQueryData<Room[]>(roomKeys.all,current=>applyRoomTitle(current,roomId,state.latestTitle!));},[fake,queryClient,roomId,state.latestTitle]);
  useEffect(()=>{if(!selected)return;const closeDrawer=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelected(undefined)};addEventListener('keydown',closeDrawer);return()=>removeEventListener('keydown',closeDrawer)},[selected]);
  useEffect(()=>{if(workspaceRequest&&!fake)void queryClient.invalidateQueries({queryKey:['rooms',roomId,'workspace']})},[workspaceRequest,state.lastSequence,roomId,fake,queryClient]);
  return (
    <>
      <Sidebar
        open={menu}
        close={() => setMenu(false)}
        collapsed={sidebarCollapse.collapsed}
        toggleCollapsed={sidebarCollapse.toggle}
        view={view}
        openPersonas={openPersonas}
        openHarnessSettings={navigateToHarnessSettings}
        openProjects={navigateToProjects}
        configureRoomProject={setProjectRoom}
        rooms={rooms}
        selectedRoomId={roomId}
        selectRoom={id=>guardedNavigation(`room “${rooms.find(room=>room.id===id)?.title??id}”`,()=>navigateToRoom(id))}
        createRoom={()=>guardedNavigation('creating a room',()=>setCreatingRoom(true))}
        renameRoom={renameRoom}
        deleteRoom={deleteRoom}
        deletedRooms={trashQuery.data??[]}
        restoreRoom={async room=>{await restoreRoomMutation.mutateAsync(room.id)}}
        purgeRoom={async room=>{await purgeRoomMutation.mutateAsync(room.id)}}
        userProfile={fake?demoUserProfile:userProfileQuery.data}
        userProfileLoading={!fake&&userProfileQuery.isPending}
        userProfileError={!fake&&userProfileQuery.error instanceof Error?userProfileQuery.error.message:undefined}
        saveUserProfile={async input=>{if(fake){const updated={...demoUserProfile,displayName:input.display_name.trim(),handle:input.handle.trim().replace(/^@/,'').toLowerCase(),updatedAt:new Date().toISOString()};setDemoUserProfile(updated);return updated}return userProfileMutation.mutateAsync(input)}}
      />
      {menu && (
        <button
          className={styles.overlay}
          aria-label="Close menu"
          onClick={() => setMenu(false)}
        />
      )}
      <div className={`${styles.workspaceMain} ${sidebarCollapse.collapsed ? styles.sidebarCollapsed : ''}`} onDragEnter={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();dragDepth.current+=1;setDraggingFiles(true)}}} onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault()}} onDragLeave={event=>{if(!event.dataTransfer.types.includes('Files'))return;dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDraggingFiles(false)}} onDrop={event=>{if(!event.dataTransfer.files.length)return;event.preventDefault();dragDepth.current=0;setDraggingFiles(false);void attachments.uploadFiles([...event.dataTransfer.files])}}>
        {draggingFiles&&view==='chat'&&<div className={styles.dropzone}><Paperclip/><strong>Drop files to attach them</strong><span>They will be uploaded to the workspace Inbox</span></div>}
        {view==='chat'?(currentRoom?<>
          <RoomHeader
            title={currentRoom?.title??"Room"}
            project={currentRoom.project}
            personas={personas}
            active={active}
            connection={state.connection}
            openMenu={() => setMenu(true)}
            openArtifacts={() => openWorkspace()}
            manageAgents={() => setManagingAgents(true)}
          />
          <Timeline roomId={roomId} state={state} personas={personaCatalog} harnessCatalog={harnessCatalog} select={setSelected} gateway={gateway} loadOlder={loadOlder} loadingOlder={loadingOlder} initialLoading={!fake&&timelineQuery.isPending} onMentionPersona={mentionPersona} openWorkspace={openWorkspace} openArtifact={openArtifact} addInstructionToRun={setInstructionRunId}/>
          <Composer ref={composerRef} gateway={gateway} active={active} personas={personas} roomPersonas={roomPersonas} updateParticipantReasoning={updateParticipantReasoning} harnessCatalog={harnessCatalog} catalogReady={gateway.mode === "fake" || (!catalogLoading && !catalogError)} onSent={async()=>{await invalidateRooms()}} openWorkspace={openWorkspace} openArtifact={openArtifact} roomId={roomId} attachments={attachments.items} attachmentsBusy={attachments.busy} openAttachmentPicker={()=>setAttachmentPicker(true)} uploadFiles={files=>void attachments.uploadFiles(files)} removeAttachment={attachments.remove} retryAttachment={attachments.retry} clearAttachments={attachments.clear} workflowMode={state.workflowMode} updateWorkflowMode={updateWorkflowMode} interventionTarget={interventionTarget} exitIntervention={()=>setInstructionRunId(undefined)}/>
        </>:<div className={styles['empty-chat']}><div className={styles['empty-mobile-header']}><button type="button" aria-label="Open menu" onClick={()=>setMenu(true)}><Menu /></button><strong>agenvyl</strong></div><EmptyState icon={<MessageCircle />} title="No rooms" description="Create a room to start a conversation with agents." action={<Button variant="primary" icon={<Plus />} onClick={()=>setCreatingRoom(true)}>Create room</Button>} /></div>):<PersonasScreen
          personas={personaCatalog}
          harnessCatalog={harnessCatalog}
          harnessError={refreshHarnessError??harnessError}
          harnessRefreshing={refreshingHarness||harnessCatalog?.cache.state==='refreshing'}
          onRefreshHarness={refreshHarnessCatalog}
          groups={groups}
          loading={catalogLoading}
          error={catalogError}
          real={gateway.mode === "real"}
          roomId={roomId}
          roomPersonaIds={new Set(personas.map(persona=>persona.id))}
          onChanged={async()=>{await Promise.all([invalidatePersonas(),invalidateGroups(),invalidateRooms()])}}
          selectedPersonaId={selectedPersonaId}
          onSelectPersona={navigateToPersona}
          openMenu={()=>setMenu(true)}
          registerNavigationGuard={guard=>{personaNavigationGuardRef.current=guard}}
        />}
      </div>
      {selectedRun&&<button className="drawer-overlay" aria-label="Close panel" onClick={()=>setSelected(undefined)}/>}
      <RunDrawer
        run={selectedRun}
        persona={selectedPersona}
        harnessCatalog={harnessCatalog}
        close={() => setSelected(undefined)}
      />
      <WorkspaceWindow request={workspaceRequest} roomId={roomId} fake={fake} onAttach={attachment=>attachments.addExisting([attachment])} onClose={closeWorkspace} onRequestChange={updateWorkspaceRequest}/>
      <AttachmentPicker open={attachmentPicker} roomId={roomId} selected={attachments.ready} onClose={()=>setAttachmentPicker(false)} onConfirm={attachments.replaceReady} onUpload={files=>void attachments.uploadFiles(files)}/>
      {creatingRoom&&<CreateRoomDialog personas={personaCatalog.filter(persona=>!persona.archived_at)} catalog={harnessCatalog} groups={groups} projects={projectsQuery.data??[]} onClose={()=>setCreatingRoom(false)} onCreated={createRoom}/>}
      {managingAgents&&currentRoom&&<RoomAgentManager personas={personaCatalog.filter(persona=>!persona.archived_at)} catalog={harnessCatalog} groups={groups} roomPersonas={roomPersonas} onUpdateReasoning={updateParticipantReasoning} onClose={()=>setManagingAgents(false)} onSave={saveRoomAgents}/>}
      {projectRoom&&<RoomProjectDialog room={projectRoom} projects={projectsQuery.data??[]} onClose={()=>setProjectRoom(undefined)} onSave={async projectId=>{await assignProjectMutation.mutateAsync({id:projectRoom.id,projectId})}}/>}
    </>
  );
}
