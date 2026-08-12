import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Ban, Brain, Check, ChevronDown, ChevronUp, CircleCheck, CircleHelp, CircleX, Clock3, Eye, FolderCheck, Info, LoaderCircle, MessageSquarePlus, Paperclip, RotateCcw, Square, TriangleAlert } from 'lucide-react';
import type {HumanAuthorSnapshot,UpstreamStatus,WorkspaceAttachment} from '@agenvyl/contracts';
import {WorkspaceArtifactActions,type OpenWorkspaceArtifact,type WorkspaceTarget} from '../workspace-window';
import {HarnessIcon,type HarnessCatalog} from '../../entities/harness';
import type { Persona } from '../../entities/persona';
import type { RoomState } from '../../entities/room';
import {RunFailureNotice,type Run} from '../../entities/run';
import type { RoomGateway } from '../../features/room-session';
import { Alert, Avatar, EmptyState, IconButton } from '../../shared/ui';
import styles from './Timeline.module.css';
import { isLongAnswer, shouldUseSingleColumn } from './layout';
import {MentionText} from './mentions';
import {ReasoningBlock} from './ReasoningBlock';
import {RunActivity} from './RunActivity';
import {RunFiles} from './RunFiles';
import {RunRequest} from './RunRequest';
import {answerHistoryText,RunAnswerHistory} from './RunAnswerHistory';

export { MarkdownAnswer } from './MarkdownAnswer';
export {ReasoningBlock} from './ReasoningBlock';

