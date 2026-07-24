import type { ReactNode } from 'react';
import { Activity } from 'lucide-react';
import styles from './Timeline.module.css';

type RunActivityProps = {
  actionCount: number;
  hasWorkspaceEvent: boolean;
  children: ReactNode;
};

export const RunActivity = ({
  actionCount,
  hasWorkspaceEvent,
  children,
}: RunActivityProps) => {
  const summary = activitySummary({
    actionCount,
    hasWorkspaceEvent,
  });

  return <details className={styles['run-activity']}>
    <summary role="button" aria-label={`Run activity: ${summary}`}>
      <Activity />
      <strong>Run activity</strong>
      <span>{summary}</span>
    </summary>
    <div className={styles['run-activity-body']}>{children}</div>
  </details>;
};

const activitySummary = ({
  actionCount,
  hasWorkspaceEvent,
}: Omit<RunActivityProps, 'children'>) => {
  const parts: string[] = [];
  if (actionCount) parts.push(`${actionCount} ${actionCount === 1 ? 'action' : 'actions'}`);
  if (hasWorkspaceEvent) parts.push('workspace');
  return parts.join(' · ') || 'details';
};
