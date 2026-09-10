export type WorkspaceRestoreTarget = {kind:'run'|'restore';id:string};
export type WorkspaceRestoreChange = {path:string;change:'created'|'updated'|'deleted'};
export type WorkspaceHistoryRun = {
  kind:'run';id:string;agent:string;createdAt:string;status:string;
  baseHead?:string;resultHead?:string;captureStatus?:string;unavailableReason?:string;
};
export type WorkspaceRestoreRecord = {
  kind:'restore';id:string;roomId:string;target:WorkspaceRestoreTarget;
  targetHead:string;beforeHead:string;resultHead:string;createdAt:string;
  status:'pending'|'complete';previewRunId?:string;error?:string;unavailableReason?:string;
};
export type WorkspaceHistory = {items:(WorkspaceHistoryRun|WorkspaceRestoreRecord)[];unavailableReason?:string};
export type WorkspaceRestorePreview = {
  target:WorkspaceRestoreTarget;targetHead:string;fingerprint:string;
  changes:WorkspaceRestoreChange[];affectedRuns:WorkspaceHistoryRun[];
  savesUncommittedChanges:boolean;previewRunId?:string;previewAgent?:string;
};
export type WorkspaceRestoreRequest = {target:WorkspaceRestoreTarget;fingerprint:string;requestId:string};
