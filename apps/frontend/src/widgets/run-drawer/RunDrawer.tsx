import { useEffect, useState, type ReactNode } from 'react';
import { Ban, Check, CheckCircle2, CircleHelp, CircleX, Clock3, Copy, LoaderCircle, Settings2, TriangleAlert, Wrench } from 'lucide-react';
import type { HarnessCatalog } from '../../entities/harness';
import type { Persona } from '../../entities/persona';
import type { Run, RunStatus, ToolActivity } from '../../entities/run';
import { Avatar, Drawer } from '../../shared/ui';
import styles from './RunDrawer.module.css';

const statusCopy:Record<RunStatus,{title:string;description:string;tone:string}>={
  queued:{title:'Ожидает запуска',description:'Ответ добавлен в очередь и скоро начнёт выполняться.',tone:'active'},
  streaming:{title:'Готовит ответ',description:'Агент работает над вашим запросом.',tone:'active'},
  stopping:{title:'Останавливается',description:'Завершаем текущую работу агента.',tone:'warning'},
  waiting_approval:{title:'Требуется подтверждение',description:'Агент ждёт разрешения, прежде чем продолжить.',tone:'warning'},
  waiting_clarification:{title:'Нужно уточнение',description:'Агенту требуется дополнительная информация.',tone:'warning'},
  completed:{title:'Ответ готов',description:'Агент успешно завершил работу.',tone:'success'},
  failed:{title:'Не удалось завершить',description:'Во время подготовки ответа произошла ошибка.',tone:'error'},
  cancelled:{title:'Запуск отменён',description:'Работа агента была остановлена.',tone:'neutral'},
};

const toolStatus:Record<ToolActivity['status'],string>={started:'Запущено',progress:'Выполняется',completed:'Готово'};

function modelInfo(run:Run|undefined,persona:Persona|undefined,harnessCatalog:HarnessCatalog|undefined){
  const route=run?.modelId??run?.requestedModel??persona?.model_id??persona?.requested_model;
  const full=(run?harnessCatalog?.instances.find(instance=>instance.id===run.harnessInstanceId)?.models.find(model=>model.id===run.modelId)?.label:undefined)??(!run?.requestedModel?persona?.effective_model:null)??route;
  return{route,full,short:full?.split('/').at(-1)??'Модель не указана'};
}

const connectorStateCopy={
  active:'Connector выполняет запуск',
  degraded:'Connector ждёт восстановления provider',
  terminal:'Connector завершил запуск',
  unavailable:'Connector недоступен',
  lost:'Выполнение Connector потеряно',
} as const;

function StatusGlyph({status}:{status:RunStatus}) {
  const className=['queued','streaming'].includes(status)?styles.spinning:undefined;
  const icon:ReactNode=status==='completed'?<CheckCircle2/>:status==='failed'?<CircleX/>:status==='cancelled'?<Ban/>:status==='waiting_approval'?<TriangleAlert/>:status==='waiting_clarification'?<CircleHelp/>:status==='stopping'?<Clock3/>:<LoaderCircle/>;
  return <span className={className}>{icon}</span>;
}

function ToolGlyph({status}:{status:ToolActivity['status']}) {
  return <span className={status==='completed'?styles['tool-completed']:styles.spinning}>{status==='completed'?<Check/>:<LoaderCircle/>}</span>;
}

function readableToolDetail(detail:string) {
  if(!detail.trim())return '';
  try{return JSON.stringify(JSON.parse(detail),null,2)}catch{return detail}
}
function tokens(value:number|undefined){return value===undefined?'не передано':new Intl.NumberFormat('ru-RU').format(value);}

function ToolItem({tool}:{tool:ToolActivity}) {
  const detail=readableToolDetail(tool.detail);
  const input=readableToolDetail(tool.input??'');
  const preview=tool.detail||input.replace(/\s+/g,' ');
  return <li className={styles['tool-item']}>
    <ToolGlyph status={tool.status}/>
    {detail||input?<details>
      <summary>
        <span><strong>{tool.name}</strong><small>{preview}</small></span>
        <em>{toolStatus[tool.status]}</em>
      </summary>
      <div className={styles['tool-details']}>
        {input&&<span><small>Входные данные</small><pre>{input}</pre></span>}
        {detail&&<span><small>Подробности</small><pre>{detail}</pre></span>}
        <span><small>ID вызова</small><code>{tool.id}</code></span>
      </div>
    </details>:<div className={styles['tool-summary']}><span><strong>{tool.name}</strong><small>Дополнительные сведения не переданы.</small></span><em>{toolStatus[tool.status]}</em></div>}
  </li>;
}

