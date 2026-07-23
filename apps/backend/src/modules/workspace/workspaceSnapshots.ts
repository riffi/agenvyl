import {createHash} from 'node:crypto';

export type SnapshotEntry={path:string;kind:'file'|'directory';versionId?:string};
export type SnapshotDescriptor=Omit<SnapshotEntry,'path'>;
export type SnapshotConflict={path:string;base?:SnapshotDescriptor;current?:SnapshotDescriptor;candidate?:SnapshotDescriptor};

export const manifestHash=(entries:SnapshotEntry[])=>createHash('sha256')
  .update([...entries].sort((a,b)=>a.path.localeCompare(b.path)).map(entry=>`${entry.path}\x1f${entry.kind}\x1f${entry.versionId??''}`).join('\n'))
  .digest('hex');

export const entryMap=(entries:SnapshotEntry[]):Map<string,SnapshotDescriptor>=>new Map(entries.map(entry=>[entry.path,{kind:entry.kind,...(entry.versionId?{versionId:entry.versionId}:{})}]));

export const sameEntry=(left:SnapshotDescriptor|undefined,right:SnapshotDescriptor|undefined)=>
  left?.kind===right?.kind&&left?.versionId===right?.versionId;

export const diffSnapshots=(base:SnapshotEntry[],result:SnapshotEntry[])=>{
  const before=entryMap(base),after=entryMap(result),paths=new Set([...before.keys(),...after.keys()]);
  return[...paths].sort().flatMap(path=>{
    const prior=before.get(path),next=after.get(path);
    if(sameEntry(prior,next))return[];
    return[{path,change:prior&&!next?'deleted' as const:prior?'updated' as const:'created' as const,prior,next}];
  });
};

export const mergeSnapshots=(base:SnapshotEntry[],current:SnapshotEntry[],candidate:SnapshotEntry[])=>{
  const baseline=entryMap(base),published=entryMap(current),result=entryMap(candidate),merged=new Map(published),conflicts:SnapshotConflict[]=[];
  const paths=new Set([...baseline.keys(),...published.keys(),...result.keys()]);
  for(const path of [...paths].sort()){
    const b=baseline.get(path),c=published.get(path),r=result.get(path);
    if(sameEntry(r,b)||sameEntry(r,c))continue;
    if(sameEntry(c,b)){if(r)merged.set(path,r);else merged.delete(path);continue;}
    conflicts.push({path,...(b?{base:b}:{}),...(c?{current:c}:{}),...(r?{candidate:r}:{})});
  }
  return{
    entries:[...merged].map(([path,value])=>({path,...value})).sort((a,b)=>a.path.localeCompare(b.path)),
    conflicts,
  };
};
