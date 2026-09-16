import { Fragment, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { ArrowUp, FileText, Hammer, LoaderCircle, MessageSquarePlus, RefreshCw, Shield, Slash, Square, X } from 'lucide-react';
import {personaModelName,type HarnessCatalog} from '../../entities/harness';
import type { Persona } from '../../entities/persona';
import type {Message} from '../../entities/message';
import { FakeRoomGateway, type DemoKind, type RoomGateway } from '../../features/room-session';
import { activeComposerCommandQuery, activeMentionQuery, composerCommands, extractComposerCommands, insertComposerCommandAt, insertMentionAt, parseMentions, removeMentionTarget, type ActiveComposerCommandQuery, type ComposerAttachment } from '../../features/send-message';
import { ApiError } from '../../shared/api';
import { Alert, Button, TextArea } from '../../shared/ui';
import {MAX_MESSAGE_TEXT_LENGTH,type RoomPersona,type WorkflowMode} from '@agenvyl/contracts';
import {WorkspaceArtifactActions,type OpenWorkspaceArtifact,type WorkspaceTarget} from '../workspace-window';
import styles from './Composer.module.css';
import {ReasoningEffortChip,roomPersonaModel,roomPersonaReasoning} from '../../features/reasoning-effort';
import {ComposerAddMenu} from './ComposerAddMenu';
import {AUTO_ROUTING_GUIDANCE_ID,AutoRoutingGuidance} from './AutoRoutingGuidance';
import {ConversationRouteControl} from './ConversationRouteControl';
import {PendingFollowUps} from './PendingFollowUps';
import type {ProjectReference,ProjectSummary} from '@agenvyl/contracts';
import {registerProjectReference,serializeProjectReferenceDraft,restoreProjectReferenceDraft} from './projectReferenceDraft';
import {ReferenceEditor,type ReferenceEditorElement} from './ReferenceEditor';
import {useProjectMentions} from './useProjectMentions';

function highlightComposerText(text:string,personas:readonly Persona[]):ReactNode[] {
  const known=new Map(personas.map(persona=>[persona.handle.toLowerCase(),persona]));
  const ranges:Array<{start:number;end:number;className:string;color?:string}>=[];
  for(const match of text.matchAll(/⟦[^⟧]*⟧/g))ranges.push({start:match.index!,end:match.index!+match[0].length,className:styles['known-mention'],color:'#355583'});
  for(const match of text.matchAll(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/giu)){
    const start=(match.index??0)+match[1].length,end=(match.index??0)+match[0].length,handle=match[2].toLowerCase();
    const persona=known.get(handle),color=handle==='all'?'#4f6ef7':persona?.color??'#b45309';
    ranges.push({start,end,className:persona||handle==='all'?styles['known-mention']:styles['unknown-mention'],color});
  }
  const parts:ReactNode[]=[];let cursor=0,index=0;
  for(const range of ranges.sort((a,b)=>a.start-b.start)){
    if(range.start<cursor)continue;
    if(range.start>cursor)parts.push(text.slice(cursor,range.start));
    parts.push(<mark key={`${range.start}-${index++}`} className={range.className} style={range.color?{color:range.color,backgroundColor:/^#[\da-f]{6}$/i.test(range.color)?`${range.color}1a`:undefined}:undefined}>{text.slice(range.start,range.end)}</mark>);
    cursor=range.end;
  }
  if(cursor<text.length)parts.push(text.slice(cursor));
  if(text.endsWith('\n'))parts.push('\u00a0');
  return parts;
}

export type ComposerHandle={insertMention:(handle:string)=>void;insertProjectReference:(reference:ProjectReference)=>void};
export type ComposerInterventionTarget={runId:string;agent:string;mode:'active_redirect'|'post_turn_continuation'|'unavailable'};

export const Composer=forwardRef<ComposerHandle,ComposerProps>(function Composer({
  gateway,
  active,
  personas,
  roomPersonas=personas.map(persona=>({persona,reasoning_effort_override:null})),
  updateParticipantReasoning=async()=>{},
  harnessCatalog,
  catalogReady,
  onSent,
  openWorkspace,
  openArtifact=()=>{},
  roomId,
  attachments,
  attachmentsBusy,
  openAttachmentPicker,
  uploadFiles,
  removeAttachment,
  retryAttachment,
  clearAttachments,
  workflowMode='work',
  updateWorkflowMode=async()=>{},
  interventionTarget,
  exitIntervention=()=>{},
  conversationRoutingMode='auto',
  updateConversationRouting=async()=>{},
  autoRoutingCandidates=[],
  pendingFollowUps=[],
  pendingWorkflowModes={},
  project,
}: ComposerProps,ref) {
  const [text, setText] = useState("");
  const references=useRef(new Map<string,ProjectReference>());
  const beforeFirstReference=useRef('');
  const serializeReferences=(value:string)=>serializeProjectReferenceDraft(references.current,value);
  const restoreReferences=(value:string)=>restoreProjectReferenceDraft(references.current,value);
  const ordinaryDraftRef=useRef('');
  const interventionDraftsRef=useRef(new Map<string,string>());
  const previousInterventionRef=useRef<string|undefined>(undefined);
  const editorRef=useRef<HTMLTextAreaElement|ReferenceEditorElement>(null);
  const mirrorRef=useRef<HTMLDivElement>(null);
  const mentionPopoverRef=useRef<HTMLDivElement>(null);
  const commandPopoverRef=useRef<HTMLDivElement>(null);
  const [mention,setMention]=useState<{start:number;end:number;query:string}>();
  const [mentionIndex,setMentionIndex]=useState(0);
  const [mentionDirectory,setMentionDirectory]=useState<string>();
  const [directoryFilter,setDirectoryFilter]=useState('');
  const browseDirectory=(path:string)=>{setMentionDirectory(path);setDirectoryFilter('');setMentionIndex(0);};
  useLayoutEffect(()=>{if(mentionDirectory!==undefined&&mentionPopoverRef.current){mentionPopoverRef.current.scrollTop=0;mentionPopoverRef.current.querySelector('input')?.focus();}},[mentionDirectory]);
  useEffect(()=>{if(!mention){setMentionDirectory(undefined);setDirectoryFilter('');}},[mention]);
  const [command,setCommand]=useState<ActiveComposerCommandQuery>();
  const [commandIndex,setCommandIndex]=useState(0);
  const [startFresh,setStartFresh]=useState(false);
  const startFreshRef=useRef(false);
  const updateStartFresh=(value:boolean)=>{startFreshRef.current=value;setStartFresh(value)};
  const [composerStatus,setComposerStatus]=useState('');
  const [sending,setSending]=useState(false);
  const [modeSaving,setModeSaving]=useState(false);
  const modeUpdateRef=useRef<Promise<unknown>|undefined>(undefined);
  const [modeError,setModeError]=useState<string>();
  const [sendError,setSendError]=useState<{message:string;messageId:string;text:string;targets:string[];attachmentVersionIds:string[];routing?:import('@agenvyl/contracts').MessageRouting} | undefined>();
  const [profileError,setProfileError]=useState<string>();
  const [interventionError,setInterventionError]=useState<string>();
  const [routeSaving,setRouteSaving]=useState(false);
  const [routeError,setRouteError]=useState<string>();
  const [mobileControls,setMobileControls]=useState(()=>typeof matchMedia==='function'&&matchMedia('(max-width: 767px)').matches);
  const insertMention=(handle:string)=>{
    const editor=editorRef.current,{text:next,caret}=insertMentionAt(text,handle,editor?.selectionStart??text.length,editor?.selectionEnd??text.length);
    if(next.length>MAX_MESSAGE_TEXT_LENGTH)return;
    setText(next);
    setMention(undefined);
    requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(caret,caret)});
  };
  const insertProjectReference=(reference:ProjectReference,range?:{start:number;end:number})=>{
    if(!references.current.size)beforeFirstReference.current=text;
    const token=registerProjectReference(references.current,reference),start=range?.start??editorRef.current?.selectionStart??text.length,end=range?.end??editorRef.current?.selectionEnd??start;
    const next=text.slice(0,start)+token+' '+text.slice(end);if(next.length>MAX_MESSAGE_TEXT_LENGTH)return;
    setText(next);setMention(undefined);
    requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(start+token.length+1,start+token.length+1);});
  };
  useImperativeHandle(ref,()=>({insertMention,insertProjectReference}),[text]);
  const targets = useMemo(
    () => parseMentions(text, personas),
    [text, personas],
  );
  const highlightedText=useMemo(()=>highlightComposerText(text,personas),[text,personas]);
  const byHandle = new Map(personas.map((p) => [p.handle, p]));
  const participantsByHandle=new Map(roomPersonas.map(item=>[item.persona.handle,item]));
  const targetExecutionPreview=targets.map(handle=>{const participant=participantsByHandle.get(handle),persona=participant?.persona??byHandle.get(handle),instance=harnessCatalog?.instances.find(item=>item.id===persona?.harness_instance_id),model=participant?roomPersonaModel(participant,harnessCatalog):instance?.models.find(item=>item.id===persona?.model_id),reasoning=participant?roomPersonaReasoning(participant,model):{effective:model?.defaultReasoningEffort??null,fallback:false},native=instance?.controls.nativeWorkflowModes.includes('plan'),ceiling=workflowMode==='work'&&instance?.type==='antigravity'&&persona?.permission_profile_id==='plan';return{handle,mode:workflowMode==='plan'?(native?'Native Plan':'Instruction-only Plan'):ceiling?'Work · plan-only profile':'Work',effort:reasoning.effective??'Auto',fallback:reasoning.fallback,native};});
  const instructionOnlyTargets=workflowMode==='plan'?targetExecutionPreview.filter(item=>!item.native):[];
  const readyAttachments=attachments.flatMap(item=>item.attachment?[item.attachment]:[]);
  const composerExpanded=Boolean(interventionTarget||text.length||attachments.length||targets.length||startFresh);
  const composerPlaceholder=interventionTarget?`Add an instruction for @${interventionTarget.agent}…`:!catalogReady&&!composerExpanded?'Agent catalog unavailable':project?'Message @agent, @file or @folder…':'Message @handle or @all…';
  const projectMatches=useProjectMentions(project,mention?(mentionDirectory===undefined?mention.query:directoryFilter):undefined,mentionDirectory);
  const agentCandidates=useMemo(()=>mentionDirectory!==undefined?[]:[
    {handle:'all',name:'All agents',detail:'Notify every participant',color:'#4f6ef7'},
    ...personas.map(persona=>({handle:persona.handle,name:persona.name,detail:personaModelName(persona,harnessCatalog),color:persona.color})),
  ].filter(candidate=>!mention||!mention.query||candidate.handle.toLowerCase().includes(mention.query)||candidate.name.toLowerCase().includes(mention.query)||candidate.detail.toLowerCase().includes(mention.query)).slice(0,8),[harnessCatalog,mention,personas,mentionDirectory]);
  const mentionCandidates:Array<{handle:string;name:string;detail:string;color:string;reference?:ProjectReference}>=[...agentCandidates,...(project?projectMatches.entries.map(file=>({handle:`file:${file.path}`,name:file.name,detail:file.path,color:'#e7edf7',reference:{projectId:project.id,projectName:project.name,root:project.path,path:file.path,kind:file.kind}})):[])];
  const commandCandidates=useMemo(()=>composerCommands.filter(candidate=>!command?.query||candidate.name.startsWith(command.query)),[command?.query]);
  useEffect(()=>setMentionIndex(0),[mention?.query]);
  useEffect(()=>{mentionPopoverRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({block:'nearest'});},[mentionIndex]);
  useEffect(()=>setCommandIndex(0),[command?.query]);
  useEffect(()=>{if(typeof matchMedia!=='function')return;const query=matchMedia('(max-width: 767px)'),update=()=>setMobileControls(query.matches);update();query.addEventListener?.('change',update);return()=>query.removeEventListener?.('change',update)},[]);
  useEffect(()=>{references.current.clear();setText('');setMention(undefined);setCommand(undefined);updateStartFresh(false);setComposerStatus('');setSendError(undefined);setProfileError(undefined);setModeError(undefined);setRouteError(undefined)},[roomId]);
  useEffect(()=>{
    const previous=previousInterventionRef.current,next=interventionTarget?.runId;
    if(previous===next)return;
    if(previous)interventionDraftsRef.current.set(previous,text);
    if(next){if(!previous)ordinaryDraftRef.current=text;setText(interventionDraftsRef.current.get(next)??'');}
    else if(previous)setText(ordinaryDraftRef.current);
    previousInterventionRef.current=next;setMention(undefined);setCommand(undefined);setSendError(undefined);setInterventionError(undefined);
    if(next)requestAnimationFrame(()=>editorRef.current?.focus());
  },[interventionTarget?.runId]);
  useEffect(()=>{const editor=editorRef.current;if(!editor)return;editor.style.height='auto';editor.style.height=`${Math.min(Math.max(editor.scrollHeight,composerExpanded?44:56),composerExpanded?168:56)}px`;if(mirrorRef.current){mirrorRef.current.scrollTop=editor.scrollTop;mirrorRef.current.scrollLeft=editor.scrollLeft}},[composerExpanded,text]);
  useLayoutEffect(()=>{if((!mention&&!command)||!matchMedia('(max-width: 767px)').matches)return;const position=()=>{const popover=commandPopoverRef.current??mentionPopoverRef.current,editor=editorRef.current;if(!popover||!editor)return;popover.style.setProperty('--mention-bottom',`${Math.max(0,window.innerHeight-editor.getBoundingClientRect().top)}px`)};position();window.visualViewport?.addEventListener('resize',position);addEventListener('resize',position);return()=>{window.visualViewport?.removeEventListener('resize',position);removeEventListener('resize',position)}},[command,mention,text,targets.length]);
  const updateComposerQueries=(value:string,caret:number)=>{const nextCommand=activeComposerCommandQuery(value,caret);setCommand(nextCommand);setMention(nextCommand?undefined:activeMentionQuery(value,caret));};
  const chooseMention=(handle:string,directoryAction:'browse'|'insert'='browse')=>{if(!mention)return;const reference=mentionCandidates.find(item=>item.handle===handle)?.reference;if(reference){if(reference.kind==='directory'&&directoryAction==='browse')browseDirectory(reference.path);else insertProjectReference(reference,mention);return;}const next=`${text.slice(0,mention.start)}@${handle} ${text.slice(mention.end)}`,caret=mention.start+handle.length+2;setText(next);setMention(undefined);requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(caret,caret)});};
  const chooseCommand=(selected=commandCandidates[commandIndex]??commandCandidates[0])=>{if(!command||!selected)return;const next=insertComposerCommandAt(text,selected,command);setText(next.text);setCommand(undefined);requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(next.caret,next.caret)});};
  const selectWorkflowMode=async(nextMode:WorkflowMode)=>{if(modeSaving||nextMode===workflowMode)return;setModeSaving(true);setModeError(undefined);const update=Promise.resolve().then(()=>updateWorkflowMode(nextMode));modeUpdateRef.current=update;try{await update}catch(error){setModeError(error instanceof Error?error.message:String(error))}finally{if(modeUpdateRef.current===update)modeUpdateRef.current=undefined;setModeSaving(false)}};
  const selectConversationRouting=async(nextMode:import('@agenvyl/contracts').ConversationRoutingMode)=>{if(routeSaving||nextMode===conversationRoutingMode)return;setRouteSaving(true);setRouteError(undefined);try{await updateConversationRouting(nextMode)}catch(error){setRouteError(error instanceof Error?error.message:String(error))}finally{setRouteSaving(false)}};
  const visibleConversationRoutingMode=conversationRoutingMode==='agent_session'?'auto':conversationRoutingMode;
  const ambiguousAutoRouting=visibleConversationRoutingMode==='auto'&&targets.length===0&&autoRoutingCandidates.length>1;
  const showAutoRoutingGuidance=ambiguousAutoRouting&&Boolean(text.trim()||attachments.length);
  useEffect(()=>{if(visibleConversationRoutingMode==='room_context'&&startFresh){updateStartFresh(false);setComposerStatus('Room context already starts a new conversation.')}},[startFresh,visibleConversationRoutingMode]);
  useEffect(()=>{if(conversationRoutingMode==='agent_session')void selectConversationRouting('auto')},[conversationRoutingMode]);
  const workflowModeLabel=workflowMode==='plan'?'Plan':'Work',nextWorkflowMode:WorkflowMode=workflowMode==='plan'?'work':'plan',nextWorkflowModeLabel=nextWorkflowMode==='plan'?'Plan':'Work';
  const workflowModeTitle=workflowMode==='plan'?'Plan mode: project changes are blocked; MCP actions require confirmation. Switch to Work':`Work mode. Switch to ${nextWorkflowModeLabel}`;
  const applyComposerCommands=()=>{
    const extracted=extractComposerCommands(text);
    if(!extracted.commands.some(item=>item.name==='new'))return false;
    setText(extracted.text);setMention(undefined);setCommand(undefined);
    if(visibleConversationRoutingMode==='room_context'){
      updateStartFresh(false);setComposerStatus('Room context already starts a new conversation.');
    }else{
      updateStartFresh(true);setComposerStatus('Start fresh is on for the next message.');
    }
    requestAnimationFrame(()=>{const editor=editorRef.current;editor?.focus();const caret=extracted.text.length;editor?.setSelectionRange(caret,caret)});
    return true;
  };
  const send = async (retry?:typeof sendError) => {
    try{await modeUpdateRef.current}catch{return}
    if(interventionTarget){
      const outgoing=serializeReferences(text.trim());if(!outgoing||sending)return;
      if(outgoing.length>2000){setInterventionError('The instruction and references exceed 2,000 characters. Shorten it or send a regular message.');return;}
      if(interventionTarget.mode==='unavailable'){setInterventionError('This run can no longer accept instructions. Your instruction draft is still here.');return;}
      setSending(true);setInterventionError(undefined);
      try{await gateway.intervene(interventionTarget.runId,outgoing);interventionDraftsRef.current.delete(interventionTarget.runId);previousInterventionRef.current=undefined;setText(ordinaryDraftRef.current);exitIntervention();}
      catch(error){setInterventionError(error instanceof ApiError?`${error.code}: ${error.message}`:error instanceof Error?error.message:String(error));}
      finally{setSending(false);}return;
    }
    const outgoing=retry?.text??serializeReferences(text.trim());
    if(outgoing.length>MAX_MESSAGE_TEXT_LENGTH){setComposerStatus('The message and project references exceed the message size limit. Remove some references or shorten the message.');return;}
    const outgoingTargets=retry?.targets??parseMentions(outgoing,personas), messageId=retry?.messageId??crypto.randomUUID(),attachmentVersionIds=retry?.attachmentVersionIds??attachments.flatMap(item=>item.attachment?[item.attachment.version_id]:[]);
    const outgoingRouting=retry?.routing??(visibleConversationRoutingMode==='room_context'?{mode:'room_context' as const}:{mode:'auto' as const,delivery:startFresh||startFreshRef.current?'new_request' as const:'after_response' as const});
    if ((!outgoing&&!attachmentVersionIds.length) || !catalogReady || sending || (!retry&&attachmentsBusy))return;
    if(outgoingRouting?.mode==='auto'&&!outgoingTargets.length&&autoRoutingCandidates.length>1){editorRef.current?.focus();return;}
    setSending(true);setSendError(undefined);
    let delivered=false;
    try{await gateway.send(outgoing,outgoingTargets,messageId,attachmentVersionIds,outgoingRouting);delivered=true;setText("");setMention(undefined);setCommand(undefined);clearAttachments();updateStartFresh(false);setComposerStatus('');await onSent();}
    catch(error){if(!delivered){setText(restoreReferences(outgoing));setSendError({message:error instanceof ApiError?`${error.code}: ${error.message}`:error instanceof Error?error.message:String(error),messageId,text:outgoing,targets:outgoingTargets,attachmentVersionIds,routing:outgoingRouting});}}
    finally{setSending(false);}
  };
  const handleEditorKeyDown=(e:KeyboardEvent<HTMLElement>)=>{
              if(mention&&e.key==='ArrowRight'&&mentionCandidates[mentionIndex]?.reference?.kind==='directory'){
                e.preventDefault();browseDirectory(mentionCandidates[mentionIndex].reference!.path);
              } else if(mention&&mentionDirectory!==undefined&&e.key==='ArrowLeft'){
                e.preventDefault();browseDirectory(mentionDirectory.split('/').slice(0,-1).join('/'));
              } else if(mention&&project&&!mentionCandidates.length&&(e.key==='Enter'||e.key==='Tab')){
                e.preventDefault();
              } else if(mention&&mentionCandidates.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){
                e.preventDefault();setMentionIndex(index=>(index+(e.key==='ArrowDown'?1:-1)+mentionCandidates.length)%mentionCandidates.length);
              } else if(mention&&mentionCandidates.length&&(e.key==='Enter'||e.key==='Tab')){
                e.preventDefault();chooseMention(mentionCandidates[mentionIndex]?.handle??mentionCandidates[0].handle,'insert');
              } else if(mention&&e.key==='Escape'){
                e.preventDefault();setMention(undefined);
              } else if(command&&commandCandidates.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){
                e.preventDefault();setCommandIndex(index=>(index+(e.key==='ArrowDown'?1:-1)+commandCandidates.length)%commandCandidates.length);
              } else if(command&&commandCandidates.length&&e.key==='Tab'){
                e.preventDefault();chooseCommand();
              } else if(command&&commandCandidates.length&&e.key==='Enter'&&command.query!==commandCandidates[commandIndex]?.name){
                e.preventDefault();chooseCommand();
              } else if(command&&e.key==='Escape'){
                e.preventDefault();setCommand(undefined);
              } else if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){
                e.preventDefault();if(!interventionTarget&&applyComposerCommands())return;void send();
              }
            };
  return (
    <div className={styles.composer} ui-spec-block-id="room_composer">
      {gateway.mode === "fake" && (
        <div className={styles.demo}>
          <span>Demo events · fake</span>
          {(
            [
              "parallel",
              "failure",
              "approval",
              "clarification",
              "reconnect",
            ] as DemoKind[]
          ).map((k) => (
            <Button
              key={k}
              size="sm"
              variant="secondary"
              onClick={() => (gateway as FakeRoomGateway).demo(k)}
            >
              {
                (
                  {
                    parallel: "Parallel",
                    failure: "Failure",
                    approval: "Approval",
                    clarification: "Clarification",
                    reconnect: "Reconnect",
                  } as Record<DemoKind, string>
                )[k]
              }
            </Button>
          ))}
        </div>
      )}
      {active > 0 && <div className={styles['active-runs']}><span><i />{active} {active===1?'agent is responding':'agents are responding'}</span><Button size="sm" variant="danger" onClick={() => void gateway.cancel()}><Square /> Stop all</Button></div>}
      {!interventionTarget&&pendingFollowUps.length>0&&<PendingFollowUps messages={pendingFollowUps} personas={personas} workflowModes={pendingWorkflowModes} onApplyNow={messageId=>gateway.applyQueuedNow(messageId)}/>}
      {modeError&&<Alert className={styles['send-error']} tone="error">Could not change room mode: {modeError}</Alert>}
      {routeError&&<Alert className={styles['send-error']} tone="error">Could not change message route: {routeError}</Alert>}
      {!interventionTarget&&instructionOnlyTargets.length>0&&<Alert className={styles['plan-warning']} tone="warning">Instruction-only for {instructionOnlyTargets.map(item=>`@${item.handle}`).join(', ')}: this mode does not technically block writes to the external project.</Alert>}
      {profileError&&<Alert className={styles['send-error']} tone="error">Could not apply execution settings: {profileError}</Alert>}
      {sendError&&<Alert className={styles['send-error']} tone="error">Failed to send: {sendError.message} <Button size="sm" variant="danger" onClick={()=>void send(sendError)} disabled={sending}>Retry</Button></Alert>}
      {interventionError&&<Alert className={styles['send-error']} tone="error">Unable to add instruction: {interventionError}</Alert>}
      {!interventionTarget&&composerStatus&&<div className={styles['composer-status']} role="status" aria-live="polite">{composerStatus}</div>}
      {autoRoutingCandidates.length>1&&<AutoRoutingGuidance candidates={autoRoutingCandidates} visible={showAutoRoutingGuidance} onMention={insertMention}/>}
      <div className={`${styles['compose-card']} ${composerExpanded?styles['compose-card-expanded']:styles['compose-card-compact']} ${interventionTarget?styles['instruction-card']:''}`}>
        {interventionTarget&&<header className={styles['instruction-header']}><span><MessageSquarePlus aria-hidden="true"/><strong>Add instruction to @{interventionTarget.agent}</strong></span><button type="button" onClick={exitIntervention} aria-label="Exit instruction mode" title="Back to message composer"><X/></button></header>}
        {!interventionTarget&&attachments.length>0&&<div className={styles.attachments}>{attachments.map(item=><span key={item.id} className={[item.status==='error'?styles['attachment-error']:'',item.mimeType.startsWith('image/')&&item.attachment?styles['image-attachment']:''].filter(Boolean).join(' ')}>{item.status==='uploading'?<LoaderCircle className={styles.spinning}/>:item.mimeType.startsWith('image/')&&item.attachment?<img src={item.attachment.preview_url} alt=""/>:<FileText/>}<button type="button" disabled={!item.attachment} onClick={event=>item.attachment&&openArtifact(item.attachment,readyAttachments,event.currentTarget)}>{item.name}</button><small>{item.status==='uploading'?`${item.progress}%`:item.status==='error'?item.error:formatBytes(item.size)}</small>{item.status==='uploading'&&<i style={{width:`${item.progress}%`}}/>}{item.attachment&&<WorkspaceArtifactActions attachment={item.attachment} openWorkspace={openWorkspace}/>} {item.status==='error'&&<button type="button" aria-label={`Retry upload ${item.name}`} onClick={()=>retryAttachment(item.id)}><RefreshCw/></button>}<button type="button" aria-label={`Remove ${item.name}`} onClick={()=>removeAttachment(item.id)}><X/></button></span>)}</div>}
        {!interventionTarget&&startFresh&&<div className={styles['start-fresh-row']}><button type="button" aria-label="Remove Start fresh" onClick={()=>{updateStartFresh(false);setComposerStatus('')}}><Slash aria-hidden="true"/><span>Start fresh</span><X aria-hidden="true"/></button><small>Next message only</small></div>}
        {!interventionTarget&&targets.length>0&&<div className={styles['target-row']}>
          <span>Responders:</span>
          <div className={styles.targets}>
            {targets.map((h) => {
              const p = byHandle.get(h)!;
              const participant=participantsByHandle.get(h);
              return <span className={styles['target-chip']} role="group" aria-label={`Responder ${p.name}`} key={h}><span className={styles['target-identity']}><i style={{ background: p.color }}>{p.name[0]}</i><span>{p.name}</span></span>{participant&&<ReasoningEffortChip appearance="inline" participant={participant} catalog={harnessCatalog} onChange={value=>updateParticipantReasoning(participant.persona.id,value)}/>}<button type="button" className={styles['remove-target']} aria-label={`Remove @${h}`} title={`Remove @${h}`} onClick={() => setText(value=>removeMentionTarget(value,h,personas))}><X /></button></span>;
            })}
          </div>
          <div className={styles['target-preview']}>{targetExecutionPreview.map(item=><small key={item.handle}>@{item.handle}: {item.mode} · {item.effort}{item.fallback?' → fallback':''}</small>)}</div>
        </div>}
        <div className={styles['editor-wrap']}>
          {!interventionTarget&&command&&commandCandidates.length>0&&<div ref={commandPopoverRef} className={styles['mention-popover']} role="listbox" aria-label="Composer commands">
            <header><span>Command</span><small>↑↓ select · Enter insert</small></header>
            {commandCandidates.map((candidate,index)=><button key={candidate.name} type="button" role="option" aria-selected={index===commandIndex} className={index===commandIndex?styles.selected:''} onMouseDown={event=>event.preventDefault()} onClick={()=>chooseCommand(candidate)}>
              <i className={styles['command-icon']}><Slash aria-hidden="true"/></i><span><strong>/{candidate.name}</strong><small>{candidate.description}</small></span><em>{candidate.label}</em>
            </button>)}
          </div>}
          {!interventionTarget&&!command&&mention&&(mentionCandidates.length>0||project)&&<div ref={mentionPopoverRef} className={styles['mention-popover']} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setMention(undefined);requestAnimationFrame(()=>{editorRef.current?.focus();setMention(undefined);});}}} onBlur={()=>setTimeout(()=>{if(!mentionPopoverRef.current?.contains(document.activeElement)&&document.activeElement!==editorRef.current)setMention(undefined);},100)} role="listbox" aria-label={project?'Select an agent, file or folder':'Select an agent to mention'}>
            <header><span>{mentionDirectory===undefined?'Mention':'Project files and folders'}</span><small>{mentionDirectory===undefined?'↑↓ select · Enter insert · → open folder':'↑↓ select · Enter open / insert'}</small></header>
            {project&&mentionDirectory!==undefined&&<div className={styles['directory-navigation']}>
              <nav aria-label="Project folder path"><button type="button" aria-label="Back to parent folder" disabled={!mentionDirectory} onClick={()=>browseDirectory(mentionDirectory.split('/').slice(0,-1).join('/'))}>←</button><button type="button" onClick={()=>browseDirectory('')}>{project.name}</button>{mentionDirectory.split('/').filter(Boolean).map((part,index)=><Fragment key={index}><span>/</span><button type="button" onClick={()=>browseDirectory(mentionDirectory.split('/').slice(0,index+1).join('/'))}>{part}</button></Fragment>)}</nav>
              <input autoFocus aria-label="Search this folder" placeholder="Search this folder" value={directoryFilter} onChange={event=>{setDirectoryFilter(event.target.value);setMentionIndex(0);}} onKeyDown={event=>{
                if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(mentionCandidates.length)setMentionIndex(index=>(index+(event.key==='ArrowDown'?1:-1)+mentionCandidates.length)%mentionCandidates.length);}
                else if(event.key==='Enter'){event.preventDefault();if(mentionCandidates.length)chooseMention(mentionCandidates[mentionIndex]?.handle??mentionCandidates[0].handle);}
                else if(!directoryFilter&&event.key==='ArrowRight'&&mentionCandidates[mentionIndex]?.reference?.kind==='directory'){event.preventDefault();browseDirectory(mentionCandidates[mentionIndex].reference!.path);}
                else if(!directoryFilter&&event.key==='ArrowLeft'){event.preventDefault();browseDirectory(mentionDirectory.split('/').slice(0,-1).join('/'));}
              }}/>
            </div>}
            {mentionCandidates.map((candidate,index)=><Fragment key={candidate.handle}>{project&&(index===0||index===agentCandidates.length)&&<div className={styles['mention-section']} role="presentation">{candidate.reference?`Project · ${project.name}`:'Agents'}</div>}<div className={styles['mention-option-row']}><button type="button" role="option" aria-selected={index===mentionIndex} className={index===mentionIndex?styles.selected:''} onMouseDown={event=>event.preventDefault()} onClick={()=>chooseMention(candidate.handle)}>
              <i style={{background:candidate.color}}>{candidate.reference?candidate.reference.kind==='directory'?'📁':'📄':candidate.name[0]}</i><span><strong>{candidate.name}</strong><small>{candidate.reference?<span>{candidate.detail} · {project?.name}</span>:<><b>@{candidate.handle}</b><span> · {candidate.detail}</span></>}</small></span><em>{candidate.reference?candidate.reference.kind==='directory'?'›':'file':candidate.handle==='all'?'all':'agent'}</em>
            </button>{candidate.reference?.kind==='directory'&&<button type="button" className={styles['add-folder-reference']} aria-label={`Add folder ${candidate.reference.path} to message`} title="Add folder to message" onMouseDown={event=>event.preventDefault()} onClick={()=>insertProjectReference(candidate.reference!,mention)}>+</button>}</div></Fragment>)}
            {project&&mentionDirectory&&<button type="button" className={styles['add-current-folder']} onMouseDown={event=>event.preventDefault()} onClick={()=>insertProjectReference({projectId:project.id,projectName:project.name,root:project.path,path:mentionDirectory,kind:'directory'},mention)}>Add folder {mentionDirectory} to message +</button>}
            {projectMatches.loading&&<small role="status">Searching project…</small>}
            {projectMatches.error&&<small role="alert">{projectMatches.error} <button type="button" onClick={projectMatches.retry}>Retry</button></small>}
            {project&&!projectMatches.loading&&!projectMatches.error&&!projectMatches.entries.length&&<small>{mentionDirectory!==undefined&&!directoryFilter?'Folder is empty':'No matching project files or folders'}</small>}
            {projectMatches.truncated&&<small>{mentionDirectory===undefined?'More results available; type a more specific path.':'Folder listing is limited to 2,000 entries.'}</small>}
          </div>}
          {references.current.size>0?<ReferenceEditor ref={node=>{editorRef.current=node;}} className={styles.editor} value={text} initialValue={beforeFirstReference.current} placeholder={composerPlaceholder} references={references.current} maxLength={interventionTarget?2000:MAX_MESSAGE_TEXT_LENGTH} label={interventionTarget?`Instruction for ${interventionTarget.agent}`:'Message'} describedBy={showAutoRoutingGuidance?AUTO_ROUTING_GUIDANCE_ID:undefined}
            onChange={(value,caret)=>{setMentionDirectory(undefined);setDirectoryFilter('');setText(value);setComposerStatus('');setSendError(undefined);if(!interventionTarget)updateComposerQueries(value,caret);}}
            onSelect={(value,caret)=>{if(!interventionTarget)updateComposerQueries(value,caret);}}
            onBlur={()=>setTimeout(()=>{if(!mentionPopoverRef.current?.contains(document.activeElement)&&document.activeElement!==editorRef.current){setMention(undefined);setCommand(undefined);}},100)}
            onKeyDown={handleEditorKeyDown}
            onPaste={event=>{const encoded=event.clipboardData.getData('application/x-agenvyl-project-references');if(encoded&&event.currentTarget instanceof HTMLTextAreaElement){event.preventDefault();beforeFirstReference.current=text;const pasted=restoreReferences(encoded),start=event.currentTarget.selectionStart,end=event.currentTarget.selectionEnd,next=text.slice(0,start)+pasted+text.slice(end);if(next.length>(interventionTarget?2000:MAX_MESSAGE_TEXT_LENGTH))return;setText(next);requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(start+pasted.length,start+pasted.length);});return;}if(interventionTarget)return;const files=[...event.clipboardData.items].filter(item=>item.kind==='file').flatMap(item=>{const file=item.getAsFile();return file?[file]:[]});if(files.length){event.preventDefault();uploadFiles(files);}}}
          />:<>
          <div ref={mirrorRef} className={styles['editor-mirror']} aria-hidden="true">{highlightedText}</div>
          <TextArea
            className={styles.editor}
            ref={node=>{editorRef.current=node;}}
            value={text}
            rows={1}
            maxLength={interventionTarget?2000:MAX_MESSAGE_TEXT_LENGTH}
            onChange={(e) => {setMentionDirectory(undefined);setDirectoryFilter('');setText(e.target.value);setComposerStatus('');setSendError(undefined);if(!interventionTarget)updateComposerQueries(e.target.value,e.target.selectionStart)}}
            onSelect={(e)=>{if(!interventionTarget)updateComposerQueries(e.currentTarget.value,e.currentTarget.selectionStart)}}
            onBlur={()=>setTimeout(()=>{if(!mentionPopoverRef.current?.contains(document.activeElement)&&document.activeElement!==editorRef.current){setMention(undefined);setCommand(undefined)}},100)}
            onScroll={event=>{if(mirrorRef.current){mirrorRef.current.scrollTop=event.currentTarget.scrollTop;mirrorRef.current.scrollLeft=event.currentTarget.scrollLeft}}}
            onPaste={event=>{const encoded=event.clipboardData.getData('application/x-agenvyl-project-references');if(encoded&&event.currentTarget instanceof HTMLTextAreaElement){event.preventDefault();beforeFirstReference.current=text;const pasted=restoreReferences(encoded),start=event.currentTarget.selectionStart,end=event.currentTarget.selectionEnd,next=text.slice(0,start)+pasted+text.slice(end);if(next.length>(interventionTarget?2000:MAX_MESSAGE_TEXT_LENGTH))return;setText(next);requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(start+pasted.length,start+pasted.length);});return;}if(interventionTarget)return;const files=[...event.clipboardData.items].filter(item=>item.kind==='file').flatMap(item=>{const file=item.getAsFile();return file?[file]:[]});if(files.length){event.preventDefault();uploadFiles(files)}}}
            onKeyDown={handleEditorKeyDown}
            aria-label={interventionTarget?`Instruction for ${interventionTarget.agent}`:'Message'}
            aria-describedby={showAutoRoutingGuidance?AUTO_ROUTING_GUIDANCE_ID:undefined}
            placeholder={composerPlaceholder}
          />
          </>}
        </div>
        <footer className={interventionTarget?styles['instruction-footer']:undefined}>
          {!interventionTarget&&<ComposerAddMenu attachmentDisabled={attachments.length>=10||attachmentsBusy} onAttach={openAttachmentPicker} onReference={project?()=>{setCommand(undefined);setMention({start:editorRef.current?.selectionStart??text.length,end:editorRef.current?.selectionEnd??text.length,query:''});browseDirectory('');}:undefined} onOpenWorkspace={()=>openWorkspace()} routing={mobileControls?{mode:visibleConversationRoutingMode,saving:routeSaving,onModeChange:mode=>void selectConversationRouting(mode)}:undefined}/>}
          <span className={styles['footer-spacer']} aria-hidden="true"/>
          {!interventionTarget&&!mobileControls&&<ConversationRouteControl mode={visibleConversationRoutingMode} saving={routeSaving} onModeChange={mode=>void selectConversationRouting(mode)}/>}
          {!interventionTarget&&<Button
            className={styles['plan-button']}
            size="sm"
            variant="ghost"
            title={workflowModeTitle}
            aria-label={`${workflowModeLabel} mode. Switch to ${nextWorkflowModeLabel}`}
            disabled={modeSaving}
            onClick={()=>void selectWorkflowMode(nextWorkflowMode)}
            icon={modeSaving?<LoaderCircle className={styles.spinning} aria-hidden="true"/>:workflowMode==='plan'?<Shield aria-hidden="true"/>:<Hammer aria-hidden="true"/>}
          >{workflowModeLabel}</Button>}
          <Button
            className={styles.send}
            size="sm"
            variant="primary"
            aria-label={interventionTarget?(sending?'Sending instruction':'Send instruction'):sending?'Sending message':showAutoRoutingGuidance?'Choose a recipient before sending':targets.length?`Send to ${targets.length} ${targets.length===1?'agent':'agents'}`:'Post to room'}
            disabled={interventionTarget?!text.trim()||sending||modeSaving:(!text.trim()&&!attachments.some(item=>item.status==='ready')) || !catalogReady || sending || modeSaving || attachmentsBusy || showAutoRoutingGuidance}
            onClick={()=>void send()}
            title={interventionTarget?'Send instruction':showAutoRoutingGuidance?'Choose a recipient before sending':targets.length?`Send to ${targets.length} ${targets.length===1?'agent':'agents'}`:'Post to room'}
          >
            {interventionTarget?(sending?<><LoaderCircle className={styles.spinning}/><span>Sending…</span></>:<><MessageSquarePlus/><span>Send instruction</span></>):sending?<LoaderCircle className={styles.spinning}/>:<ArrowUp/>}
          </Button>
        </footer>
      </div>
    </div>
  );
});

