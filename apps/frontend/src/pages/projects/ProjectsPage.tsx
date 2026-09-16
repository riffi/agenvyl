import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,Folder,FolderOpen,Menu,Plus,RefreshCw,Search,X} from 'lucide-react';
import {Link,useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import type {LocalProject} from '@agenvyl/contracts';
import {projectKeys,projectsApi} from '../../entities/project';
import {Alert,Button,Dialog,EmptyState,IconButton,Input,Spinner} from '../../shared/ui';
import {withGatewayMode} from '../../shared/lib';
import {WorkspaceApp} from '../../widgets/workspace';
import {DirectoryPicker} from './DirectoryPicker';
import {ProjectActions} from './ProjectActions';
import styles from './ProjectsPage.module.css';

export function ProjectsPage(){
  const[search]=useSearchParams(),navigate=useNavigate(),location=useLocation();
  const roomId=search.get('room')??'';
  const route=(path:string)=>withGatewayMode(path,location.search);
  const personaPath=(id?:string)=>route(`${id?`/personas/${encodeURIComponent(id)}`:'/personas'}${roomId?`?room=${encodeURIComponent(roomId)}`:''}`);
  return <WorkspaceApp view="projects" roomId={roomId}
    navigateToRoom={(id,options)=>navigate(route(`/rooms/${encodeURIComponent(id)}`),options)}
    navigateToPersonas={()=>navigate(personaPath())}
    navigateToPersona={(id,options)=>navigate(personaPath(id),options)}
    navigateToHarnessSettings={()=>navigate(route('/settings/harnesses'))}
    navigateToProjects={()=>navigate(route(`/projects${roomId?`?room=${encodeURIComponent(roomId)}`:''}`))}
    renderProjects={openMenu=><ProjectList openMenu={openMenu}/>}/>;
}

function ProjectList({openMenu}:{openMenu:()=>void}){
  const[search]=useSearchParams(),location=useLocation(),queryClient=useQueryClient();
  const[editing,setEditing]=useState<LocalProject|null|undefined>(),[error,setError]=useState(''),[filter,setFilter]=useState(''),[notice,setNotice]=useState('');
  const query=useQuery({queryKey:projectKeys.all,queryFn:({signal})=>projectsApi.list(signal)});
  const remove=useMutation({mutationFn:projectsApi.remove,onSuccess:()=>queryClient.invalidateQueries({queryKey:projectKeys.all})});
  const projects=query.data??[],term=filter.trim().toLocaleLowerCase();
  const visible=projects.filter(project=>`${project.name}\n${project.path}`.toLocaleLowerCase().includes(term));
  const roomId=search.get('room'),back=withGatewayMode(roomId?`/rooms/${encodeURIComponent(roomId)}`:'/',location.search);
  const deleteProject=async(project:LocalProject)=>{if(!confirm(`Delete “${project.name}”? It will be removed from every room.`))return;setError('');setNotice('');try{await remove.mutateAsync(project.id);}catch(issue){setError(message(issue));}};
  const copyPath=async(project:LocalProject)=>{setError('');try{await navigator.clipboard.writeText(project.path);setNotice(`Path copied for ${project.name}`);}catch{setError('Could not copy the path. Open the project to copy it manually.');}};
  return <main className={styles.shell}>
    <div className={styles.content}>
      <div className={styles.navigation}><IconButton className={styles.mobileMenu} aria-label="Open menu" onClick={openMenu}><Menu/></IconButton><Link to={back} className={styles.back}><ArrowLeft/>{roomId?'Back to room':'Back to workspace'}</Link></div>
      <header className={styles.pageHeader}>
        <div><div className={styles.title}><h1>Projects</h1>{query.data&&<span className={styles.count}>{projects.length}</span>}<IconButton aria-label="Refresh projects" title="Refresh projects" disabled={query.isFetching} onClick={()=>void query.refetch()}><RefreshCw className={query.isFetching?styles.spinning:''}/></IconButton></div><p>Folders available to your agents</p></div>
        <Button variant="primary" icon={<Plus/>} onClick={()=>setEditing(null)}>Add project</Button>
      </header>
      <div className={styles.search}><Search aria-hidden/><Input aria-label="Find a project" placeholder="Find a project by name or path…" value={filter} onChange={event=>setFilter(event.target.value)}/>{filter&&<IconButton aria-label="Clear search" onClick={()=>setFilter('')}><X/></IconButton>}</div>
      {(error||query.isError)&&<Alert tone="error">{error||message(query.error)}</Alert>}
      {notice&&<div className={styles.notice} role="status">{notice}<IconButton aria-label="Dismiss notification" onClick={()=>setNotice('')}><X/></IconButton></div>}
      {query.isPending?<div className={styles.loading}><Spinner label="Loading projects…"/></div>:!query.isError&&(
        !projects.length?<EmptyState className={styles.empty} icon={<Folder/>} title="No projects yet" description="Add a folder to make it available in your rooms." action={<Button variant="primary" icon={<Plus/>} onClick={()=>setEditing(null)}>Add your first project</Button>}/>:
        !visible.length?<EmptyState className={styles.empty} icon={<Search/>} title="No matching projects" description="Try another name or folder path." action={<Button onClick={()=>setFilter('')}>Clear search</Button>}/>:
        <ul className={styles.list} aria-label="Projects">{visible.map(project=><li key={project.id} className={styles.row}>
          <Folder className={styles.folder} aria-hidden/>
          <button type="button" className={styles.project} aria-label={`Edit ${project.name}`} onClick={()=>setEditing(project)}><strong>{project.name}</strong><span title={project.path}>{project.path}</span></button>
          <span className={`${styles.status} ${styles[project.availability]}`}><i/>{project.availability==='available'?'Available':project.availability==='unavailable'?'Folder unavailable':'Not checked'}</span>
          <ProjectActions name={project.name} disabled={remove.isPending} onEdit={()=>setEditing(project)} onCopy={()=>void copyPath(project)} onDelete={()=>void deleteProject(project)}/>
        </li>)}</ul>
      )}
    </div>
    {editing!==undefined&&<ProjectDialog project={editing} onClose={()=>setEditing(undefined)} onSaved={async()=>{setEditing(undefined);await queryClient.invalidateQueries({queryKey:projectKeys.all});}}/>}
  </main>;
}

const ProjectDialog=({project,onClose,onSaved}:{project:LocalProject|null;onClose:()=>void;onSaved:()=>Promise<void>})=>{
  const[name,setName]=useState(project?.name??''),[path,setPath]=useState(project?.path??''),[saving,setSaving]=useState(false),[picking,setPicking]=useState(false),[error,setError]=useState('');
  const save=async()=>{if(!name.trim()||!path.trim()){setError('Enter a name and an absolute folder path.');return;}setSaving(true);setError('');try{if(project)await projectsApi.update(project.id,{name:name.trim(),path:path.trim()});else await projectsApi.create({name:name.trim(),path:path.trim()});await onSaved();}catch(issue){setError(message(issue));setSaving(false);}};
  if(picking)return <DirectoryPicker initialPath={path} onClose={()=>setPicking(false)} onChoose={chosen=>{setPath(chosen);setPicking(false);}}/>;
  return <Dialog title={project?'Edit project':'Add project'} description="This folder is guidance for agents, not a permission boundary." onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving||picking} onClick={()=>void save()}>{saving?'Saving…':'Save project'}</Button></>}><div className={styles.form}><label>Name<Input autoFocus maxLength={80} value={name} onChange={event=>setName(event.target.value)} placeholder="For example, Agenvyl"/></label><label>Local folder<div className={styles.pathInput}><Input value={path} onChange={event=>setPath(event.target.value)} placeholder="Absolute folder path"/><Button icon={<FolderOpen/>} disabled={picking} onClick={()=>setPicking(true)}>{picking?'Choosing…':'Choose…'}</Button></div></label><small>Agents still follow the selected harness permission profile. The room workspace remains separate.</small>{error&&<Alert tone="error">{error}</Alert>}</div></Dialog>;
};
const message=(value:unknown)=>value instanceof Error?value.message:String(value);
