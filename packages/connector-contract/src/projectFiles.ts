import type {ProjectBuild,ProjectDirectory,ProjectInspection} from '@agenvyl/contracts';
export type ProjectFileRequest={root:string;path?:string;entrypoint?:string;command?:string};
export type ProjectFileResults={
  list:ProjectDirectory;
  search:ProjectDirectory;
  inspect:Pick<ProjectInspection,'candidates'|'detected_command'|'scan_truncated'|'build'>;
  read:{data:string;mime_type:string};
  preview:{data:string;mime_type:string};
  build:ProjectBuild;
  'build-status':ProjectBuild|null;
  cancel:ProjectBuild|null;
};
export type ProjectFileOperation=keyof ProjectFileResults;
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const build=(value:unknown)=>record(value)&&typeof value.id==='string'&&typeof value.command==='string'&&typeof value.log==='string'&&value.log.length<=128000&&typeof value.started_at==='string'&&['running','completed','failed','cancelled'].includes(String(value.status));
export function isProjectFileResult<T extends ProjectFileOperation>(operation:T,value:unknown):value is ProjectFileResults[T]{
  if(operation==='build')return build(value);
  if(operation==='build-status'||operation==='cancel')return value===null||build(value);
  if(!record(value))return false;
  if(operation==='read'||operation==='preview')return typeof value.data==='string'&&value.data.length<=45*1024*1024&&typeof value.mime_type==='string';
  if(operation==='inspect')return Array.isArray(value.candidates)&&value.candidates.every(item=>typeof item==='string')&&(value.detected_command===null||typeof value.detected_command==='string')&&typeof value.scan_truncated==='boolean'&&(value.build===null||build(value.build));
  return typeof value.truncated==='boolean'&&Array.isArray(value.entries)&&value.entries.length<=2000&&value.entries.every(item=>record(item)&&typeof item.path==='string'&&typeof item.name==='string'&&(item.kind==='file'||item.kind==='directory')&&typeof item.size==='number'&&Number.isSafeInteger(item.size)&&item.size>=0&&typeof item.modified==='string'&&typeof item.mime_type==='string');
}