type ComposerProps={
  project?:ProjectSummary|null;
  gateway: RoomGateway;
  active: number;
  personas: Persona[];
  roomPersonas?:RoomPersona[];
  updateParticipantReasoning?:(personaId:string,value:string|null)=>Promise<unknown>;
  harnessCatalog?:HarnessCatalog;
  catalogReady: boolean;
  onSent:()=>Promise<void>;
  openWorkspace:(target?:WorkspaceTarget)=>void;
  openArtifact?:OpenWorkspaceArtifact;
  roomId:string;
  attachments:ComposerAttachment[];
  attachmentsBusy:boolean;
  openAttachmentPicker:()=>void;
  uploadFiles:(files:File[])=>void;
  removeAttachment:(id:string)=>void;
  retryAttachment:(id:string)=>void;
  clearAttachments:()=>void;
  workflowMode?:WorkflowMode;
  updateWorkflowMode?:(workflowMode:WorkflowMode)=>Promise<unknown>;
  interventionTarget?:ComposerInterventionTarget;
  exitIntervention?:()=>void;
  conversationRoutingMode?:import('@agenvyl/contracts').ConversationRoutingMode;
  updateConversationRouting?:(mode:import('@agenvyl/contracts').ConversationRoutingMode)=>Promise<unknown>;
  autoRoutingCandidates?:string[];
  pendingFollowUps?:Message[];
  pendingWorkflowModes?:Record<string,WorkflowMode>;
};

function formatBytes(value:number){if(value<1024)return`${value} B`;if(value<1024*1024)return`${(value/1024).toFixed(1)} KB`;return`${(value/1024/1024).toFixed(1)} MB`;}
