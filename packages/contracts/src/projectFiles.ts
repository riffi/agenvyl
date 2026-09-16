export type ProjectFile = {path:string;name:string;kind:'file'|'directory';size:number;modified:string;mime_type:string};
export type ProjectDirectory = {entries:ProjectFile[];truncated:boolean};
export type ProjectBuild = {id:string;command:string;status:'running'|'completed'|'failed'|'cancelled';log:string;started_at:string;finished_at?:string;exit_code?:number};
export type ProjectPreviewSettings = {entrypoint:string|null;build_command:string|null};
export type ProjectInspection = {
  candidates:string[];entrypoint:string|null;detected_command:string|null;build_command:string|null;
  settings:ProjectPreviewSettings;build:ProjectBuild|null;scan_truncated:boolean;
};

// Shared with workspace discovery: output priority first, then nesting depth.
export function staticPreviewCandidates(paths:string[]){
  const priorities=['dist','build','out'];
  const normalized=paths.map(value=>value.replaceAll('\\','/'));
  const builds=normalized.flatMap(filePath=>{
    const segments=filePath.split('/'),priority=priorities.indexOf(segments.at(-2)?.toLowerCase()??'');
    return segments.at(-1)?.toLowerCase()==='index.html'&&priority>=0?[{filePath,priority,depth:segments.length}]:[];
  }).sort((a,b)=>a.priority-b.priority||a.depth-b.depth||a.filePath.localeCompare(b.filePath));
  if(builds.length)return builds.filter(item=>item.priority===builds[0].priority&&item.depth===builds[0].depth).map(item=>item.filePath);
  return normalized.includes('index.html')&&!normalized.includes('package.json')?['index.html']:[];
}
