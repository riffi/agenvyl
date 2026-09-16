import {useState, type ReactNode} from 'react';
import type {ProjectSummary} from '@agenvyl/contracts';
import {useProjectReferenceActions} from '../../shared/project-references/ProjectReferenceContext';
import {resolveProjectFileLink} from '../../shared/project-references/projectFileLink';
import {CopyFilePath} from '../../shared/project-references/CopyFilePath';
import styles from './ProjectFileLink.module.css';

export const ProjectFileLink = ({href, project, children}: {href: string; project?: ProjectSummary; children: ReactNode}) => {
  const actions = useProjectReferenceActions();
  const reference = resolveProjectFileLink(href, project ?? actions?.project);
  const [unavailable, setUnavailable] = useState(false);
  return <span className={styles.reference}>
    <button type="button" className={styles.link} title={href} onClick={() => {
      if (reference && actions) actions.open(reference);
      else setUnavailable(value => !value);
    }}>{children}</button>
    {unavailable && <span className={styles.fallback} role="status">This path is unavailable in the original project. <code>{href}</code> <CopyFilePath path={href}/></span>}
  </span>;
};
