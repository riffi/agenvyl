import { useEffect, useState, type ReactNode } from 'react';
import { Ban, Check, CheckCircle2, CircleHelp, CircleX, Clock3, Copy, LoaderCircle, Settings2, TriangleAlert, Wrench } from 'lucide-react';
import type { HarnessCatalog } from '../../entities/harness';
import type { Persona } from '../../entities/persona';
import type { Run, RunStatus, ToolActivity } from '../../entities/run';
import { Avatar, Drawer } from '../../shared/ui';
import styles from './RunDrawer.module.css';

const statusCopy:Record<RunStatus,{title:string;description:string;tone:string}>={
  queued:{title:'Waiting to start',description:'The response is queued and will start soon.',tone:'active'},
  streaming:{title:'Preparing response',description:'The agent is working on your request.',tone:'active'},
  finalizing:{title:'Finalizing files',description:'Saving an immutable workspace snapshot and publishing non-conflicting changes.',tone:'active'},
  stopping:{title:'Stopping',description:'Finishing the agent’s current work.',tone:'warning'},
  waiting_approval:{title:'Approval required',description:'The agent needs permission before it can continue.',tone:'warning'},
  waiting_clarification:{title:'Clarification required',description:'The agent needs more information.',tone:'warning'},
  completed:{title:'Response ready',description:'The agent completed the work successfully.',tone:'success'},
  failed:{title:'Could not complete',description:'An error occurred while preparing the response.',tone:'error'},
  cancelled:{title:'Run cancelled',description:'The agent’s work was stopped.',tone:'neutral'},
};

const toolStatus:Record<ToolActivity['status'],string>={started:'Started',progress:'In progress',completed:'Completed'};

function modelInfo(run:Run|undefined,persona:Persona|undefined,harnessCatalog:HarnessCatalog|undefined){
  const route=run?.modelId??run?.requestedModel??persona?.model_id??persona?.requested_model;
  const full=(run?harnessCatalog?.instances.find(instance=>instance.id===run.harnessInstanceId)?.models.find(model=>model.id===run.modelId)?.label:undefined)??(!run?.requestedModel?persona?.effective_model:null)??route;
  return{route,full,short:full?.split('/').at(-1)??'Model not specified'};
}

const connectorStateCopy={
  active:'Connector is running the task',
  degraded:'Connector is waiting for the provider to recover',
  terminal:'Connector completed the run',
  unavailable:'Connector is unavailable',
  lost:'Connector lost the run',
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
function tokens(value:number|undefined){return value===undefined?'not reported':new Intl.NumberFormat('en-US').format(value);}

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
        {input&&<span><small>Input</small><pre>{input}</pre></span>}
        {detail&&<span><small>Details</small><pre>{detail}</pre></span>}
        <span><small>Call ID</small><code>{tool.id}</code></span>
      </div>
    </details>:<div className={styles['tool-summary']}><span><strong>{tool.name}</strong><small>No additional details were reported.</small></span><em>{toolStatus[tool.status]}</em></div>}
  </li>;
}