export function RunDrawer({run,persona,harnessCatalog,close}:{run?:Run;persona?:Persona;harnessCatalog?:HarnessCatalog;close:()=>void}) {
  const [copied,setCopied]=useState(false);
  useEffect(()=>setCopied(false),[run?.id]);
  const model=modelInfo(run,persona,harnessCatalog);
  const state=run?statusCopy[run.status]:undefined;
  const copyId=async()=>{if(!run)return;try{await navigator.clipboard.writeText(run.id);setCopied(true)}catch{/* Clipboard may be unavailable outside a secure context. */}};
  const active=run&&['queued','streaming','stopping','waiting_approval','waiting_clarification'].includes(run.status);
  return <div className={styles.root}>
    <Drawer
      open={Boolean(run)}
      title={<span className={styles.title}><span>{persona?.name??`@${run?.agent??''}`}</span><small title={model.full??undefined}>{model.short}</small></span>}
      leading={persona?<Avatar label={persona.name} color={persona.color} size="sm"/>:undefined}
      onClose={close}
    >
      {run&&state&&<div className={styles.details}>
        <section className={`${styles['status-card']} ${styles[state.tone]}`} aria-live="polite">
          <StatusGlyph status={run.status}/>
          <span><strong>{state.title}</strong><small>{state.description}</small></span>
        </section>

        {run.upstreamStatus&&<section className={`${styles['status-card']} ${styles.warning}`} aria-live="polite"><TriangleAlert/><span><strong>Провайдер повторяет запрос</strong><small>Запуск остаётся активным; состояние модели не влияет на доступность harness.</small></span></section>}

        {run.connector&&<section className={`${styles['connector-card']} ${styles[run.connector.state]}`}><Settings2/><span><strong>{connectorStateCopy[run.connector.state]}</strong><small>{run.connector.checkpointed?'Состояние подтверждено durable checkpoint в Core.':'Durable checkpoint не был создан.'}</small></span></section>}

        {run.error&&<section className={styles['error-card']}><CircleX/><span><strong>Что произошло</strong><p>{run.error}</p></span></section>}

        {run.request&&<section className={styles['request-card']}>
          {run.request.kind==='approval'?<TriangleAlert/>:<CircleHelp/>}
          <span><strong>{run.request.kind==='approval'?'Запрошено подтверждение':'Запрошено уточнение'}</strong><p>{run.request.prompt}</p>{run.request.resolved&&<small>Ответ получен: {run.request.resolved}</small>}</span>
        </section>}

        <section className={styles.activity}>
          <h3><Wrench/>Активность</h3>
          {run.tools.length?<ol>{run.tools.map(tool=><ToolItem key={tool.id} tool={tool}/>)}</ol>:<div className={styles.empty}><Wrench/><span><strong>{active?'Пока без дополнительных действий':'Дополнительные инструменты не использовались'}</strong><small>{active?'Активность появится здесь по мере работы агента.':'Ответ был подготовлен без вызова инструментов.'}</small></span></div>}
        </section>

        <details className={styles.technical}>
          <summary><Settings2/>Техническая информация</summary>
          <dl>
            <div><dt>Harness</dt><dd><code>{run.harnessInstanceId} · {run.harnessType}</code></dd></div>
            <div><dt>Модель snapshot</dt><dd><code>{run.modelId}</code></dd></div>
            <div><dt>Режим snapshot</dt><dd><code>{run.modeId??'не задан'}</code></dd></div>
            <div><dt>Попытка</dt><dd><code>{run.attemptNumber??1}</code></dd></div>
            <div><dt>Маршрут модели</dt><dd><code>{model.route??'не указан'}</code></dd></div>
            <div><dt>Системный статус</dt><dd><code>{run.status}</code></dd></div>
            {run.usage&&<>
              <div><dt>Input tokens</dt><dd><code>{tokens(run.usage.inputTokens)}</code></dd></div>
              <div><dt>Output tokens</dt><dd><code>{tokens(run.usage.outputTokens)}</code></dd></div>
              <div><dt>Total tokens</dt><dd><code>{tokens(run.usage.totalTokens)}</code></dd></div>
              {run.usage.reasoningTokens!==undefined&&<div><dt>Reasoning tokens</dt><dd><code>{tokens(run.usage.reasoningTokens)}</code></dd></div>}
              {run.usage.cacheReadTokens!==undefined&&<div><dt>Cache read tokens</dt><dd><code>{tokens(run.usage.cacheReadTokens)}</code></dd></div>}
              {run.usage.cacheWriteTokens!==undefined&&<div><dt>Cache write tokens</dt><dd><code>{tokens(run.usage.cacheWriteTokens)}</code></dd></div>}
            </>}
            <div className={styles['run-id']}><dt>ID запуска</dt><dd><code>{run.id}</code><button type="button" onClick={()=>void copyId()} title="Скопировать ID">{copied?<Check/>:<Copy/>}<span>{copied?'Скопировано':'Скопировать'}</span></button></dd></div>
          </dl>
        </details>
      </div>}
    </Drawer>
  </div>;
}
