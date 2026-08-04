import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,Folder,FolderOpen,MoreHorizontal,Plus,RefreshCw,Trash2} from 'lucide-react';
import {Link,useSearchParams} from 'react-router-dom';
import type {LocalProject} from '@agenvyl/contracts';
import {projectKeys,projectsApi} from '../../entities/project';
import {Alert,Button,Dialog,EmptyState,IconButton,Input,Spinner} from '../../shared/ui';
import styles from './ProjectsPage.module.css';

export const ProjectsPage=()=>{
  const[search]=useSearchParams(),queryClient=useQueryClient(),[editing,setEditing]=useState<LocalProject|null|undefined>(),[error,setError]=useState('');
  const query=useQuery({queryKey:projectKeys.all,queryFn:({signal})=>projectsApi.list(signal)});
  const remove=useMutation({mutationFn:projectsApi.remove,onSuccess:()=>queryClient.invalidateQueries({queryKey:projectKeys.all})});
  const projects=query.data??[],back=search.get('room')?`/rooms/${encodeURIComponent(search.get('room')!)}`:'/';
  const deleteProject=async(project:LocalProject)=>{if(!confirm(`Delete “${project.name}”? It will be removed from every room.`))return;setError('');try{await remove.mutateAsync(project.id);}catch(issue){setError(message(issue));}};
  return <main className={styles.shell}>
    <aside className={styles.rail}><Link to={back} className={styles.back}><ArrowLeft/>Workspace</Link><div><p>Context</p><span className={styles.active}><Folder/>Projects</span></div><small>Recommended local<br/>working folders</small></aside>
    <section className={styles.content}>
      <header className={styles.pageHeader}><span><strong><Folder/>Projects</strong><small>{projects.length} registered folder{projects.length===1?'':'s'}</small></span><div><Button icon={<RefreshCw className={query.isFetching?styles.spinning:''}/>} disabled={query.isFetching} onClick={()=>void query.refetch()}>{query.isFetching?'Refreshing…':'Refresh'}</Button><Button variant="primary" icon={<Plus/>} onClick={()=>setEditing(null)}>Add project</Button></div></header>
      {error&&<Alert className={styles.pageAlert} tone="error">{error}</Alert>}
      <div className={styles.body}>{query.isPending
          ? <div className={styles.loading}><Spinner label="Loading projects…"/></div>
          : projects.length
            ? <div className={styles.grid}>{projects.map(project=><article key={project.id} className={styles.card}><div className={styles.folder}><FolderOpen/></div><span className={styles.copy}><strong>{project.name}</strong><code title={project.path}>{project.path}</code><small className={styles[project.availability]}><i/>{project.availability}</small></span><IconButton aria-label={`Edit ${project.name}`} title="Edit project" onClick={()=>setEditing(project)}><MoreHorizontal/></IconButton><IconButton className={styles.delete} aria-label={`Delete ${project.name}`} title="Delete project" onClick={()=>void deleteProject(project)}><Trash2/></IconButton></article>)}</div>
            : <EmptyState className={styles.empty} icon={<Folder/>} title="No projects yet" description="Register a local folder once, then recommend it to agents in any room." action={<Button variant="primary" icon={<Plus/>} onClick={()=>setEditing(null)}>Add your first project</Button>}/>
      }</div>
    </section>
    {editing!==undefined&&<ProjectDialog project={editing} onClose={()=>setEditing(undefined)} onSaved={async()=>{setEditing(undefined);await queryClient.invalidateQueries({queryKey:projectKeys.all});}}/>}
  </main>;
};

const ProjectDialog=({project,onClose,onSaved}:{project:LocalProject|null;onClose:()=>void;onSaved:()=>Promise<void>})=>{
  const[name,setName]=useState(project?.name??''),[path,setPath]=useState(project?.path??''),[saving,setSaving]=useState(false),[picking,setPicking]=useState(false),[error,setError]=useState('');
  const pick=async()=>{setPicking(true);setError('');try{const result=await projectsApi.pickDirectory();if(result.status==='selected'&&result.path)setPath(result.path);else if(result.status==='unavailable')setError(result.message??'Native folder picker is unavailable; enter the absolute path manually.');}catch(issue){setError(message(issue));}finally{setPicking(false);}};
  const save=async()=>{if(!name.trim()||!path.trim()){setError('Enter a name and an absolute folder path.');return;}setSaving(true);setError('');try{if(project)await projectsApi.update(project.id,{name:name.trim(),path:path.trim()});else await projectsApi.create({name:name.trim(),path:path.trim()});await onSaved();}catch(issue){setError(message(issue));setSaving(false);}};
  return <Dialog title={project?'Edit project':'Add project'} description="This folder is guidance for agents, not a permission boundary." onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving||picking} onClick={()=>void save()}>{saving?'Saving…':'Save project'}</Button></>}><div className={styles.form}><label>Name<Input autoFocus maxLength={80} value={name} onChange={event=>setName(event.target.value)} placeholder="For example, Agenvyl"/></label><label>Local folder<div className={styles.pathInput}><Input value={path} onChange={event=>setPath(event.target.value)} placeholder="C:\\work\\my-project"/><Button icon={<FolderOpen/>} disabled={picking} onClick={()=>void pick()}>{picking?'Choosing…':'Choose…'}</Button></div></label><small>Agents still follow the selected harness permission profile. The room workspace remains separate.</small>{error&&<Alert tone="error">{error}</Alert>}</div></Dialog>;
};
const message=(value:unknown)=>value instanceof Error?value.message:String(value);
