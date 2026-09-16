import {useState} from 'react';
import type {ProjectInspection,ProjectPreviewSettings} from '@agenvyl/contracts';
import {Button,Dialog,Input} from '../../shared/ui';
import styles from './WorkspaceWindow.module.css';
export function ProjectBuildSettings({inspection,onSave,onClose}:{inspection:ProjectInspection;onSave:(value:ProjectPreviewSettings)=>Promise<void>;onClose:()=>void}){
  const[entry,setEntry]=useState(inspection.settings.entrypoint??''),[command,setCommand]=useState(inspection.settings.build_command??''),[pending,setPending]=useState(false),[error,setError]=useState('');
  return <Dialog title="Build settings" description="Settings apply to this project in every room. Leave a field empty to detect it automatically." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="project-build-settings" disabled={pending}>{pending?'Saving…':'Save'}</Button></>}>
    <form id="project-build-settings" className={styles.operationForm} onSubmit={async event=>{event.preventDefault();setPending(true);setError('');try{await onSave({entrypoint:entry.trim()||null,build_command:command.trim()||null});onClose();}catch(error){setError((error as Error).message);}finally{setPending(false);}}}>
      <label><span>Entry HTML (relative to project)</span><Input autoFocus list="project-html-candidates" value={entry} placeholder={inspection.candidates.join(', ')||'Auto-detect'} onChange={event=>setEntry(event.target.value)}/></label>
      <datalist id="project-html-candidates">{inspection.candidates.map(path=><option key={path} value={path}/>)}</datalist>
      <Button variant="ghost" type="button" onClick={()=>setEntry('')}>Detect HTML automatically</Button>
      <label><span>Build command</span><Input value={command} placeholder={inspection.detected_command??'No build script found'} onChange={event=>setCommand(event.target.value)}/></label>
      <small>Runs directly in the project folder through Connector.</small>
      <Button variant="ghost" type="button" onClick={()=>setCommand('')}>Detect command automatically</Button>
      {error&&<p role="alert" className={styles.validation}>{error}</p>}
    </form>
  </Dialog>;
}
