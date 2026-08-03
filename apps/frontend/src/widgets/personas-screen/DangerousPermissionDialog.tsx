import {Alert,Button,Dialog} from '../../shared/ui';

export type DangerousPermission='codex-full-access'|'agy-accept-edits';

const content:Record<DangerousPermission,{title:string;description:string;warning:string;confirmLabel:string}>={
  'codex-full-access':{
    title:'Enable full access?',
    description:'Codex will run without sandboxing or approval prompts during Work runs.',
    warning:'Codex may run commands, modify files outside the room workspace, and access data available to your operating-system account. Only enable this for workspaces and instructions you trust.',
    confirmLabel:'Enable full access',
  },
  'agy-accept-edits':{
    title:'Allow AGY to edit files?',
    description:'AGY will use its permission-bypass mode during Work runs.',
    warning:'AGY cannot ask for per-action approval. It may modify files and run commands in the room workspace without another confirmation. Only enable this for workspaces and instructions you trust.',
    confirmLabel:'Allow edits',
  },
};

export const DangerousPermissionDialog=({permission,onCancel,onConfirm}:{permission?:DangerousPermission;onCancel:()=>void;onConfirm:()=>void})=>{
  const copy=permission?content[permission]:undefined;
  return <Dialog
    open={Boolean(copy)}
    title={copy?.title??''}
    description={copy?.description}
    onClose={onCancel}
    footer={<><Button onClick={onCancel}>Cancel</Button><Button variant="danger" onClick={onConfirm}>{copy?.confirmLabel}</Button></>}
  >
    <Alert tone="warning">{copy?.warning}</Alert>
  </Dialog>;
};
