import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Ban, Brain, ChevronDown, ChevronUp, CircleCheck, CircleHelp, CircleX, Clock3, File, FoldVertical, Info, LoaderCircle, Paperclip, RotateCcw, Square, TriangleAlert, UnfoldVertical, Wrench } from 'lucide-react';
import type {UpstreamStatus} from '@agenvyl/contracts';
import type { HarnessCatalog } from '../../entities/harness';
import type { Persona } from '../../entities/persona';
import type { RoomState } from '../../entities/room';
import type { Run } from '../../entities/run';
import type { RoomGateway } from '../../features/room-session';
import { Alert, Avatar, Button, EmptyState, IconButton, Input } from '../../shared/ui';
import styles from './Timeline.module.css';
import { isLongAnswer, shouldUseSingleColumn } from './layout';
import { MarkdownAnswer } from './MarkdownAnswer';
import {MentionText} from './mentions';

export { MarkdownAnswer } from './MarkdownAnswer';

const statusLabel: Record<Run['status'], string> = {
  queued: 'в очереди',
  streaming: 'пишет',
  stopping: 'останавливается',
  waiting_approval: 'ждёт approval',
  waiting_clarification: 'нужно уточнение',
  completed: 'готово',
  failed: 'ошибка',
  cancelled: 'отменён',
};

const activeStatuses = new Set<Run['status']>(['queued', 'streaming', 'stopping']);

function StatusIcon({status}:{status:Run['status']}) {
  const label=statusLabel[status];
  const icon=activeStatuses.has(status)
    ? <LoaderCircle />
    : status==='completed'
      ? <CircleCheck />
      : status==='failed'
        ? <CircleX />
        : status==='cancelled'
          ? <Ban />
          : status==='waiting_approval'
            ? <TriangleAlert />
            : status==='waiting_clarification'
              ? <CircleHelp />
              : <Clock3 />;
  return <span className={`${styles['status-icon']} ${styles[status]} ${activeStatuses.has(status)?styles.spinning:''}`} role="img" aria-label={`Статус: ${label}`} title={label}>{icon}</span>;
}

function catalogModel(run:Run,catalog:HarnessCatalog|undefined){return catalog?.instances.find(instance=>instance.id===run.harnessInstanceId)?.models.find(model=>model.id===run.modelId)?.label;}

function modelName(run:Run,persona:Persona,catalog:HarnessCatalog|undefined) {
  const route=run.modelId??run.requestedModel??persona.model_id??persona.requested_model;
  const value=catalogModel(run,catalog)??(!run.requestedModel?persona.effective_model:null)??route;
  if(!value)return 'модель не задана';
  return value.split('/').at(-1)??value;
}

function fullModelName(run:Run,persona:Persona,catalog:HarnessCatalog|undefined) {
  const route=run.modelId??run.requestedModel??persona.model_id??persona.requested_model;
  return catalogModel(run,catalog)??(!run.requestedModel?persona.effective_model:null)??route??undefined;
}

const unknownPersona = (handle: string): Persona => ({
  id: '', handle, name: `@${handle}`, role: 'Персона недоступна', color: '#64748b', requested_model: null, harness_instance_id:'unknown',harness_type:'unknown',model_id:'unknown',mode_id:null,group_id:null, archived_at: null,
});

export function ReasoningBlock({text}:{text:string}) {
  return <details className={styles.reasoning}>
    <summary><Brain/>Ход рассуждений</summary>
    <pre>{text}</pre>
  </details>;
}

export function UpstreamStatusNotice({status}:{status:UpstreamStatus}) {
  const text=status.state==='waiting_upstream'
    ? 'Ожидаем ответа провайдера…'
    : status.reason==='rate_limited'
      ? 'Провайдер ограничил частоту запросов. Повторная попытка…'
      : status.reason==='authentication_failed'
        ? 'Провайдер отклонил авторизацию. Повторная попытка…'
        : status.reason==='provider_timeout'
          ? 'Провайдер не ответил вовремя. Повторная попытка…'
          : status.reason==='model_unavailable'
            ? 'Модель временно недоступна. Повторная попытка…'
            : 'Провайдер временно недоступен. Повторная попытка…';
  return <div className={styles['upstream-status']} role="status" aria-live="polite"><RotateCcw/><span>{text}{status.attempt!==undefined&&<small>Попытка {status.attempt}</small>}</span></div>;
}

