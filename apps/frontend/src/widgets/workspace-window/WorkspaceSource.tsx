import type {ProjectSummary} from '@agenvyl/contracts';
import styles from './ProjectWindow.module.css';
export const WorkspaceSource=({project,source,onChange}:{project:ProjectSummary;source:'project'|'workspace';onChange:(source:'project'|'workspace')=>void})=><select className={styles.source} aria-label="File source" value={source} title={source==='project'?project.path:'Room workspace'} onChange={event=>onChange(event.target.value as 'project'|'workspace')}><option value="project">{project.name}</option><option value="workspace">Room workspace</option></select>;
