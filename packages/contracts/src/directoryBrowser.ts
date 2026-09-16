export type DirectoryLocation={name:string;path:string};
export type DirectoryListing={path:string|null;parent:string|null;home:string;host:string;platform:string;entries:DirectoryLocation[];truncated:boolean};
export function isDirectoryListing(value:unknown):value is DirectoryListing{
  if(!value||typeof value!=='object')return false;
  const v=value as Record<string,unknown>;
  return (v.path===null||typeof v.path==='string')&&(v.parent===null||typeof v.parent==='string')&&typeof v.home==='string'&&typeof v.host==='string'&&typeof v.platform==='string'&&typeof v.truncated==='boolean'&&Array.isArray(v.entries)&&v.entries.length<=2000&&v.entries.every(entry=>entry&&typeof entry==='object'&&typeof entry.name==='string'&&typeof entry.path==='string');
}
