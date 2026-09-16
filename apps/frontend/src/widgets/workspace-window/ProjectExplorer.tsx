import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ChevronRight,File,Folder,Search} from 'lucide-react';
import type {ProjectFile} from '@agenvyl/contracts';
import {projectFilesApi} from '../../entities/project';
import styles from './WorkspaceWindow.module.css';

export function ProjectExplorer({projectId,selected,onSelect}:{projectId:string;selected?:string;onSelect:(file:ProjectFile)=>void}){
  const[search,setSearch]=useState('');
  return <aside className={styles.explorer}>
    <div className={styles.explorerToolbar}><label className={styles.search}><Search/><input aria-label="Filter visible project files" placeholder="Filter visible files" value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
    <nav className={styles.tree} aria-label="Project files"><Directory projectId={projectId} path="" depth={0} selected={selected} onSelect={onSelect} filter={search}/></nav>
  </aside>;
}
function Directory({projectId,path,depth,selected,onSelect,filter}:{projectId:string;path:string;depth:number;selected?:string;onSelect:(file:ProjectFile)=>void;filter:string}){
  const query=useQuery({queryKey:['project-files',projectId,'directory',path],queryFn:({signal})=>projectFilesApi.list(projectId,path,signal),refetchInterval:3000});
  const[expanded,setExpanded]=useState<Set<string>>(new Set());
  if(query.error)return <p role="alert">{query.error.message}</p>;
  if(!query.data)return <p className={styles.explorerMessage}>Loading files…</p>;
  return <>
    {!query.data.entries.length&&<p className={styles.explorerMessage}>Folder is empty</p>}
    {query.data.truncated&&<p role="status">Showing the first 2,000 entries.</p>}
    {query.data.entries.filter(file=>file.kind==='directory'||file.name.toLowerCase().includes(filter.toLowerCase())).map(file=>{
      const directory=file.kind==='directory',open=expanded.has(file.path);
      return <div key={file.path}>
        <button className={`${styles.treeRow} ${selected===file.path?styles.treeSelected:''}`} title={file.path} aria-expanded={directory?open:undefined} style={{paddingLeft:9+depth*15}} onClick={()=>directory?setExpanded(current=>{const next=new Set(current);if(open)next.delete(file.path);else next.add(file.path);return next;}):onSelect(file)}>
          {directory?<ChevronRight className={`${styles.chevron} ${open?styles.chevronOpen:''}`}/>:<span className={styles.chevronSpace}/>}{directory?<Folder/>:<File/>}<span>{file.name}</span>
        </button>
        {directory&&open&&<Directory projectId={projectId} path={file.path} depth={depth+1} selected={selected} onSelect={onSelect} filter={filter}/>}
      </div>;
    })}
  </>;
}
