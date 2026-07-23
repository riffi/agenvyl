import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileText, FolderOpen, LoaderCircle, Paperclip, RefreshCw, Send, Square, X } from 'lucide-react';
import {personaModelName,type HarnessCatalog} from '../../entities/harness';
import type { Persona } from '../../entities/persona';
import { FakeRoomGateway, type DemoKind, type RoomGateway } from '../../features/room-session';
import { activeMentionQuery, insertMentionAt, parseMentions, removeMentionTarget, type ComposerAttachment } from '../../features/send-message';
import { ApiError } from '../../shared/api';
import { Alert, Button, TextArea } from '../../shared/ui';
import type {ExecutionIntent,RoomExecutionState,RoomPersona} from '@agenvyl/contracts';
import type {WorkspaceFocus} from '../artifacts-drawer';
import {ArtifactActionsMenu,type OpenArtifact} from '../artifact-viewer';
import styles from './Composer.module.css';
import {ImplementationHandoff,type ImplementationDraft} from './ImplementationHandoff';
import {ReasoningEffortChip,roomPersonaModel,roomPersonaReasoning} from '../../features/reasoning-effort';

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
  executionState={plan:{path:'plan.md',current:null,approved:null}},
  approvePlan=async()=>{},
  clearApprovedPlan=async()=>{},
  planModeEnabled=true,
}: ComposerProps,ref) {
  const [text, setText] = useState("");
  const editorRef=useRef<HTMLTextAreaElement>(null);
  const mirrorRef=useRef<HTMLDivElement>(null);
  const mentionPopoverRef=useRef<HTMLDivElement>(null);
  const [mention,setMention]=useState<{start:number;end:number;query:string}>();
  const [mentionIndex,setMentionIndex]=useState(0);
  const [sending,setSending]=useState(false);
  const [handoffOpen,setHandoffOpen]=useState(false);
  const [planning,setPlanning]=useState(false);
  const [sendError,setSendError]=useState<{message:string;messageId:string;text:string;targets:string[];attachmentVersionIds:string[];executionIntent?:ExecutionIntent} | undefined>();
  const [profileError,setProfileError]=useState<string>();
  useImperativeHandle(ref,()=>({insertMention:(handle:string)=>{const editor=editorRef.current,{text:next,caret}=insertMentionAt(text,handle,editor?.selectionStart??text.length,editor?.selectionEnd??text.length);if(next.length>4000)return;setText(next);setMention(undefined);requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(caret,caret)});}}),[text]);
  const targets = useMemo(
    () => parseMentions(text, personas),
    [text, personas],
  );
  const highlightedText=useMemo(()=>highlightMentions(text,personas),[text,personas]);
  const byHandle = new Map(personas.map((p) => [p.handle, p]));
  const participantsByHandle=new Map(roomPersonas.map(item=>[item.persona.handle,item]));
  const implementationTargets=useMemo(()=>personas.map(persona=>({handle:persona.handle,name:persona.name,detail:personaModelName(persona,harnessCatalog),color:persona.color})),[personas,harnessCatalog]);
  const startImplementation=async(draft:ImplementationDraft)=>{const approved=executionState.plan.approved;if(!catalogReady)throw new Error('Agent catalog is unavailable');if(!approved)throw new Error('The plan is no longer approved');await gateway.send(draft.text,draft.targets,draft.messageId,[],{kind:'implement',approved_plan_version_id:approved.version_id});await onSent();};
  const targetExecutionPreview=targets.map(handle=>{const participant=participantsByHandle.get(handle),persona=participant?.persona??byHandle.get(handle),instance=harnessCatalog?.instances.find(item=>item.id===persona?.harness_instance_id),model=participant?roomPersonaModel(participant,harnessCatalog):instance?.models.find(item=>item.id===persona?.model_id),reasoning=participant?roomPersonaReasoning(participant,model):{effective:model?.defaultReasoningEffort??null,fallback:false},native=instance?.controls.nativeWorkflowModes.includes('plan'),ceiling=!planning&&instance?.type==='antigravity'&&instance.controls.permissionProfiles[0]?.id==='plan';return{handle,mode:planning?(native?'Native Plan':'Instruction-only Plan'):ceiling?'Work · plan-only ceiling':'Work',effort:reasoning.effective??'Auto',fallback:reasoning.fallback};});
  const readyAttachments=attachments.flatMap(item=>item.attachment?[item.attachment]:[]);
  const mentionCandidates=useMemo(()=>[
    {handle:'all',name:'All agents',detail:'Notify every participant',color:'#4f6ef7'},
    ...personas.map(persona=>({handle:persona.handle,name:persona.name,detail:personaModelName(persona,harnessCatalog),color:persona.color})),
  ].filter(candidate=>!mention||!mention.query||candidate.handle.toLowerCase().includes(mention.query)||candidate.name.toLowerCase().includes(mention.query)||candidate.detail.toLowerCase().includes(mention.query)).slice(0,8),[harnessCatalog,mention,personas]);
  useEffect(()=>setMentionIndex(0),[mention?.query]);
  useEffect(()=>{setText('');setMention(undefined);setSendError(undefined);setProfileError(undefined);setHandoffOpen(false);setPlanning(false)},[roomId]);
  useEffect(()=>setHandoffOpen(false),[executionState.plan.approved?.version_id]);
  useEffect(()=>{if(!planModeEnabled){setPlanning(false);setHandoffOpen(false)}},[planModeEnabled]);
  useEffect(()=>{const editor=editorRef.current;if(!editor)return;editor.style.height='auto';editor.style.height=`${Math.min(Math.max(editor.scrollHeight,72),220)}px`;if(mirrorRef.current){mirrorRef.current.scrollTop=editor.scrollTop;mirrorRef.current.scrollLeft=editor.scrollLeft}},[text]);
  useLayoutEffect(()=>{if(!mention||!matchMedia('(max-width: 767px)').matches)return;const position=()=>{const popover=mentionPopoverRef.current,editor=editorRef.current;if(!popover||!editor)return;popover.style.setProperty('--mention-bottom',`${Math.max(0,window.innerHeight-editor.getBoundingClientRect().top)}px`)};position();window.visualViewport?.addEventListener('resize',position);addEventListener('resize',position);return()=>{window.visualViewport?.removeEventListener('resize',position);removeEventListener('resize',position)}},[mention,text,targets.length]);
  const updateMention=(value:string,caret:number)=>setMention(activeMentionQuery(value,caret));
  const chooseMention=(handle:string)=>{if(!mention)return;const next=`${text.slice(0,mention.start)}@${handle} ${text.slice(mention.end)}`,caret=mention.start+handle.length+2;setText(next);setMention(undefined);requestAnimationFrame(()=>{editorRef.current?.focus();editorRef.current?.setSelectionRange(caret,caret)});};
  const send = async (retry=sendError) => {
    let outgoing=retry?.text??text.trim(),planIntent=planModeEnabled&&(retry?.executionIntent?.kind==='plan'||planning);const command=planModeEnabled&&!retry?outgoing.match(/^\/plan(?:\s+([\s\S]*))?$/i):null;if(command){planIntent=true;outgoing=(command[1]??'').trim();if(!outgoing){setPlanning(true);setText('');return;}}
    const outgoingTargets=retry?.targets??parseMentions(outgoing,personas), messageId=retry?.messageId??crypto.randomUUID(),attachmentVersionIds=retry?.attachmentVersionIds??attachments.flatMap(item=>item.attachment?[item.attachment.version_id]:[]);
    if(planIntent&&outgoingTargets.length!==1){setProfileError('Create or update plan requires exactly one responder.');return;}
    if ((!outgoing&&!attachmentVersionIds.length) || !catalogReady || sending || (!retry&&attachmentsBusy))return;
    setSending(true);setSendError(undefined);
    const executionIntent:ExecutionIntent|undefined=retry?.executionIntent??(planIntent?{kind:'plan'}:undefined);
    try{await gateway.send(outgoing,outgoingTargets,messageId,attachmentVersionIds,executionIntent);setText("");setMention(undefined);setPlanning(false);clearAttachments();await onSent();}
    catch(error){setText(outgoing);setSendError({message:error instanceof ApiError?`${error.code}: ${error.message}`:error instanceof Error?error.message:String(error),messageId,text:outgoing,targets:outgoingTargets,attachmentVersionIds,executionIntent});}
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
      {planModeEnabled&&<PlanCard state={executionState} openWorkspace={openWorkspace} approve={approvePlan} clear={clearApprovedPlan} handoffOpen={handoffOpen} toggleHandoff={()=>setHandoffOpen(open=>!open)}/>}
      {planModeEnabled&&executionState.plan.approved&&handoffOpen&&<ImplementationHandoff targets={implementationTargets} initialTargets={targets} onStart={startImplementation} onClose={()=>setHandoffOpen(false)}/>}
      {profileError&&<Alert className={styles['send-error']} tone="error">Could not apply execution settings: {profileError}</Alert>}
      {sendError&&<Alert className={styles['send-error']} tone="error">Failed to send: {sendError.message} <Button size="sm" variant="danger" onClick={()=>void send(sendError)} disabled={sending}>Retry</Button></Alert>}
      <div className={styles['compose-card']}>
        {attachments.length>0&&<div className={styles.attachments}>{attachments.map(item=><span key={item.id} className={[item.status==='error'?styles['attachment-error']:'',item.mimeType.startsWith('image/')&&item.attachment?styles['image-attachment']:''].filter(Boolean).join(' ')}>{item.status==='uploading'?<LoaderCircle className={styles.spinning}/>:item.mimeType.startsWith('image/')&&item.attachment?<img src={item.attachment.preview_url} alt=""/>:<FileText/>}<button type="button" disabled={!item.attachment} onClick={event=>item.attachment&&openArtifact(item.attachment,readyAttachments,event.currentTarget)}>{item.name}</button><small>{item.status==='uploading'?`${item.progress}%`:item.status==='error'?item.error:formatBytes(item.size)}</small>{item.status==='uploading'&&<i style={{width:`${item.progress}%`}}/>}{item.attachment&&<ArtifactActionsMenu attachment={item.attachment} openWorkspace={attachment=>openWorkspace({entryId:attachment.entry_id,versionId:attachment.version_id})}/>} {item.status==='error'&&<button type="button" aria-label={`Retry upload ${item.name}`} onClick={()=>retryAttachment(item.id)}><RefreshCw/></button>}<button type="button" aria-label={`Remove ${item.name}`} onClick={()=>removeAttachment(item.id)}><X/></button></span>)}</div>}
        {targets.length>0&&<div className={styles['target-row']}>
          <span>Responders:</span>
          <div className={styles.targets}>
            {targets.map((h) => {
              const p = byHandle.get(h)!;
              const participant=participantsByHandle.get(h);
              return <span className={styles['target-chip']} key={h}><button title={`Remove @${h}`} onClick={() => setText(value=>removeMentionTarget(value,h,personas))}><i style={{ background: p.color }}>{p.name[0]}</i><span>{p.name}</span><X /></button>{participant&&<ReasoningEffortChip participant={participant} catalog={harnessCatalog} onChange={value=>updateParticipantReasoning(participant.persona.id,value)}/>}</span>;
            })}
          </div>
          <div className={styles['target-preview']}>{targetExecutionPreview.map(item=><small key={item.handle}>@{item.handle}: {item.mode} · {item.effort}{item.fallback?' → fallback':''}</small>)}</div>
        </div>}
        <div className={styles['editor-wrap']}>
          {mention&&mentionCandidates.length>0&&<div ref={mentionPopoverRef} className={styles['mention-popover']} role="listbox" aria-label="Select an agent to mention">
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
            maxLength={4000}
            onChange={(e) => {setText(e.target.value);updateMention(e.target.value,e.target.selectionStart)}}
            onSelect={(e)=>updateMention(e.currentTarget.value,e.currentTarget.selectionStart)}
            onBlur={()=>setTimeout(()=>setMention(undefined),100)}
            onScroll={event=>{if(mirrorRef.current){mirrorRef.current.scrollTop=event.currentTarget.scrollTop;mirrorRef.current.scrollLeft=event.currentTarget.scrollLeft}}}
            onPaste={event=>{const files=[...event.clipboardData.items].filter(item=>item.kind==='file').flatMap(item=>{const file=item.getAsFile();return file?[file]:[]});if(files.length){event.preventDefault();uploadFiles(files)}}}
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
            placeholder="Message… Use @handle or @all"
          />
        </div>
        <footer>
        <div className={styles['compose-tools']}>{planModeEnabled&&<Button className={`${styles['plan-button']} ${planning?styles['plan-button-active']:''}`} size="sm" variant="ghost" title="Use Plan for the next message" aria-pressed={planning} onClick={()=>setPlanning(value=>!value)} icon={<FileText/>}><span className={styles['action-label']}>{executionState.plan.current?'Update plan':'Create plan'}</span></Button>}<Button className={styles['attachment-button']} size="sm" variant="ghost" title="Attach files" aria-label="Attach files" disabled={attachments.length>=10} onClick={openAttachmentPicker} icon={attachmentsBusy?<LoaderCircle className={styles.spinning}/>:<Paperclip/>}><span className={styles['action-label']}>Attach</span></Button><Button className={styles['workspace-button']} size="sm" variant="ghost" title="Open room workspace" aria-label="Open room workspace" onClick={()=>openWorkspace()} icon={<FolderOpen />}><span className={styles['action-label']}>Workspace</span></Button></div>
        <small>{!catalogReady?'Agent catalog unavailable':planning&&targets.length!==1?'Plan needs exactly one responder':targets.length?`${targets.length} ${targets.length===1?'responder':'responders'} · ${text.length} / 4000`:`No responders · posts to room · ${text.length} / 4000`}</small>
        <Button
          className={styles.send}
          size="sm"
          variant="primary"
          aria-label={sending?'Sending message':targets.length?`Send to ${targets.length} ${targets.length===1?'agent':'agents'}`:'Post to room'}
          disabled={(!text.trim()&&!attachments.some(item=>item.status==='ready')) || !catalogReady || sending || attachmentsBusy||(planning&&targets.length!==1)}
          onClick={()=>void send()}
        >
          {sending?<><LoaderCircle className={styles.spinning}/><span className={styles['action-label']}>Sending…</span></>:<><span className={styles['action-label']}>{planning?(executionState.plan.current?'Update plan':'Create plan'):targets.length?`Send to ${targets.length}`:'Post to room'}</span><Send /></>}
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
  openWorkspace:(target?:Omit<WorkspaceFocus,'requestId'>)=>void;
  openArtifact?:OpenArtifact;
  roomId:string;
  attachments:ComposerAttachment[];
  attachmentsBusy:boolean;
  openAttachmentPicker:()=>void;
  uploadFiles:(files:File[])=>void;
  removeAttachment:(id:string)=>void;
  retryAttachment:(id:string)=>void;
  clearAttachments:()=>void;
  executionState?:RoomExecutionState;
  approvePlan?:(versionId:string)=>Promise<unknown>;
  clearApprovedPlan?:()=>Promise<unknown>;
  planModeEnabled?:boolean;
};

function PlanCard({state,openWorkspace,approve,clear,handoffOpen,toggleHandoff}:{state:RoomExecutionState;openWorkspace:(target?:Omit<WorkspaceFocus,'requestId'>)=>void;approve:(versionId:string)=>Promise<unknown>;clear:()=>Promise<unknown>;handoffOpen:boolean;toggleHandoff:()=>void}){
  const{current,approved}=state.plan;if(!current&&!approved)return null;const pending=Boolean(current&&approved&&current.version_id!==approved.version_id),status=pending?'Changes pending':approved?'Approved':'Ready to approve',primary=approved??current!;
  const open=(value=primary)=>openWorkspace({entryId:value.entry_id,versionId:value.version_id});
  return <div className={`${styles['approved-plan']} ${pending?styles['plan-pending']:!approved?styles['plan-ready']:''}`}><button type="button" className={styles['plan-title']} onClick={()=>open()}><strong>{status}</strong><small>plan.md · {pending?'Implement still uses the approved version.':approved?'Immutable version ready for implementation.':'Review the workspace artifact before approval.'}</small></button><div>{pending&&approved&&<button type="button" onClick={()=>open(approved)}>Open approved</button>}{pending&&current&&<button type="button" onClick={()=>open(current)}>Open changes</button>}{!pending&&<button type="button" onClick={()=>open()}>Open</button>}{current&&(!approved||pending)&&<button type="button" onClick={()=>void approve(current.version_id)}>{approved?'Re-approve':'Approve'}</button>}{approved&&<button type="button" onClick={()=>void clear()}>Clear</button>}{approved&&<button type="button" className={styles['start-implementation']} aria-expanded={handoffOpen} onClick={toggleHandoff}>Implement…</button>}</div></div>;
}

function formatBytes(value:number){if(value<1024)return`${value} B`;if(value<1024*1024)return`${(value/1024).toFixed(1)} KB`;return`${(value/1024/1024).toFixed(1)} MB`;}