const statusLabel: Record<Run['status'], string> = {
  queued: 'queued',
  streaming: 'responding',
  finalizing: 'finalizing files',
  stopping: 'stopping',
  waiting_approval: 'waiting for approval',
  waiting_clarification: 'needs clarification',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

const activeStatuses = new Set<Run['status']>(['queued', 'streaming', 'finalizing', 'stopping']);

function StatusIcon({status}:{status:Run['status']}) {
  const label=statusLabel[status];
  const icon=activeStatuses.has(status)
    ? <LoaderCircle />
    : status==='completed'
      ? <Check />
      : status==='failed'
        ? <CircleX />
        : status==='cancelled'
          ? <Ban />
          : status==='waiting_approval'
            ? <TriangleAlert />
            : status==='waiting_clarification'
              ? <CircleHelp />
              : <Clock3 />;
  return <span className={`${styles['status-icon']} ${styles[status]} ${activeStatuses.has(status)?styles.spinning:''}`} role="img" aria-label={`Status: ${label}`} title={label}>{icon}</span>;
}

function ToolStatusIcon({status}:{status:Run['tools'][number]['status']}) {
  const label=status==='completed'?'Completed':status==='failed'?'Failed':status==='cancelled'?'Cancelled':status==='progress'?'In progress':'Started';
  const icon=status==='completed'?<CircleCheck/>:status==='failed'?<CircleX/>:status==='cancelled'?<Ban/>:status==='progress'?<LoaderCircle/>:<Clock3/>;
  return <span className={`${styles['tool-status']} ${styles[`tool-status-${status}`]}`} role="img" aria-label={`Tool status: ${label}`} title={label}>{icon}</span>;
}

function catalogModel(run:Run,catalog:HarnessCatalog|undefined){return catalog?.instances.find(instance=>instance.id===run.harnessInstanceId)?.models.find(model=>model.id===run.modelId)?.label;}

function modelName(run:Run,persona:Persona,catalog:HarnessCatalog|undefined) {
  const route=run.modelId??run.requestedModel??persona.model_id??persona.requested_model;
  const value=catalogModel(run,catalog)??(!run.requestedModel?persona.effective_model:null)??route;
  if(!value)return 'model not set';
  return value.split('/').at(-1)??value;
}

function fullModelName(run:Run,persona:Persona,catalog:HarnessCatalog|undefined) {
  const route=run.modelId??run.requestedModel??persona.model_id??persona.requested_model;
  return catalogModel(run,catalog)??(!run.requestedModel?persona.effective_model:null)??route??undefined;
}

const unknownPersona = (handle: string): Persona => ({
  id: '', handle, name: `@${handle}`, color: '#64748b', requested_model: null, harness_instance_id:'unknown',harness_type:'unknown',model_id:'unknown',permission_profile_id:null,agent_variant_id:null,default_reasoning_effort:null,group_id:null, archived_at: null,
});

export function UpstreamStatusNotice({status}:{status:UpstreamStatus}) {
  const text=status.state==='waiting_upstream'
    ? 'Waiting for the provider…'
    : status.reason==='rate_limited'
      ? 'The provider rate-limited the request. Retrying…'
      : status.reason==='authentication_failed'
        ? 'The provider rejected authentication. Retrying…'
        : status.reason==='provider_timeout'
          ? 'The provider did not respond in time. Retrying…'
          : status.reason==='model_unavailable'
            ? 'The model is temporarily unavailable. Retrying…'
            : 'The provider is temporarily unavailable. Retrying…';
  return <div className={styles['upstream-status']} role="status" aria-live="polite"><RotateCcw/><span>{text}{status.attempt!==undefined&&<small>Attempt {status.attempt}</small>}</span></div>;
}

function RunCard({
  run,
  persona,
  select,
  cancel,
  addInstruction,
  canAddInstruction,
  retry,
  canRetry,
  attemptIndex,
  attemptCount,
  previousAttempt,
  nextAttempt,
  resolve,
  collapsed,
  toggleCollapsed,
  harnessCatalog,
  personas,
  onMentionPersona,
  openWorkspace,
  openArtifact,
  author,
}: {
  run: Run;
  persona: Persona;
  select: () => void;
  cancel: () => void;
  addInstruction:()=>void;
  canAddInstruction:boolean;
  retry: () => Promise<void>;
  canRetry:boolean;
  attemptIndex:number;
  attemptCount:number;
  previousAttempt:()=>void;
  nextAttempt:()=>void;
  resolve: (requestId:string,v: import('@agenvyl/contracts').RunRequestResolution|string) => Promise<void>;
  collapsed:boolean;
  toggleCollapsed:()=>void;
  harnessCatalog?:HarnessCatalog;
  personas:Persona[];
  onMentionPersona:(handle:string)=>void;
  openWorkspace:(target:WorkspaceTarget)=>void;
  openArtifact:OpenWorkspaceArtifact;
  author:HumanAuthorSnapshot;
}) {
  const [retrying,setRetrying]=useState(false);const [retryError,setRetryError]=useState<string>();
  const openRunWorkspace=useCallback((attachment:WorkspaceAttachment)=>openWorkspace({entryId:attachment.entry_id,versionId:attachment.version_id}),[openWorkspace]);
  const canCancel=['queued','streaming','waiting_approval','waiting_clarification'].includes(run.status);
  const retryLabel=run.status==='completed'?'Create another response':'Run again';
  const retryRun=async()=>{setRetrying(true);setRetryError(undefined);try{await retry()}catch(error){setRetryError(error instanceof Error?error.message:String(error))}finally{setRetrying(false)}};
  const publishedFileCount=run.artifactSummary?.project_count??run.artifacts?.filter(item=>item.attribution==='exact').length??0;
  const changedFiles=run.artifacts?.filter(item=>item.attribution==='exact'&&!run.embeds?.some(embed=>embed.status==='resolved'&&embed.attachment?.version_id===item.version_id))??[];
  const hasProjectChanges=publishedFileCount>0;
  const workspaceActivity=hasProjectChanges&&Boolean(run.workspaceResult&&['complete','incomplete'].includes(run.workspaceResult.capture_status));
  const hasActivity=Boolean(workspaceActivity||run.tools.length);
  const buildMissing=hasProjectChanges&&run.staticPreviewStatus==='build_missing';
  const previewCaptureFailed=run.staticPreviewStatus==='capture_failed';
  return (
    <article
      className={`${styles['run-card']} ${styles[run.status]}`}
      ui-spec-block-id="agent_response_card"
    >
      <Avatar className={styles['run-avatar']} label={persona.name} color={persona.color} />
      <div className={styles['run-surface']}>
        <div className={styles['run-body']}>
          <header className={styles['run-header']}>
          <span className={styles['run-identity']}>
            <span className={styles['run-name']}>
              <strong style={{ color: persona.color }}>{persona.name}</strong>
            </span>
            <span className={styles['model-meta']}>
              <HarnessIcon type={run.harnessType}/>
              <small className={styles['model-label']} title={fullModelName(run,persona,harnessCatalog)}>{modelName(run,persona,harnessCatalog)}</small>
              <small className={styles['reasoning-level']} aria-label={`Reasoning effort: ${run.executionProfile.reasoningEffort??'Auto'}`} title={`Reasoning: ${run.executionProfile.reasoningEffort??'Auto'} · ${run.executionProfile.reasoningEffortSource.replaceAll('_',' ')}${run.executionProfile.reasoningEffortFallback?` · fallback from ${run.executionProfile.requestedReasoningEffort}`:''}`}><Brain/><span>{run.executionProfile.reasoningEffort??'Auto'}</span></small>
            </span>
          </span>
          <span className={styles['run-header-actions']}>
            <StatusIcon status={run.status}/>
            <span className={styles['run-actions']}>
              <IconButton className={styles['run-details']} onClick={select} title="Run details" aria-label={`Run details: ${persona.name}`}><Info/></IconButton>
              {canAddInstruction&&<IconButton className={styles['instruction-run']} onClick={addInstruction} title="Add instruction" aria-label={`Add instruction to ${persona.name}`}><MessageSquarePlus/></IconButton>}
              {canCancel&&<IconButton className={styles['stop-run']} onClick={cancel} title="Stop" aria-label={`Stop ${persona.name} response`}><Square/></IconButton>}
              {canRetry&&<IconButton className={styles['retry-run']} disabled={retrying} onClick={()=>void retryRun()} title={retrying?'Starting…':retryLabel} aria-label={`${retryLabel}: ${persona.name}`}>{retrying?<LoaderCircle className={styles['action-spinner']}/>:<RotateCcw/>}</IconButton>}
            </span>
          </span>
          </header>
        {run.upstreamStatus&&<UpstreamStatusNotice status={run.upstreamStatus}/>}
        {run.status==='finalizing'&&<div className={`${styles['workspace-state']} ${styles['workspace-state-progress']}`} role="status" aria-live="polite"><LoaderCircle aria-hidden="true"/><span>Finalizing files…</span></div>}
        {run.reasoning&&<ReasoningBlock text={run.reasoning} harnessType={run.harnessType}/>}
        <RunAnswerHistory run={run} fallbackAuthor={author} personas={personas} onMentionPersona={onMentionPersona} openWorkspace={openRunWorkspace} collapsed={collapsed}/>
        {isLongAnswer(answerHistoryText(run))&&run.status==='completed'&&<button className={`${styles['answer-toggle']} ${collapsed?styles.expand:styles.collapse}`} type="button" onClick={toggleCollapsed} aria-expanded={!collapsed}>{collapsed?<><span>Expand response</span><ChevronDown/></>:<><span>Collapse response</span><ChevronUp/></>}</button>}
        {run.status==='failed'&&<RunFailureNotice errorCode={run.errorCode} error={run.error}/>}
        {(run.requests??[]).some(request=>!request.resolved)&&<section className={styles['request-list']} aria-label="Pending agent requests"><strong>{(run.requests??[]).filter(request=>!request.resolved).length} pending {(run.requests??[]).filter(request=>!request.resolved).length===1?'request':'requests'}</strong>{(run.requests??[]).filter(request=>!request.resolved).map(request=><RunRequest key={request.id} request={request} resolve={value=>resolve(request.id,value)}/>)}</section>}
        <RunFiles files={changedFiles} summary={run.artifactSummary} openWorkspace={openWorkspace}/>
        {(run.staticPreview||buildMissing||previewCaptureFailed)&&<div className={styles['run-output-actions']}>
          {run.staticPreview&&<button type="button" title="Open the app build captured for this response" aria-label="Open the app build captured for this response" onClick={event=>openArtifact(run.staticPreview!,[run.staticPreview!],event.currentTarget,{section:'app',buildRunId:run.id})}><Eye aria-hidden="true"/>Open this build</button>}
          {!run.staticPreview&&buildMissing&&<small>Preview unavailable · Build output not found</small>}
          {!run.staticPreview&&previewCaptureFailed&&<small>Preview unavailable · Build could not be saved</small>}
        </div>}
        {hasActivity&&<div className={styles['run-meta-row']}>
          <RunActivity actionCount={run.tools.length} hasWorkspaceEvent={workspaceActivity}>
            {workspaceActivity&&publishedFileCount>0&&<div className={`${styles['workspace-state']} ${styles['workspace-state-success']}`} role="status" title="The agent’s files remain in the room workspace and were recorded in Git."><FolderCheck aria-hidden="true"/><span>Workspace updated</span><small>· {publishedFileCount} {publishedFileCount===1?'file':'files'}</small></div>}
            {run.tools.length>0&&<section className={styles['tool-section']} aria-label="Tool calls">
              <h4>Tool calls <span>{run.tools.length}</span></h4>
              <div className={styles['tool-activity']}>
                {run.tools.map(tool=><div key={tool.id}><span><strong>{tool.name}</strong><small>{tool.detail}</small></span><ToolStatusIcon status={tool.status}/></div>)}
              </div>
            </section>}
          </RunActivity>
        </div>}
        {attemptCount>1&&<div className={styles['run-footer']}>
          {attemptCount>1&&<span className={styles['attempt-carousel']}><IconButton onClick={previousAttempt} disabled={attemptIndex===0} aria-label="Previous attempt">‹</IconButton><small>{attemptIndex+1} of {attemptCount}</small><IconButton onClick={nextAttempt} disabled={attemptIndex===attemptCount-1} aria-label="Next attempt">›</IconButton></span>}
        </div>}
          {retryError&&<Alert tone="error">{retryError}</Alert>}
        </div>
      </div>
    </article>
  );
}
export function Timeline({
  state,
  personas,
  select,
  gateway,
  loadOlder,
  loadingOlder,
  initialLoading,
  harnessCatalog,
  onMentionPersona,
  openWorkspace=()=>{},
  openArtifact=()=>{},
  roomId:_roomId='',
  addInstructionToRun,
}: {
  state: RoomState;
  personas: Persona[];
  select: (id: string) => void;
  gateway: RoomGateway;
  loadOlder:()=>Promise<void>;
  loadingOlder:boolean;
  initialLoading:boolean;
  harnessCatalog?:HarnessCatalog;
  onMentionPersona:(handle:string)=>void;
  openWorkspace?:(target:WorkspaceTarget)=>void;
  openArtifact?:OpenWorkspaceArtifact;
  roomId?:string;
  addInstructionToRun?:(runId:string)=>void;
}) {
  const byHandle = new Map(personas.map((p) => [p.handle, p]));
  const [attemptView,setAttemptView]=useState<Record<string,string>>({});
  const [expandedAnswers,setExpandedAnswers]=useState<Set<string>>(()=>new Set());
  const [collapsedAnswers,setCollapsedAnswers]=useState<Set<string>>(()=>new Set());
  const [focusedResponseSlots,setFocusedResponseSlots]=useState<Record<string,string>>({});
  const streamedRunsRef=useRef(new Set<string>());
  const timelineRef=useRef<HTMLElement>(null);
  const prependAnchorRef=useRef<{height:number;top:number}|undefined>(undefined);
  const settleScrollFrameRef=useRef<number|undefined>(undefined);
  const followLatestRef=useRef(true);
  const pointerScrollingRef=useRef(false);
  const slotOf=(run:Run):string=>{if(run.responseSlotId)return run.responseSlotId;let current=run;const seen=new Set<string>();while(current.retryOfRunId&&!seen.has(current.id)){seen.add(current.id);const parent=state.runs[current.retryOfRunId];if(!parent)break;current=parent}return current.id};
  useEffect(()=>{if(state.messages.length===0)followLatestRef.current=true},[state.messages.length]);
  useLayoutEffect(()=>{const timeline=timelineRef.current;if(!timeline)return;const anchor=prependAnchorRef.current;if(anchor){timeline.scrollTop=anchor.top+timeline.scrollHeight-anchor.height;prependAnchorRef.current=undefined;return}if(!followLatestRef.current)return;if(settleScrollFrameRef.current)cancelAnimationFrame(settleScrollFrameRef.current);let priorHeight=-1,stableFrames=0,frames=0;const settle=()=>{if(!followLatestRef.current)return;timeline.scrollTop=timeline.scrollHeight;const height=timeline.scrollHeight;stableFrames=height===priorHeight?stableFrames+1:0;priorHeight=height;frames++;if((frames<8||stableFrames<3)&&frames<60)settleScrollFrameRef.current=requestAnimationFrame(settle);else settleScrollFrameRef.current=undefined};settle()},[state.messages.length]);
  useEffect(()=>{const timeline=timelineRef.current;if(!timeline||typeof ResizeObserver==='undefined')return;let frame:number|undefined;const observer=new ResizeObserver(()=>{if(!followLatestRef.current)return;if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{timeline.scrollTop=timeline.scrollHeight})});timeline.querySelectorAll('[data-timeline-layout]').forEach(element=>observer.observe(element));return()=>{observer.disconnect();if(frame)cancelAnimationFrame(frame)}},[state.messages.length]);
  useEffect(()=>()=>{if(settleScrollFrameRef.current)cancelAnimationFrame(settleScrollFrameRef.current)},[]);
  const loadPrevious=async()=>{const timeline=timelineRef.current;if(!timeline)return;prependAnchorRef.current={height:timeline.scrollHeight,top:timeline.scrollTop};try{await loadOlder()}catch{prependAnchorRef.current=undefined;}};
  return <main
      ref={timelineRef}
      className={styles.timeline}
      ui-spec-block-id="conversation_timeline"
      onWheel={event=>{if(event.deltaY<0)followLatestRef.current=false}}
      onTouchMove={()=>{followLatestRef.current=false}}
      onPointerDown={()=>{pointerScrollingRef.current=true}}
      onPointerUp={()=>{pointerScrollingRef.current=false}}
      onPointerCancel={()=>{pointerScrollingRef.current=false}}
      onScroll={event=>{const timeline=event.currentTarget;const atBottom=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<80;if(atBottom)followLatestRef.current=true;else if(pointerScrollingRef.current)followLatestRef.current=false;if(timeline.scrollTop<120&&state.hasMore&&!loadingOlder)void loadPrevious()}}
    >
      {loadingOlder&&<div className={styles.reconnect}>Loading earlier messages…</div>}
      {state.messages.length === 0 && !initialLoading && (
        <EmptyState compact title="Start a conversation" description={<p>
            Mention <code>@handle</code> or <code>@all</code> to run agents in
            parallel.
          </p>} />
      )}
      {initialLoading&&<div className={styles.reconnect}>Loading history…</div>}
      {state.connection !== "connected" && (
        <div className={styles.reconnect}>
          <RotateCcw />{" "}
          {state.connection === "connecting"
            ? "Connecting to the room…"
            : state.connection === "reconnecting"
              ? "Connection lost. Reconnecting…"
              : "Restoring events…"}
        </div>
      )}
      {state.messages.map((m,messageIndex) => {
        const groups=Object.entries(m.runIds.reduce<Record<string,string[]>>((result,id)=>{const run=state.runs[id];if(!run)return result;const slot=slotOf(run);(result[slot]??=[]).push(id);return result},{}));
        const visibleGroups=groups.map(([slot,attemptIds])=>{const activeAttempt=[...attemptIds].reverse().map(id=>state.runs[id]).find((run:Run)=>['queued','streaming','finalizing','stopping','waiting_approval','waiting_clarification'].includes(run.status));const shownId=activeAttempt?.id??attemptView[slot]??state.selectedRuns[slot]??attemptIds.at(-1)!;const shownIndex=Math.max(0,attemptIds.indexOf(shownId));return{slot,attemptIds,activeAttempt,shownIndex,id:attemptIds[shownIndex]}});
        const visibleRuns=visibleGroups.flatMap(group=>state.runs[group.id]?[state.runs[group.id]]:[]);
        visibleRuns.forEach(run=>{if(run.status==='streaming')streamedRunsRef.current.add(run.id)});
        const isCollapsed=(run:Run)=>isLongAnswer(answerHistoryText(run))&&run.status==='completed'&&(collapsedAnswers.has(run.id)||(!run.interventions.length&&!expandedAnswers.has(run.id)&&!streamedRunsRef.current.has(run.id)));
        const singleColumn=shouldUseSingleColumn(visibleRuns.map(answerHistoryText));
        const responseTabs=singleColumn&&visibleGroups.length>1;
        const focusedSlot=focusedResponseSlots[m.id]&&visibleGroups.some(group=>group.slot===focusedResponseSlots[m.id])
          ? focusedResponseSlots[m.id]
          : visibleGroups.find(group=>group.activeAttempt)?.slot??visibleGroups[0]?.slot;
        const displayedGroups=responseTabs?visibleGroups.filter(group=>group.slot===focusedSlot):visibleGroups;
        const imageAttachments=(m.attachments??[]).filter(item=>item.mime_type.startsWith('image/'));
        const fileAttachments=(m.attachments??[]).filter(item=>!item.mime_type.startsWith('image/'));
        return (
        <section className={`${styles.round} ${responseTabs?styles['has-answer-navigation']:''}`} data-timeline-layout key={m.id}>
          <div className={`${styles['user-message']} ${imageAttachments.length?styles['with-images']:''}`}>
            <p><MentionText text={m.text} personas={personas} onMentionPersona={onMentionPersona}/></p>
            {imageAttachments.length>0&&<div className={styles['image-attachments']} data-count={Math.min(imageAttachments.length,4)}>{imageAttachments.map(item=><MessageImage key={item.version_id} attachment={item} gallery={imageAttachments} openArtifact={openArtifact} openWorkspace={openWorkspace}/>)}</div>}
            {fileAttachments.length>0&&<div className={styles.attachments}>{fileAttachments.map(item=><MessageAttachment key={item.version_id} attachment={item} gallery={m.attachments} openArtifact={openArtifact} openWorkspace={openWorkspace}/>)}</div>}
            <small>
              {new Date(m.createdAt).toLocaleTimeString("ru", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              ·{" "}
              {m.targets.length
                ? <>Invoked: <MentionText text={m.targets.map((x) => "@" + x).join(", ")} personas={personas} onMentionPersona={onMentionPersona}/></>
                : "No agents invoked"}
            </small>
          </div>
          {responseTabs&&<nav className={styles['answer-navigation']} aria-label="Agent responses in this round"><span>Responses</span>{visibleGroups.map(group=>{const response=state.runs[group.id];const responsePersona=byHandle.get(response.agent)??unknownPersona(response.agent);const selected=group.slot===focusedSlot;return <button type="button" key={group.slot} aria-pressed={selected} onClick={()=>setFocusedResponseSlots(current=>({...current,[m.id]:group.slot}))}><i style={{background:responsePersona.color}}/>{responsePersona.name}<StatusIcon status={response.status}/></button>})}</nav>}
          <div className={`${styles.runs} ${singleColumn?styles['runs-list']:styles['runs-grid']}`}>
            {displayedGroups.map(
              ({slot,attemptIds,activeAttempt,shownIndex,id}) => {
                const showAttempt=async(index:number)=>{const nextId=attemptIds[index];setAttemptView(current=>({...current,[slot]:nextId}));if(messageIndex===state.messages.length-1&&state.runs[nextId].status==='completed'&&gateway.mode==='real')await gateway.select(nextId)};
                const run=state.runs[id];
                return run && (
                  <div id={`run-${id}`} className={styles['run-anchor']} key={slot}>
                  <RunCard
                    key={id}
                    run={run}
                    persona={
                      byHandle.get(state.runs[id].agent) ??
                      unknownPersona(state.runs[id].agent)
                    }
                    select={() => select(id)}
                    cancel={() => gateway.cancel(id)}
                    addInstruction={()=>addInstructionToRun?.(id)}
                    canAddInstruction={Boolean(addInstructionToRun&&run.status==='streaming'&&harnessCatalog?.instances.find(instance=>instance.id===run.harnessInstanceId)?.interventionMode==='interrupt_then_continue'&&!(run.requests??[]).some(request=>!request.resolved)&&!run.interventions.some(intervention=>intervention.status==='pending'))}
                    retry={async()=>{setAttemptView(current=>{const next={...current};delete next[slot];return next});await gateway.retry(id)}}
                    canRetry={messageIndex===state.messages.length-1&&['completed','failed','cancelled'].includes(state.runs[id].status)&&!activeAttempt&&gateway.mode==='real'}
                    attemptIndex={shownIndex}
                    attemptCount={attemptIds.length}
                    previousAttempt={()=>void showAttempt(shownIndex-1)}
                    nextAttempt={()=>void showAttempt(shownIndex+1)}
                    resolve={(requestId,v) => gateway.resolve(id,requestId,v)}
                    collapsed={isCollapsed(run)}
                    toggleCollapsed={()=>{const collapse=!isCollapsed(run);setExpandedAnswers(current=>{const next=new Set(current);collapse?next.delete(id):next.add(id);return next});setCollapsedAnswers(current=>{const next=new Set(current);collapse?next.add(id):next.delete(id);return next});if(collapse)requestAnimationFrame(()=>document.getElementById(`run-${id}`)?.scrollIntoView({behavior:'smooth',block:'start'}))}}
                    harnessCatalog={harnessCatalog}
                    personas={personas}
                    onMentionPersona={onMentionPersona}
                    openWorkspace={openWorkspace}
                    openArtifact={openArtifact}
                    author={m.author}
                  />
                  </div>
                )},
            )}
          </div>
        </section>
        )})}
    </main>;
}
function formatBytes(value:number){if(value<1024)return`${value} B`;if(value<1024*1024)return`${(value/1024).toFixed(1)} KB`;return`${(value/1024/1024).toFixed(1)} MB`;}

function MessageAttachment({attachment,gallery,openArtifact,openWorkspace}:{attachment:WorkspaceAttachment;gallery?:WorkspaceAttachment[];openArtifact:OpenWorkspaceArtifact;openWorkspace:(target:WorkspaceTarget)=>void}){
  return <span className={styles.attachmentCard}>
    <button type="button" className={styles.attachmentPrimary} onClick={event=>openArtifact(attachment,gallery,event.currentTarget)}><Paperclip/><span>{attachment.name}</span><small>{formatBytes(attachment.size)}</small></button>
    <WorkspaceArtifactActions attachment={attachment} openWorkspace={openWorkspace}/>
  </span>;
}

function MessageImage({attachment,gallery,openArtifact,openWorkspace}:{attachment:WorkspaceAttachment;gallery:WorkspaceAttachment[];openArtifact:OpenWorkspaceArtifact;openWorkspace:(target:WorkspaceTarget)=>void}){
  return <span className={styles.messageImage}>
    <button type="button" onClick={event=>openArtifact(attachment,gallery,event.currentTarget)} title={`Open ${attachment.name}`}><img src={attachment.preview_url} alt={attachment.name} loading="lazy"/><span>{attachment.name}</span></button>
    <WorkspaceArtifactActions attachment={attachment} openWorkspace={openWorkspace}/>
  </span>;
}
