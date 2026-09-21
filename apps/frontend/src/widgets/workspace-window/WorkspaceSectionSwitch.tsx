import type { WorkspaceSection } from './workspaceModel';
import styles from './WorkspaceWindow.module.css';

export function WorkspaceSectionSwitch({ section, onChange }: { section: WorkspaceSection; onChange: (section: WorkspaceSection) => void }) {
  return <>
    <select className={styles.mobileSectionSwitch} aria-label="Workspace view" value={section} onChange={event => onChange(event.target.value as WorkspaceSection)}>
      <option value="app">Preview</option>
      <option value="files">Files</option>
    </select>
    <div className={styles.workspaceSectionSwitch} aria-label="Workspace view">
      <button type="button" className={section === 'app' ? styles.workspaceSectionActive : ''} aria-pressed={section === 'app'} onClick={() => onChange('app')}>App preview</button>
      <button type="button" className={section === 'files' ? styles.workspaceSectionActive : ''} aria-pressed={section === 'files'} onClick={() => onChange('files')}>Files</button>
    </div>
  </>;
}
