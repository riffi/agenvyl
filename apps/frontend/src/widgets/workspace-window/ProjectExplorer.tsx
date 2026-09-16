import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {AtSign,ChevronRight,File,Folder,Search} from 'lucide-react';
import type {ProjectFile} from '@agenvyl/contracts';
import {projectFilesApi} from '../../entities/project';
import styles from './WorkspaceWindow.module.css';

export function ProjectExplorer({projectId,selected,revealPath,onSelect,onReference}:{projectId:string;selected?:string;revealPath?:string;onSelect:(file:ProjectFile)=>void;onReference?:(file:ProjectFile)=>void}){
  const[search,setSearch]=useState('');
  return <aside className={styles.explorer}>
    <div className={styles.explorerToolbar}><label className={styles.search}><Search/><input aria-label="Filter visible project files" placeholder="Filter visible files" value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
    <nav className={styles.tree} aria-label="Project files"><Directory projectId={projectId} path="" depth={0} selected={selected} onSelect={onSelect} filter={search} revealPath={revealPath} onReference={onReference}/></nav>
  </aside>;
}
function Directory({projectId,path,depth,selected,onSelect,filter,revealPath,onReference}:{projectId:string;path:string;depth:number;selected?:string;onSelect:(file:ProjectFile)=>void;filter:string;revealPath?:string;onReference?:(file:ProjectFile)=>void}){
  const query=useQuery({queryKey:['project-files',projectId,'directory',path],queryFn:({signal})=>projectFilesApi.list(projectId,path,signal),refetchInterval:3000});
  const[expanded,setExpanded]=useState<Set<string>>(new Set());
  useEffect(()=>{if(!revealPath)return;const segments=revealPath.split('/');setExpanded(current=>new Set([...current,...segments.map((_,index)=>segments.slice(0,index+1).join('/'))]));},[revealPath]);
  if(query.error)return <p role="alert">{query.error.message}</p>;
  if(!query.data)return <p className={styles.explorerMessage}>Loading files…</p>;
  return <>
    {!query.data.entries.length&&<p className={styles.explorerMessage}>Folder is empty</p>}
    {query.data.truncated&&<p role="status">Showing the first 2,000 entries.</p>}
    {query.data.entries.filter(file=>file.kind==='directory'||file.name.toLowerCase().includes(filter.toLowerCase())).map(file=>{
      const directory=file.kind==='directory',open=expanded.has(file.path);
      return <div key={file.path}>
        <div className={styles.projectTreeRow}>
        <button className={`${styles.treeRow} ${selected===file.path?styles.treeSelected:''}`} title={file.path} aria-expanded={directory?open:undefined} style={{paddingLeft:9+depth*15}} onClick={()=>directory?setExpanded(current=>{const next=new Set(current);if(open)next.delete(file.path);else next.add(file.path);return next;}):onSelect(file)}>
          {directory?<ChevronRight className={`${styles.chevron} ${open?styles.chevronOpen:''}`}/>:<span className={styles.chevronSpace}/>}{directory?<Folder/>:<File/>}<span>{file.name}</span>
        </button>
        {onReference&&<button className={styles.projectReferenceAction} type="button" aria-label={`Reference ${file.path} in chat`} title="Reference in chat" onClick={()=>onReference(file)}><AtSign size={14}/></button>}
        </div>
        {directory&&open&&<Directory projectId={projectId} path={file.path} depth={depth+1} selected={selected} onSelect={onSelect} filter={filter} revealPath={revealPath} onReference={onReference}/>}
      </div>;
    })}
  </>;
}
