import { useState, type FormEvent } from 'react';
import type { WorkspaceEntry } from '@agenvyl/contracts';
import { Button, Dialog, Input } from '../../shared/ui';
import styles from './WorkspaceWindow.module.css';

export type WorkspaceOperation =
  | { kind: 'create' }
  | { kind: 'rename'; entry: WorkspaceEntry }
  | { kind: 'move'; entry: WorkspaceEntry }
  | { kind: 'delete'; entry: WorkspaceEntry };

export const WorkspaceOperationDialog = ({
  operation,
  directory,
  pending,
  onClose,
  onSubmit,
}: {
  operation: WorkspaceOperation;
  directory: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (value?: string) => Promise<void>;
}) => {
  const initial = operation.kind === 'create' ? '' : operation.kind === 'rename' ? operation.entry.name : operation.kind === 'move' ? operation.entry.path : '';
  const [value, setValue] = useState(initial);
  const [validation, setValidation] = useState<string>();
  const title = operation.kind === 'create' ? 'Create folder' : operation.kind === 'rename' ? 'Rename file' : operation.kind === 'move' ? 'Move file' : 'Delete file';
  const description = operation.kind === 'delete'
    ? `“${operation.entry.path}” will be moved to the trash.`
    : operation.kind === 'rename'
      ? `Current path: ${operation.entry.path}`
      : operation.kind === 'move'
        ? 'Enter the new full path, including the file name.'
        : `The folder will be created in ${directory || 'the workspace root'}.`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim().replace(/^\/+|\/+$/g, '');
    if (operation.kind !== 'delete' && !next) return setValidation('Enter a non-empty value.');
    if ((operation.kind === 'create' || operation.kind === 'rename') && next.includes('/')) return setValidation('The name must not contain “/”.');
    if (operation.kind === 'rename' && next === operation.entry.name) return setValidation('The name has not changed.');
    if (operation.kind === 'move' && next === operation.entry.path) return setValidation('The path has not changed.');
    setValidation(undefined);
    try {
      await onSubmit(operation.kind === 'delete' ? undefined : next);
    } catch {
      // The parent mutation keeps the dialog open and displays the error.
    }
  };

  return <Dialog open title={title} description={description} onClose={onClose} footer={<>
    <Button variant="secondary" disabled={pending} onClick={onClose}>Cancel</Button>
    <Button variant={operation.kind === 'delete' ? 'danger' : 'primary'} disabled={pending} type="submit" form="workspace-operation">{pending ? 'Saving…' : operation.kind === 'delete' ? 'Move to trash' : 'Save'}</Button>
  </>}>
    <form id="workspace-operation" className={styles.operationForm} onSubmit={event => void submit(event)}>
      {operation.kind !== 'delete' && <label><span>{operation.kind === 'move' ? 'New path' : operation.kind === 'rename' ? 'New name' : 'Folder name'}</span><Input autoFocus value={value} onChange={event => { setValue(event.target.value); setValidation(undefined); }} aria-invalid={Boolean(validation)} /></label>}
      {validation && <small className={styles.validation}>{validation}</small>}
    </form>
  </Dialog>;
};
