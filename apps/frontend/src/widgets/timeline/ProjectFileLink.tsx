import {useState, type ReactNode} from 'react';
import type {ProjectSummary,WorkspaceAttachment} from '@agenvyl/contracts';
import {useProjectReferenceActions} from '../../shared/project-references/ProjectReferenceContext';
import {resolveProjectFileLink} from '../../shared/project-references/projectFileLink';
import {CopyFilePath} from '../../shared/project-references/CopyFilePath';
import styles from './ProjectFileLink.module.css';

export const ProjectFileLink = ({href, project, artifacts = [], children}: {href: string; project?: ProjectSummary; artifacts?: WorkspaceAttachment[]; children: ReactNode}) => {
  const actions = useProjectReferenceActions();
  const reference = resolveProjectFileLink(href, project ?? actions?.project);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  return <span className={styles.reference}>
    <button type="button" className={styles.link} title={href} disabled={loading} aria-busy={loading} onClick={async event => {
      if (reference && actions) { actions.open(reference); return; }
      if (!actions?.openWorkspaceLink) { setUnavailable(value => !value); return; }
      const opener = event.currentTarget;
      setLoading(true); setUnavailable(false); setError('');
      try { setUnavailable(!await actions.openWorkspaceLink(href, artifacts, opener)); }
      catch { setError('Could not load the room workspace. Try again.'); setUnavailable(true); }
      finally { setLoading(false); }
    }}>{children}</button>
    {unavailable && <span className={styles.fallback} role="status">{error || 'This file is unavailable in the project or room workspace.'} <code>{href}</code> <CopyFilePath path={href}/></span>}
  </span>;
};
