import path from 'node:path';

export type OpenCodePermissionProfile='standard'|'auto-approve';

export const openCodePermissionProfiles=[
  {id:'standard',label:'Standard'},
  {id:'auto-approve',label:'Auto-approve'},
] as const;

export const parseOpenCodePermissionProfile=(value:string|null):OpenCodePermissionProfile=>{
  if(value===null||value==='standard')return'standard';
  if(value==='auto-approve')return'auto-approve';
  throw new Error('OpenCode permission profile is invalid');
};

export type ExternalDirectoryAssessment=
  |{status:'allowlisted';requestedRoot:string}
  |{status:'outside_allowlist';requestedRoot:string}
  |{status:'malformed'};

export const assessExternalDirectoryRequest=(properties:Record<string,unknown>,roots:string[]):ExternalDirectoryAssessment=>{
  const metadata=record(properties.metadata);
  if(!metadata)return{status:'malformed'};
  const filepath=concreteAbsolutePath(metadata.filepath),parentDir=concreteAbsolutePath(metadata.parentDir);
  if(!filepath||!parentDir||filepath.style!==parentDir.style)return{status:'malformed'};
  if(!contains(parentDir,filepath))return{status:'malformed'};
  const resources=Array.isArray(properties.resources)?properties.resources:properties.patterns;
  if(!Array.isArray(resources)||resources.length===0)return{status:'malformed'};
  const concreteResources=resources.map(resourcePath);
  if(concreteResources.some(resource=>!resource||resource.style!==filepath.style||!contains(parentDir,resource)))return{status:'malformed'};
  const allowlisted=roots.some(root=>{
    const normalizedRoot=concreteAbsolutePath(root);
    return normalizedRoot?.style===filepath.style
      &&contains(normalizedRoot,parentDir)
      &&contains(normalizedRoot,filepath)
      &&concreteResources.every(resource=>resource!==undefined&&contains(normalizedRoot,resource));
  });
  return{status:allowlisted?'allowlisted':'outside_allowlist',requestedRoot:parentDir.value};
};

export const isAllowlistedExternalDirectoryRequest=(properties:Record<string,unknown>,roots:string[])=>assessExternalDirectoryRequest(properties,roots).status==='allowlisted';

type PortablePath={style:'posix'|'win32';value:string};

const concreteAbsolutePath=(value:unknown):PortablePath|undefined=>{
  if(typeof value!=='string'||!value.trim()||/[*?\[\]{}\0-\x1f\x7f]/.test(value))return;
  const raw=value.trim();
  if(hasTraversal(raw)||(raw.includes('/')&&raw.includes('\\')))return;
  if(/^[A-Za-z]:[\\/]/.test(raw)||/^\\\\[^\\]+\\[^\\]+/.test(raw)){
    const normalized=path.win32.resolve(raw.replaceAll('/','\\'));
    return{style:'win32',value:normalized};
  }
  if(path.posix.isAbsolute(raw))return{style:'posix',value:path.posix.resolve(raw)};
};

const resourcePath=(value:unknown):PortablePath|undefined=>{
  if(typeof value!=='string')return;
  const concrete=value.trim().replace(/[\\/](?:\*\*|\*)$/,'');
  return concreteAbsolutePath(concrete);
};

const contains=(root:PortablePath,target:PortablePath)=>{
  if(root.style!==target.style)return false;
  const implementation=root.style==='win32'?path.win32:path.posix;
  const relative=implementation.relative(root.value,target.value);
  return relative===''||(!relative.startsWith(`..${implementation.sep}`)&&relative!=='..'&&!implementation.isAbsolute(relative));
};

const hasTraversal=(value:string)=>value.split(/[\\/]/).some(segment=>segment==='..');

const record=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