function Request({ run, resolve }: { run: Run; resolve: (v: string) => void }) {
  const [reply, setReply] = useState("");
  if (!run.request) return null;
  return (
    <div className={`${styles.request} ${styles[run.request.kind] ?? ''}`}>
      <strong>{run.request.kind === "approval"
        ? <><TriangleAlert /> Подтверждение действия</>
        : <><CircleHelp /> Уточнение от агента</>}</strong>
      <p>{run.request.prompt}</p>
      {run.request.resolved ? (
        <small>Ответ: {run.request.resolved}</small>
      ) : run.request.kind === "approval" ? (
        <div>
          <Button variant="primary" size="sm" onClick={() => resolve("approved")}>
            Разрешить
          </Button>
          <Button size="sm" onClick={() => resolve("denied")}>Отклонить</Button>
        </div>
      ) : (<>
        {run.request.choices?.length ? <div className={styles['request-choices']}>{run.request.choices.map(choice=><Button key={choice} type="button" size="sm" onClick={()=>setReply(choice)}>{choice}</Button>)}</div> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim()) resolve(reply.trim());
          }}
        >
          <Input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Ваш ответ…"
          />
          <Button variant="primary" size="sm">Ответить</Button>
        </form>
      </>)}
    </div>
  );
}
function RunCard({
  run,
  persona,
  select,
  cancel,
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
}: {
  run: Run;
  persona: Persona;
  select: () => void;
  cancel: () => void;
  retry: () => Promise<void>;
  canRetry:boolean;
  attemptIndex:number;
  attemptCount:number;
  previousAttempt:()=>void;
  nextAttempt:()=>void;
  resolve: (v: string) => void;
  collapsed:boolean;
  toggleCollapsed:()=>void;
  harnessCatalog?:HarnessCatalog;
  personas:Persona[];
  onMentionPersona:(handle:string)=>void;
}) {
  const [retrying,setRetrying]=useState(false);const [retryError,setRetryError]=useState<string>();const [toolsOpen,setToolsOpen]=useState(false);
  const answer = run.text || (run.status === "queued" ? "Ожидает свободный слот…" : "Анализирую…");
  const canCancel=['queued','streaming','waiting_approval','waiting_clarification'].includes(run.status);
  const retryLabel=run.status==='completed'?'Создать другой вариант':'Запустить снова';
  const retryRun=async()=>{setRetrying(true);setRetryError(undefined);try{await retry()}catch(error){setRetryError(error instanceof Error?error.message:String(error))}finally{setRetrying(false)}};
  return (
    <article
      className={`${styles['run-card']} ${styles[run.status]}`}
      ui-spec-block-id="agent_response_card"
    >
      <Avatar label={persona.name} color={persona.color} />
      <div className={styles['run-body']}>
        <header className={styles['run-header']}>
          <span className={styles['run-identity']}>
            <strong style={{ color: persona.color }}>{persona.name}</strong>
            <small className={styles['model-label']} title={fullModelName(run,persona,harnessCatalog)}>{modelName(run,persona,harnessCatalog)}</small>
          </span>
          <span className={styles['run-header-actions']}>
            <StatusIcon status={run.status}/>
            {(canCancel||canRetry)&&<span className={styles['run-actions']}>
              {canCancel&&<IconButton className={styles['stop-run']} onClick={cancel} title="Остановить" aria-label={`Остановить ответ ${persona.name}`}><Square/></IconButton>}
              {canRetry&&<IconButton className={styles['retry-run']} disabled={retrying} onClick={()=>void retryRun()} title={retrying?'Запускаем…':retryLabel} aria-label={`${retryLabel}: ${persona.name}`}>{retrying?<LoaderCircle className={styles['action-spinner']}/>:<RotateCcw/>}</IconButton>}
            </span>}
          </span>
        </header>
        {run.reasoning&&<ReasoningBlock text={run.reasoning}/>}
        {run.upstreamStatus&&<UpstreamStatusNotice status={run.upstreamStatus}/>}
        <div className={`${styles.answer} ${collapsed?styles['answer-collapsed']:''}`}>
          <MarkdownAnswer text={answer} run={run} personas={personas} onMentionPersona={onMentionPersona}/>
          {run.status === "streaming" && <i className={styles.cursor} />}
        </div>
        {isLongAnswer(run.text)&&run.status==='completed'&&<button className={`${styles['answer-toggle']} ${collapsed?styles.expand:styles.collapse}`} type="button" onClick={toggleCollapsed} aria-expanded={!collapsed}>{collapsed?<><span>Развернуть ответ</span><ChevronDown/></>:<><span>Свернуть ответ</span><ChevronUp/></>}</button>}
        {run.error && <Alert tone="error">{run.error}</Alert>}
        <Request run={run} resolve={resolve} />
        {run.artifacts?.some(item=>item.attribution==='exact'&&!run.embeds?.some(embed=>embed.status==='resolved'&&embed.attachment?.version_id===item.version_id))&&<div className={styles.artifacts}>{run.artifacts.filter(item=>item.attribution==='exact'&&!run.embeds?.some(embed=>embed.status==='resolved'&&embed.attachment?.version_id===item.version_id)).map(item=><a key={item.version_id} href={item.preview_url} target="_blank" rel="noreferrer"><File/><span><strong>{item.name}</strong><small>{item.change==='created'?'Создан':item.change==='updated'?'Изменён':'Удалён'}</small></span></a>)}</div>}
        <div className={styles['run-footer']}>
          <span className={styles['run-footer-actions']}>
            {run.tools.length>0&&<button type="button" className={styles['footer-action']} onClick={()=>setToolsOpen(open=>!open)} aria-expanded={toolsOpen} aria-controls={`run-tools-${run.id}`}><Wrench/><span>Действия</span><em>{run.tools.length}</em>{toolsOpen?<ChevronUp className={styles.disclosure}/>:<ChevronDown className={styles.disclosure}/>}</button>}
            <button type="button" className={styles['footer-action']} onClick={select}><Info/><span>Детали запуска</span></button>
          </span>
          {attemptCount>1&&<span className={styles['attempt-carousel']}><IconButton onClick={previousAttempt} disabled={attemptIndex===0} aria-label="Предыдущая попытка">‹</IconButton><small>{attemptIndex+1} из {attemptCount}</small><IconButton onClick={nextAttempt} disabled={attemptIndex===attemptCount-1} aria-label="Следующая попытка">›</IconButton></span>}
        </div>
        {run.tools.length>0&&toolsOpen&&<div id={`run-tools-${run.id}`} className={styles['tool-activity']}>
          {run.tools.map(tool=><div key={tool.id}><i className={tool.status}/><span><strong>{tool.name}</strong><small>{tool.detail}</small></span><em>{tool.status}</em></div>)}
        </div>}
        {retryError&&<Alert tone="error">{retryError}</Alert>}
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
}) {
  const byHandle = new Map(personas.map((p) => [p.handle, p]));
  const [attemptView,setAttemptView]=useState<Record<string,string>>({});
  const [expandedAnswers,setExpandedAnswers]=useState<Set<string>>(()=>new Set());
  const [collapsedAnswers,setCollapsedAnswers]=useState<Set<string>>(()=>new Set());
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
      {loadingOlder&&<div className={styles.reconnect}>Загружаем предыдущие сообщения…</div>}
      {state.messages.length === 0 && !initialLoading && (
        <EmptyState compact title="Начните диалог" description={<p>
            Упомяните <code>@handle</code> или <code>@all</code>, чтобы вызвать
            персон параллельно.
          </p>} />
      )}
      {initialLoading&&<div className={styles.reconnect}>Загружаем историю…</div>}
      {state.connection !== "connected" && (
        <div className={styles.reconnect}>
          <RotateCcw />{" "}
          {state.connection === "connecting"
            ? "Подключаемся к комнате…"
            : state.connection === "reconnecting"
              ? "Соединение потеряно. Переподключаемся…"
              : "Восстанавливаем события…"}
        </div>
      )}
      {state.messages.map((m,messageIndex) => {
        const groups=Object.entries(m.runIds.reduce<Record<string,string[]>>((result,id)=>{const run=state.runs[id];if(!run)return result;const slot=slotOf(run);(result[slot]??=[]).push(id);return result},{}));
        const visibleGroups=groups.map(([slot,attemptIds])=>{const activeAttempt=[...attemptIds].reverse().map(id=>state.runs[id]).find((run:Run)=>['queued','streaming','stopping','waiting_approval','waiting_clarification'].includes(run.status));const shownId=activeAttempt?.id??attemptView[slot]??state.selectedRuns[slot]??attemptIds.at(-1)!;const shownIndex=Math.max(0,attemptIds.indexOf(shownId));return{slot,attemptIds,activeAttempt,shownIndex,id:attemptIds[shownIndex]}});
        const visibleRuns=visibleGroups.flatMap(group=>state.runs[group.id]?[state.runs[group.id]]:[]);
        visibleRuns.forEach(run=>{if(run.status==='streaming')streamedRunsRef.current.add(run.id)});
        const longRuns=visibleRuns.filter(run=>isLongAnswer(run.text)&&run.status==='completed');
        const isCollapsed=(run:Run)=>isLongAnswer(run.text)&&run.status==='completed'&&(collapsedAnswers.has(run.id)||(!expandedAnswers.has(run.id)&&!streamedRunsRef.current.has(run.id)));
        const setLongRunsExpanded=(expanded:boolean)=>{setExpandedAnswers(current=>{const next=new Set(current);longRuns.forEach(run=>expanded?next.add(run.id):next.delete(run.id));return next});setCollapsedAnswers(current=>{const next=new Set(current);longRuns.forEach(run=>expanded?next.delete(run.id):next.add(run.id));return next})};
        const singleColumn=shouldUseSingleColumn(visibleRuns.map(run=>run.text));
        const imageAttachments=(m.attachments??[]).filter(item=>item.mime_type.startsWith('image/'));
        const fileAttachments=(m.attachments??[]).filter(item=>!item.mime_type.startsWith('image/'));
        return (
        <section className={`${styles.round} ${longRuns.length?styles['has-answer-navigation']:''}`} data-timeline-layout key={m.id}>
          <div className={`${styles['user-message']} ${imageAttachments.length?styles['with-images']:''}`}>
            <p><MentionText text={m.text} personas={personas} onMentionPersona={onMentionPersona}/></p>
            {imageAttachments.length>0&&<div className={styles['image-attachments']} data-count={Math.min(imageAttachments.length,4)}>{imageAttachments.map(item=><a href={item.preview_url} target="_blank" rel="noreferrer" key={item.version_id} title={`Открыть ${item.name}`}><img src={item.preview_url} alt={item.name} loading="lazy"/><span>{item.name}</span></a>)}</div>}
            {fileAttachments.length>0&&<div className={styles.attachments}>{fileAttachments.map(item=><a href={item.preview_url} target="_blank" rel="noreferrer" key={item.version_id}><Paperclip/><span>{item.name}</span><small>{formatBytes(item.size)}</small></a>)}</div>}
            <small>
              {new Date(m.createdAt).toLocaleTimeString("ru", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              ·{" "}
              {m.targets.length
                ? <>Вызваны: <MentionText text={m.targets.map((x) => "@" + x).join(", ")} personas={personas} onMentionPersona={onMentionPersona}/></>
                : "Без запуска агентов"}
            </small>
          </div>
          {longRuns.length>0&&<nav className={styles['answer-navigation']} aria-label="Длинные ответы раунда"><span>Ответы:</span>{longRuns.map(run=><button type="button" key={run.id} onClick={()=>document.getElementById(`run-${run.id}`)?.scrollIntoView({behavior:'smooth',block:'start'})}>{byHandle.get(run.agent)?.name??`@${run.agent}`}</button>)}{longRuns.length>1&&<span className={styles['answer-navigation-actions']}><button type="button" aria-label="Развернуть все длинные ответы" title="Развернуть все" onClick={()=>setLongRunsExpanded(true)}><UnfoldVertical/></button><button type="button" aria-label="Свернуть все длинные ответы" title="Свернуть длинные" onClick={()=>setLongRunsExpanded(false)}><FoldVertical/></button></span>}</nav>}
          <div className={`${styles.runs} ${singleColumn?styles['runs-list']:styles['runs-grid']}`}>
            {visibleGroups.map(
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
                    retry={async()=>{setAttemptView(current=>{const next={...current};delete next[slot];return next});await gateway.retry(id)}}
                    canRetry={messageIndex===state.messages.length-1&&['completed','failed','cancelled'].includes(state.runs[id].status)&&!activeAttempt&&gateway.mode==='real'}
                    attemptIndex={shownIndex}
                    attemptCount={attemptIds.length}
                    previousAttempt={()=>void showAttempt(shownIndex-1)}
                    nextAttempt={()=>void showAttempt(shownIndex+1)}
                    resolve={(v) => gateway.resolve(id, v)}
                    collapsed={isCollapsed(run)}
                    toggleCollapsed={()=>{const collapse=!isCollapsed(run);setExpandedAnswers(current=>{const next=new Set(current);collapse?next.delete(id):next.add(id);return next});setCollapsedAnswers(current=>{const next=new Set(current);collapse?next.add(id):next.delete(id);return next});if(collapse)requestAnimationFrame(()=>document.getElementById(`run-${id}`)?.scrollIntoView({behavior:'smooth',block:'start'}))}}
                    harnessCatalog={harnessCatalog}
                    personas={personas}
                    onMentionPersona={onMentionPersona}
                  />
                  </div>
                )},
            )}
          </div>
        </section>
        )})}
    </main>;
}
function formatBytes(value:number){if(value<1024)return`${value} Б`;if(value<1024*1024)return`${(value/1024).toFixed(1)} КБ`;return`${(value/1024/1024).toFixed(1)} МБ`;}
