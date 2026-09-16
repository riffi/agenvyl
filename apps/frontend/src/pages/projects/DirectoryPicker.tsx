import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ArrowUp,ChevronDown,ChevronRight,Folder,Home,Monitor,RefreshCw} from 'lucide-react';
import type {DirectoryLocation} from '@agenvyl/contracts';
import {projectsApi} from '../../entities/project';
import {Alert,Button,Dialog,Input,Spinner} from '../../shared/ui';
import styles from './DirectoryPicker.module.css';

const directoryQuery=(path?:string)=>({queryKey:['directory-browser',path??null],queryFn:({signal}:{signal:AbortSignal})=>projectsApi.directories(path,signal),retry:false,staleTime:10_000});
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'Could not read this folder.';

export function DirectoryPicker({initialPath,onChoose,onClose}:{initialPath:string;onChoose:(path:string)=>void;onClose:()=>void}){
  const[location,setLocation]=useState<string|undefined>(initialPath||undefined);
  const[selected,setSelected]=useState<string|undefined>(initialPath||undefined);
  const[input,setInput]=useState(initialPath);
  const listing=useQuery(directoryQuery(location));
  const selection=useQuery({...directoryQuery(selected),enabled:!!selected});
  const container=useRef<HTMLDivElement>(null);
  const navigate=(path?:string)=>{setLocation(path);setSelected(path);setInput(path??'');};
  useEffect(()=>{
    const dialog=container.current?.closest('[role="dialog"]');
    if(!dialog)return;
    const trap=(event:KeyboardEvent)=>{
      if(event.key!=='Tab')return;
      const items=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]'));
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    dialog.addEventListener('keydown',trap as EventListener);
    return()=>dialog.removeEventListener('keydown',trap as EventListener);
  },[]);
  const validSelection=selected&&!selection.isError&&!selection.isFetching?selection.data?.path:null;
  return <Dialog title="Choose project folder" labelledBy="directory-picker-title" description={listing.data?`Folders on ${listing.data.host} · ${listing.data.platform}`:'Folders on the Connector computer'} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!validSelection} onClick={()=>{if(validSelection)onChoose(validSelection);}}>Choose folder</Button></>}>
    <div className={styles.picker} ref={container}>
      <div className={styles.toolbar}>
        <Button icon={<Monitor/>} onClick={()=>navigate()}>Computer</Button>
        <Button aria-label="Home folder" title="Home folder" icon={<Home/>} disabled={!listing.data} onClick={()=>navigate(listing.data?.home)}/>
        <Button aria-label="Parent folder" title="Parent folder" icon={<ArrowUp/>} disabled={!listing.data?.parent} onClick={()=>navigate(listing.data?.parent??undefined)}/>
        <Button aria-label="Refresh folders" title="Refresh folders" icon={<RefreshCw/>} disabled={listing.isFetching} onClick={()=>void listing.refetch()}/>
      </div>
      <form className={styles.path} onSubmit={event=>{event.preventDefault();if(input.trim())navigate(input.trim());}}><Input aria-label="Folder path" autoFocus placeholder="Enter an absolute folder path" value={input} onChange={event=>setInput(event.target.value)}/><Button type="submit" disabled={!input.trim()}>Go</Button></form>
      <div className={styles.tree} aria-label="Folders">
        {listing.isPending?<Spinner label="Loading folders…"/>:listing.isError?<Alert tone="error">{errorMessage(listing.error)}</Alert>:<>
          {listing.data.path&&<button type="button" className={styles.current} aria-pressed={selected===listing.data.path} onClick={()=>setSelected(listing.data.path!)}><Folder/><span>{listing.data.path}</span></button>}
          <ul className={styles.nodes}>{listing.data.entries.map(entry=><DirectoryNode key={entry.path} entry={entry} selected={selected} onSelect={setSelected}/>)}</ul>
          {!listing.data.entries.length&&<p className={styles.note}>No subfolders</p>}
          {listing.data.truncated&&<p className={styles.note}>Showing the first 2,000 folders. Enter a full path to open another folder.</p>}
        </>}
      </div>
      <div className={styles.selection}><span>Selected folder</span><code>{selected??'Select a folder above'}</code>{selected&&selection.isFetching&&<small>Checking folder…</small>}{selected&&selected!==location&&selection.isError&&<Alert tone="error">{errorMessage(selection.error)}</Alert>}</div>
    </div>
  </Dialog>;
}

function DirectoryNode({entry,selected,onSelect}:{entry:DirectoryLocation;selected?:string;onSelect:(path:string)=>void}){
  const[expanded,setExpanded]=useState(false);
  const query=useQuery({...directoryQuery(entry.path),enabled:expanded});
  return <li>
    <div className={styles.row} data-selected={selected===entry.path}>
      <button type="button" className={styles.toggle} aria-label={`${expanded?'Collapse':'Expand'} ${entry.name}`} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?<ChevronDown/>:<ChevronRight/>}</button>
      <button type="button" className={styles.folder} title={entry.path} aria-pressed={selected===entry.path} onClick={()=>onSelect(entry.path)} onDoubleClick={()=>setExpanded(!expanded)}><Folder/><span>{entry.name}</span></button>
    </div>
    {expanded&&<div className={styles.children}>{query.isPending?<p className={styles.note}>Loading…</p>:query.isError?<div className={styles.note} role="alert">{errorMessage(query.error)} <button type="button" onClick={()=>void query.refetch()}>Retry</button></div>:<><ul className={styles.nodes}>{query.data.entries.map(child=><DirectoryNode key={child.path} entry={child} selected={selected} onSelect={onSelect}/>)}</ul>{!query.data.entries.length&&<p className={styles.note}>No subfolders</p>}{query.data.truncated&&<p className={styles.note}>Showing the first 2,000 folders.</p>}</>}</div>}
  </li>;
}

