import {useEffect,useRef,useState} from 'react';

import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';

import type {WorkspaceBuildPreview,WorkspaceRestorePreview,WorkspaceRestoreTarget} from '@agenvyl/contracts';

import {roomsApi} from '../../entities/room';

import {Alert,Button,Dialog} from '../../shared/ui';

import styles from './WorkspaceRestoreDialog.module.css';



export type WorkspaceRestoreChoice={target:WorkspaceRestoreTarget;label:string;recovery?:boolean};



export const WorkspaceRestoreDialog=({roomId,choice,builds,onClose,onRestored}:{roomId:string;choice:WorkspaceRestoreChoice;builds:WorkspaceBuildPreview[];onClose:()=>void;onRestored:()=>void})=>{

  const client=useQueryClient(),[preview,setPreview]=useState<WorkspaceRestorePreview>(),[requestId,setRequestId]=useState('');

  const [error,setError]=useState<string>(),container=useRef<HTMLDivElement>(null);

  const history=useQuery({queryKey:['rooms',roomId,'workspace','history'],queryFn:({signal})=>roomsApi.workspaceHistory(roomId,signal),refetchInterval:3000});

  const refresh=async()=>{await client.invalidateQueries({queryKey:['rooms',roomId,'workspace']});};

  const inspect=useMutation({mutationFn:(target:WorkspaceRestoreTarget)=>roomsApi.previewWorkspaceRestore(roomId,target),onSuccess:value=>{setPreview(value);setRequestId(crypto.randomUUID());setError(undefined);},onError:value=>setError(message(value))});

  const restore=useMutation({mutationFn:()=>roomsApi.restoreWorkspace(roomId,{target:preview!.target,fingerprint:preview!.fingerprint,requestId}),onSuccess:async()=>{await refresh();onRestored();},onError:async value=>{

    setError(message(value));

    if((value as {code?:string}).code==='workspace_restore_stale')setPreview(undefined);

    await refresh();

  }});

  const retry=useMutation({mutationFn:(id:string)=>roomsApi.retryWorkspaceRestore(roomId,id),onSuccess:async()=>{await refresh();onRestored();},onError:async value=>{setError(message(value));await refresh();}});

  const pending=inspect.isPending||restore.isPending||retry.isPending;

  const close=()=>{if(!pending)onClose();};

  const inspectTarget=inspect.mutate;

  useEffect(()=>{if(!choice.recovery)inspectTarget(choice.target);},[choice,inspectTarget]);

  useEffect(()=>{

    const panel=container.current?.querySelector<HTMLElement>('[role="dialog"]');

    const opener=document.activeElement as HTMLElement|null;

    panel?.querySelector<HTMLElement>('button')?.focus();

    const trap=(event:KeyboardEvent)=>{

      if(event.key!=='Tab'||!panel)return;

      const buttons=[...panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')],first=buttons[0],last=buttons.at(-1);

      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}

      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}

    };

    panel?.addEventListener('keydown',trap);

    return()=>{panel?.removeEventListener('keydown',trap);if(opener?.isConnected)opener.focus();};

  },[]);

  return <div ref={container} className={styles.overlay}>

    <Dialog title={choice.recovery?'Recover workspace?':'Restore workspace?'} labelledBy="workspace-restore-title" onClose={close}

      description={`${choice.label}. ${choice.target.kind==='run'?'Restore the workspace to before this run, including undoing later changes.':'Return to the state saved before this rollback.'}`}

      footer={<><Button disabled={pending} onClick={close}>Cancel</Button>{choice.recovery

        ?<Button disabled={pending} onClick={()=>retry.mutate(choice.target.id)}>{retry.isPending?'Recovering…':'Retry recovery'}</Button>

        :preview?<Button variant="danger" disabled={pending||Boolean(history.data?.unavailableReason)} onClick={()=>restore.mutate()}>{restore.isPending?'Restoring…':'Restore workspace'}</Button>

        :<Button disabled={pending||Boolean(history.data?.unavailableReason)} onClick={()=>inspect.mutate(choice.target)}>Refresh preview</Button>}</>}>

      <div className={styles.content} aria-busy={pending}>

        {error&&<Alert tone="error">{error}</Alert>}

        {history.error&&<Alert tone="error">{message(history.error)}</Alert>}

        {history.data?.unavailableReason&&<p role="status" className={styles.notice}>{history.data.unavailableReason}</p>}

        {inspect.isPending&&<p role="status">Loading changes…</p>}

        {preview&&<RestoreSummary preview={preview} builds={builds}/>}

        {choice.recovery&&<p>The interrupted restoration will resume from its saved checkpoint.</p>}

      </div>

    </Dialog>

  </div>;

};



const RestoreSummary=({preview,builds}:{preview:WorkspaceRestorePreview;builds:WorkspaceBuildPreview[]})=>{

  const index=builds.findIndex(build=>build.runId===preview.previewRunId),build=index<0?undefined:builds[index];

  return <div className={styles.summary}>

  <section><h3>Files to restore · {preview.changes.length}</h3>

    {preview.changes.length?<ul>{preview.changes.map(change=><li key={change.path}><span className={styles[change.change]}>{change.change==='created'?'Add':change.change==='deleted'?'Delete':'Update'}</span><code>{change.path}</code></li>)}</ul>:<p>Tracked files already match this state.</p>}

    {preview.savesUncommittedChanges&&<p>Uncommitted changes and new tracked files will be saved before restoring.</p>}

  </section>

  <section><h3>Affected runs · {preview.affectedRuns.length}</h3><ul>{preview.affectedRuns.map(run=><li key={run.id}><strong>@{run.agent}</strong><span>{formatDate(run.createdAt)} · {run.status}</span></li>)}</ul></section>

  <section><h3>App preview</h3><p>{preview.previewRunId?build?`Build #${builds.length-index} · @${build.agent} · ${formatDate(build.createdAt)} will become current.`:`The saved build${preview.previewAgent?` by @${preview.previewAgent}`:''} will become current.`:'No saved build matches this state. Build the restored source to create a preview.'}</p></section>

  <p className={styles.notice}>Ignored files, dependencies, local databases and external actions are not restored. Existing build output stays in the folder.</p>

</div>;

};

const formatDate=(value:string)=>new Date(value).toLocaleString([],{dateStyle:'medium',timeStyle:'short'});

const message=(error:unknown)=>error instanceof Error?error.message:String(error);

