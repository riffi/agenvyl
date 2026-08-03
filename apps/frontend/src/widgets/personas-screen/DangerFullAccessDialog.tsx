import {Alert,Button,Dialog} from '../../shared/ui';

export const DangerFullAccessDialog=({open,onCancel,onConfirm}:{open:boolean;onCancel:()=>void;onConfirm:()=>void})=>
  <Dialog
    open={open}
    title="Enable full access?"
    description="Codex will run without sandboxing or approval prompts during Work runs."
    onClose={onCancel}
    footer={<><Button onClick={onCancel}>Cancel</Button><Button variant="danger" onClick={onConfirm}>Enable full access</Button></>}
  >
    <Alert tone="warning">Codex may run commands, modify files outside the room workspace, and access data available to your operating-system account. Only enable this for workspaces and instructions you trust.</Alert>
  </Dialog>;
