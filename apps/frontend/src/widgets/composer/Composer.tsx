import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, FileText, LoaderCircle, MessageSquarePlus, RefreshCw, Shield, Square, X } from 'lucide-react';
import {personaModelName,type HarnessCatalog} from '../../entities/harness';
import type { Persona } from '../../entities/persona';
import { FakeRoomGateway, type DemoKind, type RoomGateway } from '../../features/room-session';
import { activeMentionQuery, insertMentionAt, parseMentions, removeMentionTarget, type ComposerAttachment } from '../../features/send-message';
import { ApiError } from '../../shared/api';
import { Alert, Button, TextArea } from '../../shared/ui';
import type {RoomPersona,WorkflowMode} from '@agenvyl/contracts';
import {WorkspaceArtifactActions,type OpenWorkspaceArtifact,type WorkspaceTarget} from '../workspace-window';
import styles from './Composer.module.css';
import {ReasoningEffortChip,roomPersonaModel,roomPersonaReasoning} from '../../features/reasoning-effort';
import {ComposerAddMenu} from './ComposerAddMenu';

function highlightMentions(text:string,personas:readonly Persona[]):ReactNode[] {
  const known=new Map(personas.map(persona=>[persona.handle.toLowerCase(),persona]));
  const parts:ReactNode[]=[];let cursor=0,index=0;
  for(const match of text.matchAll(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/giu)){
    const start=(match.index??0)+match[1].length,end=(match.index??0)+match[0].length,handle=match[2].toLowerCase();
    if(start>cursor)parts.push(text.slice(cursor,start));
    const persona=known.get(handle),color=handle==='all'?'#4f6ef7':persona?.color??'#b45309';
    parts.push(<mark key={`${start}-${index++}`} className={persona||handle==='all'?styles['known-mention']:styles['unknown-mention']} style={{color,backgroundColor:/^#[\da-f]{6}$/i.test(color)?`${color}1a`:undefined}}>{text.slice(start,end)}</mark>);
    cursor=end;
  }
  if(cursor<text.length)parts.push(text.slice(cursor));
  if(text.endsWith('\n'))parts.push('\u00a0');
  return parts;
}

export type ComposerHandle={insertMention:(handle:string)=>void};
export type ComposerInterventionTarget={runId:string;agent:string;active:boolean};

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
}: ComposerProps,ref) {
  const [text, setText] = useState("");
  const ordinaryDraftRef=useRef('');
  const interventionDraftsRef=useRef(new Map<string,string>());
  const previousInterventionRef=useRef<string|undefined>(undefined);
  const editorRef=useRef<HTMLTextAreaElement>(null);
  const mirrorRef=useRef<HTMLDivElement>(null);
  const mentionPopoverRef=useRef<HTMLDivElement>(null);
  const [mention,setMention]=useState<{start:number;end:number;query:string}>();
  const [mentionIndex,setMentionIndex]=useState(0);
  const [sending,setSending]=useState(false);
  const [modeSaving,setModeSaving]=useState(false);
  const [modeError,setModeError]=useState<string>();
  const [sendError,setSendError]=useState<{message:string;messageId:string;text:string;targets:string[];attachmentVersionIds:string[]} | undefined>();
  const [profileError,setProfileError]=useState<string>();
  const [interventionError,setInterventionError]=useState<string>();
  useImperativeHandle(ref,()=>({insertMention:(handle:string)=>{const editor=editorRef.current,{text:next,caret}=insertMentionAt(text,handle,editor?.selectionStart??text.length,editor?.selectionEnd??text.length);if(next.length>4000)return;setText(next);setMention(undefined);requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(caret,caret)});}}),[text]);
  const targets = useMemo(
    () => parseMentions(text, personas),
    [text, personas],
  );
  const highlightedText=useMemo(()=>highlightMentions(text,personas),[text,personas]);
  const byHandle = new Map(personas.map((p) => [p.handle, p]));
  const participantsByHandle=new Map(roomPersonas.map(item=>[item.persona.handle,item]));
  const targetExecutionPreview=targets.map(handle=>{const participant=participantsByHandle.get(handle),persona=participant?.persona??byHandle.get(handle),instance=harnessCatalog?.instances.find(item=>item.id===persona?.harness_instance_id),model=participant?roomPersonaModel(participant,harnessCatalog):instance?.models.find(item=>item.id===persona?.model_id),reasoning=participant?roomPersonaReasoning(participant,model):{effective:model?.defaultReasoningEffort??null,fallback:false},native=instance?.controls.nativeWorkflowModes.includes('plan'),ceiling=workflowMode==='work'&&instance?.type==='antigravity'&&persona?.permission_profile_id==='plan';return{handle,mode:workflowMode==='plan'?(native?'Native Plan':'Instruction-only Plan'):ceiling?'Work · plan-only profile':'Work',effort:reasoning.effective??'Auto',fallback:reasoning.fallback,native};});
  const instructionOnlyTargets=workflowMode==='plan'?targetExecutionPreview.filter(item=>!item.native):[];
  const readyAttachments=attachments.flatMap(item=>item.attachment?[item.attachment]:[]);
  const hasReadyAttachment=attachments.some(item=>item.status==='ready');
  const composerExpanded=Boolean(interventionTarget||text.length||attachments.length||targets.length);
  const hasOutgoingContent=Boolean(text.trim()||(!interventionTarget&&hasReadyAttachment));
  const composerStatus=interventionTarget
    ? `${text.length} / 2000`
    : !catalogReady
    ? composerExpanded?'Agent catalog unavailable':''
    : hasOutgoingContent&&!targets.length
      ? `Posts to room — no agents invoked${text.length>=3600?` · ${text.length} / 4000`:''}`
      : text.length>=3600
        ? `${text.length} / 4000`
        : '';
  const composerPlaceholder=interventionTarget?`Add an instruction for @${interventionTarget.agent}…`:!catalogReady&&!composerExpanded?'Agent catalog unavailable':'Message @handle or @all…';
  const mentionCandidates=useMemo(()=>[
    {handle:'all',name:'All agents',detail:'Notify every participant',color:'#4f6ef7'},
    ...personas.map(persona=>({handle:persona.handle,name:persona.name,detail:personaModelName(persona,harnessCatalog),color:persona.color})),
  ].filter(candidate=>!mention||!mention.query||candidate.handle.toLowerCase().includes(mention.query)||candidate.name.toLowerCase().includes(mention.query)||candidate.detail.toLowerCase().includes(mention.query)).slice(0,8),[harnessCatalog,mention,personas]);
  useEffect(()=>setMentionIndex(0),[mention?.query]);
  useEffect(()=>{setText('');setMention(undefined);setSendError(undefined);setProfileError(undefined);setModeError(undefined)},[roomId]);
  useEffect(()=>{
    const previous=previousInterventionRef.current,next=interventionTarget?.runId;
    if(previous===next)return;
    if(previous)interventionDraftsRef.current.set(previous,text);
    if(next){if(!previous)ordinaryDraftRef.current=text;setText(interventionDraftsRef.current.get(next)??'');}
    else if(previous)setText(ordinaryDraftRef.current);
    previousInterventionRef.current=next;setMention(undefined);setSendError(undefined);setInterventionError(undefined);
    if(next)requestAnimationFrame(()=>editorRef.current?.focus());
  },[interventionTarget?.runId]);
  useEffect(()=>{const editor=editorRef.current;if(!editor)return;editor.style.height='auto';editor.style.height=`${Math.min(Math.max(editor.scrollHeight,composerExpanded?44:56),composerExpanded?168:56)}px`;if(mirrorRef.current){mirrorRef.current.scrollTop=editor.scrollTop;mirrorRef.current.scrollLeft=editor.scrollLeft}},[composerExpanded,text]);
  useLayoutEffect(()=>{if(!mention||!matchMedia('(max-width: 767px)').matches)return;const position=()=>{const popover=mentionPopoverRef.current,editor=editorRef.current;if(!popover||!editor)return;popover.style.setProperty('--mention-bottom',`${Math.max(0,window.innerHeight-editor.getBoundingClientRect().top)}px`)};position();window.visualViewport?.addEventListener('resize',position);addEventListener('resize',position);return()=>{window.visualViewport?.removeEventListener('resize',position);removeEventListener('resize',position)}},[mention,text,targets.length]);
  const updateMention=(value:string,caret:number)=>setMention(activeMentionQuery(value,caret));
  const chooseMention=(handle:string)=>{if(!mention)return;const next=`${text.slice(0,mention.start)}@${handle} ${text.slice(mention.end)}`,caret=mention.start+handle.length+2;setText(next);setMention(undefined);requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(caret,caret)});};
  const toggleWorkflowMode=async()=>{if(modeSaving)return;setModeSaving(true);setModeError(undefined);try{await updateWorkflowMode(workflowMode==='plan'?'work':'plan')}catch(error){setModeError(error instanceof Error?error.message:String(error))}finally{setModeSaving(false)}};
  const send = async (retry=sendError) => {
    if(interventionTarget){
      const outgoing=text.trim();if(!outgoing||sending)return;
      if(!interventionTarget.active){setInterventionError('This run has already finished. Your instruction draft is still here.');return;}
      setSending(true);setInterventionError(undefined);
      try{await gateway.intervene(interventionTarget.runId,outgoing);interventionDraftsRef.current.delete(interventionTarget.runId);previousInterventionRef.current=undefined;setText(ordinaryDraftRef.current);exitIntervention();}
      catch(error){setInterventionError(error instanceof ApiError?`${error.code}: ${error.message}`:error instanceof Error?error.message:String(error));}
      finally{setSending(false);}return;
    }
    const outgoing=retry?.text??text.trim();
    const outgoingTargets=retry?.targets??parseMentions(outgoing,personas), messageId=retry?.messageId??crypto.randomUUID(),attachmentVersionIds=retry?.attachmentVersionIds??attachments.flatMap(item=>item.attachment?[item.attachment.version_id]:[]);
    if ((!outgoing&&!attachmentVersionIds.length) || !catalogReady || sending || (!retry&&attachmentsBusy))return;
    setSending(true);setSendError(undefined);
    try{await gateway.send(outgoing,outgoingTargets,messageId,attachmentVersionIds);setText("");setMention(undefined);clearAttachments();await onSent();}
    catch(error){setText(outgoing);setSendError({message:error instanceof ApiError?`${error.code}: ${error.message}`:error instanceof Error?error.message:String(error),messageId,text:outgoing,targets:outgoingTargets,attachmentVersionIds});}
    finally{setSending(false);}
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
      {modeError&&<Alert className={styles['send-error']} tone="error">Could not change room mode: {modeError}</Alert>}
      {!interventionTarget&&instructionOnlyTargets.length>0&&<Alert className={styles['plan-warning']} tone="warning">Instruction-only for {instructionOnlyTargets.map(item=>`@${item.handle}`).join(', ')}: this mode does not technically block writes to the external project.</Alert>}
      {profileError&&<Alert className={styles['send-error']} tone="error">Could not apply execution settings: {profileError}</Alert>}
      {sendError&&<Alert className={styles['send-error']} tone="error">Failed to send: {sendError.message} <Button size="sm" variant="danger" onClick={()=>void send(sendError)} disabled={sending}>Retry</Button></Alert>}
      {interventionError&&<Alert className={styles['send-error']} tone="error">Unable to add instruction: {interventionError}</Alert>}
      <div className={`${styles['compose-card']} ${composerExpanded?styles['compose-card-expanded']:styles['compose-card-compact']} ${interventionTarget?styles['instruction-card']:''}`}>
        {interventionTarget&&<header className={styles['instruction-header']}><span><MessageSquarePlus aria-hidden="true"/><strong>Add instruction to @{interventionTarget.agent}</strong></span><button type="button" onClick={exitIntervention} aria-label="Exit instruction mode" title="Back to message composer"><X/></button></header>}
        {!interventionTarget&&attachments.length>0&&<div className={styles.attachments}>{attachments.map(item=><span key={item.id} className={[item.status==='error'?styles['attachment-error']:'',item.mimeType.startsWith('image/')&&item.attachment?styles['image-attachment']:''].filter(Boolean).join(' ')}>{item.status==='uploading'?<LoaderCircle className={styles.spinning}/>:item.mimeType.startsWith('image/')&&item.attachment?<img src={item.attachment.preview_url} alt=""/>:<FileText/>}<button type="button" disabled={!item.attachment} onClick={event=>item.attachment&&openArtifact(item.attachment,readyAttachments,event.currentTarget)}>{item.name}</button><small>{item.status==='uploading'?`${item.progress}%`:item.status==='error'?item.error:formatBytes(item.size)}</small>{item.status==='uploading'&&<i style={{width:`${item.progress}%`}}/>}{item.attachment&&<WorkspaceArtifactActions attachment={item.attachment} openWorkspace={openWorkspace}/>} {item.status==='error'&&<button type="button" aria-label={`Retry upload ${item.name}`} onClick={()=>retryAttachment(item.id)}><RefreshCw/></button>}<button type="button" aria-label={`Remove ${item.name}`} onClick={()=>removeAttachment(item.id)}><X/></button></span>)}</div>}
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
          {!interventionTarget&&mention&&mentionCandidates.length>0&&<div ref={mentionPopoverRef} className={styles['mention-popover']} role="listbox" aria-label="Select an agent to mention">
            <header><span>Mention</span><small>↑↓ select · Enter insert</small></header>
            {mentionCandidates.map((candidate,index)=><button key={candidate.handle} type="button" role="option" aria-selected={index===mentionIndex} className={index===mentionIndex?styles.selected:''} onMouseDown={event=>event.preventDefault()} onClick={()=>chooseMention(candidate.handle)}>
              <i style={{background:candidate.color}}>{candidate.name[0]}</i><span><strong>{candidate.name}</strong><small><b>@{candidate.handle}</b><span> · {candidate.detail}</span></small></span>{candidate.handle==='all'&&<em>all</em>}
            </button>)}
          </div>}
          <div ref={mirrorRef} className={styles['editor-mirror']} aria-hidden="true">{highlightedText}</div>
          <TextArea
            className={styles.editor}
            ref={editorRef}
            value={text}
            rows={1}
            maxLength={interventionTarget?2000:4000}
            onChange={(e) => {setText(e.target.value);if(!interventionTarget)updateMention(e.target.value,e.target.selectionStart)}}
            onSelect={(e)=>{if(!interventionTarget)updateMention(e.currentTarget.value,e.currentTarget.selectionStart)}}
            onBlur={()=>setTimeout(()=>setMention(undefined),100)}
            onScroll={event=>{if(mirrorRef.current){mirrorRef.current.scrollTop=event.currentTarget.scrollTop;mirrorRef.current.scrollLeft=event.currentTarget.scrollLeft}}}
            onPaste={event=>{if(interventionTarget)return;const files=[...event.clipboardData.items].filter(item=>item.kind==='file').flatMap(item=>{const file=item.getAsFile();return file?[file]:[]});if(files.length){event.preventDefault();uploadFiles(files)}}}
            onKeyDown={(e) => {
              if(mention&&mentionCandidates.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){
                e.preventDefault();setMentionIndex(index=>(index+(e.key==='ArrowDown'?1:-1)+mentionCandidates.length)%mentionCandidates.length);
              } else if(mention&&mentionCandidates.length&&(e.key==='Enter'||e.key==='Tab')){
                e.preventDefault();chooseMention(mentionCandidates[mentionIndex]?.handle??mentionCandidates[0].handle);
              } else if(mention&&e.key==='Escape'){
                e.preventDefault();setMention(undefined);
              } else if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){
                e.preventDefault();void send();
              }
            }}
            aria-label={interventionTarget?`Instruction for ${interventionTarget.agent}`:'Message'}
            placeholder={composerPlaceholder}
          />
        </div>
        <footer className={interventionTarget?styles['instruction-footer']:undefined}>
          {!interventionTarget&&<ComposerAddMenu attachmentDisabled={attachments.length>=10||attachmentsBusy} onAttach={openAttachmentPicker} onOpenWorkspace={()=>openWorkspace()}/>}
          <small className={styles['composer-status']} role="status" aria-live="polite">{composerStatus}</small>
          {!interventionTarget&&<Button className={`${styles['plan-button']} ${workflowMode==='plan'?styles['plan-button-active']:''}`} size="sm" variant="ghost" title="Plan: inspect the project without implementing changes" aria-pressed={workflowMode==='plan'} disabled={modeSaving} onClick={()=>void toggleWorkflowMode()} icon={modeSaving?<LoaderCircle className={styles.spinning}/>:<Shield/>}>Plan</Button>}
          <Button
            className={styles.send}
            size="sm"
            variant="primary"
            aria-label={interventionTarget?(sending?'Sending instruction':'Send instruction'):sending?'Sending message':targets.length?`Send to ${targets.length} ${targets.length===1?'agent':'agents'}`:'Post to room'}
            disabled={interventionTarget?!text.trim()||sending:(!text.trim()&&!attachments.some(item=>item.status==='ready')) || !catalogReady || sending || attachmentsBusy}
            onClick={()=>void send()}
            title={interventionTarget?'Send instruction':targets.length?`Send to ${targets.length} ${targets.length===1?'agent':'agents'}`:'Post to room'}
          >
            {interventionTarget?(sending?<><LoaderCircle className={styles.spinning}/><span>Sending…</span></>:<><MessageSquarePlus/><span>Send instruction</span></>):sending?<LoaderCircle className={styles.spinning}/>:<ArrowUp/>}
          </Button>
        </footer>
      </div>
    </div>
  );
});

type ComposerProps={
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
};

function formatBytes(value:number){if(value<1024)return`${value} B`;if(value<1024*1024)return`${(value/1024).toFixed(1)} KB`;return`${(value/1024/1024).toFixed(1)} MB`;}