export function RunDrawer({run,persona,harnessCatalog,close}:{run?:Run;persona?:Persona;harnessCatalog?:HarnessCatalog;close:()=>void}) {
  const [copied,setCopied]=useState(false);
  useEffect(()=>setCopied(false),[run?.id]);
  const model=modelInfo(run,persona,harnessCatalog);
  const state=run?statusCopy[run.status]:undefined;
  const copyId=async()=>{if(!run)return;try{await navigator.clipboard.writeText(run.id);setCopied(true)}catch{/* Clipboard may be unavailable outside a secure context. */}};
  const active=run&&['queued','streaming','finalizing','stopping','waiting_approval','waiting_clarification'].includes(run.status);
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

        {run.upstreamStatus&&<section className={`${styles['status-card']} ${styles.warning}`} aria-live="polite"><TriangleAlert/><span><strong>Provider is retrying the request</strong><small>The run remains active; model status does not affect harness availability.</small></span></section>}

        {run.connector&&<section className={`${styles['connector-card']} ${styles[run.connector.state]}`}><Settings2/><span><strong>{connectorStateCopy[run.connector.state]}</strong><small>{run.connector.checkpointed?'State confirmed by a durable checkpoint in Core.':'No durable checkpoint was created.'}</small></span></section>}

        {run.error&&<section className={styles['error-card']}><CircleX/><span><strong>What happened</strong><p>{run.error}</p></span></section>}

        {run.request&&<section className={styles['request-card']}>
          {run.request.kind==='approval'?<TriangleAlert/>:<CircleHelp/>}
          <span><strong>{run.request.kind==='approval'?'Approval requested':'Clarification requested'}</strong><p>{run.request.prompt}</p>{run.request.directory&&<code>{run.request.directory}</code>}{run.request.resolved&&<small>Response received: {run.request.resolved}</small>}</span>
        </section>}

        <section className={styles.activity}>
          <h3><Wrench/>Activity</h3>
          {run.tools.length?<ol className={styles['activity-list']} tabIndex={0} aria-label="Tool activity">{run.tools.map(tool=><ToolItem key={tool.id} tool={tool}/>)}</ol>:<div className={styles.empty}><Wrench/><span><strong>{active?'No additional actions yet':'No additional tools were used'}</strong><small>{active?'Activity will appear here as the agent works.':'The response was prepared without tool calls.'}</small></span></div>}
        </section>

        <details className={styles.technical}>
          <summary><Settings2/>Technical information</summary>
          <dl>
            <div><dt>Harness</dt><dd><code>{run.harnessInstanceId} · {run.harnessType}</code></dd></div>
            <div><dt>Model snapshot</dt><dd><code>{run.modelId}</code></dd></div>
            <div><dt>Workflow snapshot</dt><dd><code>{run.executionProfile.workflowMode} · {run.executionProfile.planEnforcement??'standard'}</code></dd></div>
            <div><dt>Reasoning effort</dt><dd><code>{run.executionProfile.reasoningEffort??'Auto'}{run.executionProfile.reasoningEffortFallback?' (fallback)':''}</code></dd></div>
            <div><dt>Reasoning source</dt><dd><code>{run.executionProfile.reasoningEffortSource.replaceAll('_',' ')}</code></dd></div>
            {run.executionProfile.reasoningEffortFallback&&<div><dt>Requested effort</dt><dd><code>{run.executionProfile.requestedReasoningEffort}</code></dd></div>}
            <div><dt>Permissions</dt><dd><code>{run.executionProfile.permissionProfileId??'harness default'}</code></dd></div>
            <div><dt>Agent variant</dt><dd><code>{run.executionProfile.agentVariantId??'harness default'}</code></dd></div>
            {run.executionProfile.implementationPlanVersionId&&<div><dt>Implementation plan</dt><dd><code>{run.executionProfile.implementationPlanVersionId}</code></dd></div>}
            <div><dt>Attempt</dt><dd><code>{run.attemptNumber??1}</code></dd></div>
            <div><dt>Model route</dt><dd><code>{model.route??'not specified'}</code></dd></div>
            <div><dt>System status</dt><dd><code>{run.status}</code></dd></div>
            {run.usage&&<>
              <div><dt>Input tokens</dt><dd><code>{tokens(run.usage.inputTokens)}</code></dd></div>
              <div><dt>Output tokens</dt><dd><code>{tokens(run.usage.outputTokens)}</code></dd></div>
              <div><dt>Total tokens</dt><dd><code>{tokens(run.usage.totalTokens)}</code></dd></div>
              {run.usage.reasoningTokens!==undefined&&<div><dt>Reasoning tokens</dt><dd><code>{tokens(run.usage.reasoningTokens)}</code></dd></div>}
              {run.usage.cacheReadTokens!==undefined&&<div><dt>Cache read tokens</dt><dd><code>{tokens(run.usage.cacheReadTokens)}</code></dd></div>}
              {run.usage.cacheWriteTokens!==undefined&&<div><dt>Cache write tokens</dt><dd><code>{tokens(run.usage.cacheWriteTokens)}</code></dd></div>}
            </>}
            <div className={styles['run-id']}><dt>Run ID</dt><dd><code>{run.id}</code><button type="button" onClick={()=>void copyId()} title="Copy ID">{copied?<Check/>:<Copy/>}<span>{copied?'Copied':'Copy'}</span></button></dd></div>
          </dl>
        </details>
      </div>}
    </Drawer>
  </div>;
}
