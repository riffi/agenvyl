import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Code2,Download,ExternalLink,Eye,Monitor,MoreHorizontal,PanelLeft,Paperclip,Play,RefreshCw,Settings,Smartphone,X} from 'lucide-react';
import type {ProjectFile,ProjectSummary,WorkspaceAttachment} from '@agenvyl/contracts';
import {projectFilesApi} from '../../entities/project';
import {useProjectReferenceActions} from '../../shared/project-references/ProjectReferenceContext';
import {AppPreviewDevice} from './WorkspaceAppPreview';
import {IconButton} from '../../shared/ui';
import {isolatedPreviewUrl,useRuntimeFeatures} from '../../shared/features';
import {WorkspaceContent} from './WorkspaceContent';
import {ProjectExplorer} from './ProjectExplorer';
import {ProjectBuildSettings} from './ProjectBuildSettings';
import {defaultWorkspaceMode,workspaceModesFor,type WorkspaceOpenRequest,type WorkspaceRequestUpdate} from './workspaceModel';
import styles from './WorkspaceWindow.module.css';
import projectStyles from './ProjectWindow.module.css';

export function ProjectWindow({project,roomId,request,revision,source,onClose,onRequestChange,onAttach}:{project:ProjectSummary;roomId:string;request:WorkspaceOpenRequest;revision?:string;source:ReactNode;onClose:()=>void;onRequestChange:(value:WorkspaceRequestUpdate)=>void;onAttach?: (attachment:WorkspaceAttachment)=>void}){
  const client=useQueryClient(),menu=useRef<HTMLDetailsElement>(null),windowRef=useRef<HTMLElement>(null);
  const[settings,setSettings]=useState(false),[showLog,setShowLog]=useState(false),[refresh,setRefresh]=useState(0),[error,setError]=useState('');
  const[selection,setSelection]=useState<ProjectFile>();
  const referenceActions=useProjectReferenceActions();
  const reference=request.projectReference;
  const selectedPath=selection?.path??reference?.path;
  useEffect(()=>setSelection(undefined),[reference?.path,reference?.kind]);
  const referenceFile=(file:ProjectFile)=>referenceActions?.insert({projectId:project.id,projectName:project.name,root:project.path,path:file.path,kind:file.kind});
  const[device,setDevice]=useState<'desktop'|'mobile'>('desktop');
  const {preview_origin:previewOrigin}=useRuntimeFeatures();
  const section=request.section??'app',tree=request.treeVisible!==false;
  const inspection=useQuery({queryKey:['project-files',project.id,'inspection'],queryFn:({signal})=>projectFilesApi.inspect(project.id,signal),refetchOnWindowFocus:false});
  const build=useQuery({queryKey:['project-files',project.id,'build'],queryFn:({signal})=>projectFilesApi.buildStatus(project.id,signal),refetchInterval:2000});
  const parent=selectedPath?.includes('/')?selectedPath.slice(0,selectedPath.lastIndexOf('/')):'';
  const selectedDirectory=useQuery({queryKey:['project-files',project.id,'directory',parent],queryFn:({signal})=>projectFilesApi.list(project.id,parent,signal),enabled:Boolean(selectedPath),refetchInterval:3000});
  const selected=selectedDirectory.error?undefined:selectedDirectory.data?.entries.find(file=>file.kind==='file'&&file.path===selectedPath)??(!selectedDirectory.data?selection:undefined);
  const referencedFolder=reference?.kind==='directory'&&selectedDirectory.data?.entries.some(file=>file.path===selectedPath&&file.kind==='directory');
  const emptyMessage=!selectedPath?'Select a file':selectedDirectory.isPending?'Loading file…':selectedDirectory.error?.message??(referencedFolder?`Folder: ${selectedPath}`:'Referenced file or folder is no longer available');
  const previousBuild=useRef<string|undefined>(undefined);
  const refreshAll=()=>{setRefresh(value=>value+1);void client.invalidateQueries({queryKey:['project-files',project.id]});};
  useEffect(()=>{setRefresh(value=>value+1);void client.invalidateQueries({queryKey:['project-files',project.id]});},[revision,project.id,client]);
  useEffect(()=>{
    const signature=build.data?`${build.data.id}:${build.data.status}`:undefined;
    if(signature&&previousBuild.current&&signature!==previousBuild.current&&build.data?.status!=='running'){setRefresh(value=>value+1);void client.invalidateQueries({queryKey:['project-files',project.id,'inspection']});}
    previousBuild.current=signature;
  },[build.data?.id,build.data?.status,client,project.id]);
  useEffect(()=>{
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';windowRef.current?.focus();
    return()=>{document.body.style.overflow=overflow;request.opener?.isConnected&&request.opener.focus();};
  },[request.opener]);
  const operation=useMutation({mutationFn:async(action:()=>Promise<unknown>)=>action(),onSuccess:()=>{void client.invalidateQueries({queryKey:['project-files',project.id]});},onError:error=>setError(error.message)});
  const startBuild=()=>{setShowLog(true);setError('');operation.mutate(async()=>{const next=await projectFilesApi.build(project.id);client.setQueryData(['project-files',project.id,'build'],next);});};
  const attachment:WorkspaceAttachment|undefined=selected?{version_id:`${selected.path}:${selected.modified}:${selected.size}`,name:selected.name,path:selected.path,size:selected.size,mime_type:selected.mime_type,url:projectFilesApi.fileUrl(project.id,selected.path,selected.modified),preview_url:projectFilesApi.fileUrl(project.id,selected.path,selected.modified,true)}:undefined;
  const mode=request.mode??(attachment?(/\.html?$/i.test(attachment.path)?'source':defaultWorkspaceMode(attachment)):'source');
  const modes=attachment?workspaceModesFor(attachment):[];
  const choose=(file:ProjectFile)=>{setSelection(file);onRequestChange({section:'files',mode:/\.html?$/i.test(file.path)?'source':defaultWorkspaceMode(file),...(matchMedia('(max-width: 899px)').matches?{treeVisible:false}:{})});};
  const entry=inspection.data?.entrypoint;
  const previewUrl=entry?`${projectFilesApi.previewUrl(project.id,entry)}?refresh=${refresh}`:undefined;
  const externalPreviewUrl=previewUrl?isolatedPreviewUrl(previewUrl,previewOrigin):undefined;
  const action=(callback:()=>void)=>()=>{menu.current?.removeAttribute('open');callback();};
  return createPortal(<section ref={windowRef} tabIndex={-1} className={styles.window} role="dialog" aria-modal="true" aria-label="Project files and preview" onKeyDown={event=>{
    if(event.key==='Escape'&&!settings&&!document.querySelector('.yarl__root')){event.stopPropagation();if(menu.current?.open)menu.current.removeAttribute('open');else onClose();}
    if(event.key==='Tab'){const scope=event.target instanceof Element?event.target.closest<HTMLElement>('[role="dialog"]')??event.currentTarget:event.currentTarget;const elements=[...scope.querySelectorAll<HTMLElement>('button:not(:disabled),select,input,a[href],summary,iframe')].filter(item=>item.getClientRects().length);const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  }}>
    <header className={styles.globalHeader}>
      <div className={styles.headerLead}><IconButton aria-label={tree?'Hide project files':'Show project files'} onClick={()=>onRequestChange({treeVisible:!tree})}><PanelLeft/></IconButton>{source}</div>
      <div className={styles.headerCenter}><div className={styles.workspaceSectionSwitch} aria-label="Workspace view">{(['app','files'] as const).map(value=><button key={value} className={section===value?styles.workspaceSectionActive:''} aria-pressed={section===value} onClick={()=>onRequestChange({section:value,...(value==='files'&&!selection?{treeVisible:true}:{})})}>{value==='app'?'App preview':'Files'}</button>)}</div></div>
      <div className={styles.headerControls}>
        {section==='app'&&<>
          <div className={`${styles.headerModeSwitch} ${styles.previewDeviceSwitch}`} role="group" aria-label="Preview device">
            <button type="button" aria-label="Desktop preview" title="Desktop" aria-pressed={device==='desktop'} className={device==='desktop'?styles.headerModeActive:''} onClick={()=>setDevice('desktop')}><Monitor aria-hidden="true"/></button>
            <button type="button" aria-label="Mobile preview" title="Mobile" aria-pressed={device==='mobile'} className={device==='mobile'?styles.headerModeActive:''} onClick={()=>setDevice('mobile')}><Smartphone aria-hidden="true"/></button>
          </div>
          <IconButton aria-label="Open preview in new window" title="Open preview in new window" disabled={!externalPreviewUrl} onClick={()=>externalPreviewUrl&&window.open(externalPreviewUrl,'_blank','popup,noopener,noreferrer,width=1280,height=800')}><ExternalLink aria-hidden="true"/></IconButton>
        </>}
        {section==='files'&&modes.length>1&&<IconButton aria-label={mode==='source'?'Rendered':'Source'} onClick={()=>onRequestChange({mode:mode==='source'?'rendered':'source'})}>{mode==='source'?<Eye/>:<Code2/>}</IconButton>}
        <IconButton aria-label="Refresh project" onClick={refreshAll}><RefreshCw/></IconButton>
        <details ref={menu} className={styles.workspaceMenu}><summary aria-label="Project actions"><MoreHorizontal/></summary><div className={styles.workspaceMenuPopover}><section>
          <button disabled={operation.isPending||build.data?.status==='running'} onClick={action(startBuild)}><Play/>Build now</button>
          <button disabled={!inspection.data} onClick={action(()=>setSettings(true))}><Settings/>Build settings…</button>
          {build.data&&<button onClick={action(()=>setShowLog(true))}>Build log</button>}
          {selected&&section==='files'&&referenceActions&&<button onClick={action(()=>referenceFile(selected))}>Reference in chat</button>}
          {attachment&&section==='files'&&<><a href={attachment.url} download><Download/>Download</a>{onAttach&&<button disabled={operation.isPending} onClick={action(()=>operation.mutate(async()=>{const captured=await projectFilesApi.attach(project.id,roomId,attachment.path);onAttach(captured);}))}><Paperclip/>Attach to message</button>}{/\.html?$/i.test(attachment.path)&&inspection.data&&<button disabled={operation.isPending} onClick={action(()=>operation.mutate(async()=>{await projectFilesApi.saveSettings(project.id,{...inspection.data!.settings,entrypoint:attachment.path});onRequestChange({section:'app'});refreshAll();}))}><Play/>Use as app entry</button>}</>}
        </section></div></details>
        <IconButton aria-label="Close project viewer" onClick={onClose}><X/></IconButton>
      </div>
    </header>
    {(error||inspection.error||build.error)&&<div role="alert" className={projectStyles.error}>{error||inspection.error?.message||build.error?.message}<button onClick={()=>{setError('');refreshAll();}}>Retry</button></div>}
    <div className={`${styles.layout} ${tree?styles.treePane:''}`}>
      {tree&&<div className={styles.explorerShell} style={{width:286}}><ProjectExplorer projectId={project.id} selected={selectedPath} revealPath={reference?.path} onSelect={choose} onReference={referenceActions?referenceFile:undefined}/></div>}
      <main className={styles.viewer}>
        {section==='app'?(previewUrl?<AppPreviewDevice key={`${entry}:${refresh}`} device={device} title={`${project.name} app preview`} previewUrl={previewUrl}/>:<div className={styles.previewGate}>
          <strong>{inspection.isPending?'Looking for a build…':inspection.data?.candidates.length?'Choose the app to preview':'Ready build not found'}</strong>
          <p>{inspection.data?.candidates.length?'Several builds have the same priority. Select the entry HTML.':'Preview displays the current build in your project folder.'}</p>
          {inspection.data?.scan_truncated&&<p>Auto-detection reached its scan limit. You can select an HTML path in Build settings.</p>}
          <div>{inspection.data?.candidates.map(candidate=><button key={candidate} onClick={()=>operation.mutate(async()=>{await projectFilesApi.saveSettings(project.id,{...inspection.data!.settings,entrypoint:candidate});})}>{candidate}</button>)}</div>
          <div><button disabled={operation.isPending||!inspection.data?.build_command||build.data?.status==='running'} onClick={startBuild}>Build now</button><button disabled={!inspection.data} onClick={()=>setSettings(true)}>Select HTML</button></div>
        </div>):attachment?<><div className={projectStyles.filePath}>{attachment.path}</div><div className={styles.content}><WorkspaceContent attachment={/\.html?$/i.test(attachment.path)?{...attachment,preview_url:projectFilesApi.previewUrl(project.id,attachment.path)}:attachment} mode={mode} encoding={request.encoding} onEncodingChange={encoding=>onRequestChange({encoding})}/></div></>:<div className={styles.viewerEmpty}>{emptyMessage}</div>}
      </main>
    </div>
    {(showLog||build.data?.status==='running')&&<section className={projectStyles.log} aria-label="Build log"><header><strong>{build.data?`Build ${build.data.status}`:'Starting build…'}</strong><code>{build.data?.command}</code>{build.data?.status==='running'?<button onClick={()=>operation.mutate(()=>projectFilesApi.cancel(project.id))}>Cancel build</button>:<button onClick={()=>setShowLog(false)}>Close log</button>}</header><pre>{build.data?.log||'Waiting for output…'}</pre></section>}
    {settings&&inspection.data&&<ProjectBuildSettings inspection={inspection.data} onClose={()=>setSettings(false)} onSave={async value=>{await projectFilesApi.saveSettings(project.id,value);refreshAll();}}/>}
  </section>,document.body);
}
