import path from 'node:path';
import type {RunEmbedError} from '@agenvyl/contracts';

export type WorkspaceImageReference={path:string;error?:Extract<RunEmbedError,'invalid_path'|'limit_exceeded'>};

export function extractExternalImageReferences(markdown:string){
  const ignored=codeRanges(markdown),found:string[]=[];const seen=new Set<string>();
  const pattern=/!\[[^\]\n]*\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)/giu;
  for(const match of markdown.matchAll(pattern)){const offset=match.index??0,url=match[1];if(ignored.some(([start,end])=>offset>=start&&offset<end)||seen.has(url))continue;seen.add(url);found.push(url);}
  return found;
}

export function extractWorkspaceImageReferences(markdown:string,limit=10):WorkspaceImageReference[]{
  const ignored=codeRanges(markdown),found:WorkspaceImageReference[]=[];const seen=new Set<string>();
  const pattern=/!\[[^\]\n]*\]\(\s*<?workspace:([^\s)>]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)/giu;
  for(const match of markdown.matchAll(pattern)){
    const offset=match.index??0;if(ignored.some(([start,end])=>offset>=start&&offset<end))continue;
    const raw=match[1];let normalized:string|undefined;try{normalized=normalizeWorkspacePath(decodeURIComponent(raw))}catch{/* represented below */}
    const key=normalized??`invalid:${raw}`;if(seen.has(key))continue;seen.add(key);
    if(found.length>=limit){found.push({path:normalized??raw,error:'limit_exceeded'});continue;}
    found.push(normalized?{path:normalized}:{path:raw,error:'invalid_path'});
  }
  return found;
}

export function normalizeWorkspacePath(value:string){
  const normalized=value.normalize('NFC');
  if(!normalized||normalized.startsWith('/')||normalized.includes('\\')||normalized.includes('?')||normalized.includes('#')||normalized.includes('\0')||normalized.split('/').some(part=>!part||part==='.'||part==='..')||path.posix.normalize(normalized)!==normalized)throw new Error('invalid workspace path');
  return normalized;
}

function codeRanges(markdown:string){
  const ranges:Array<[number,number]>=[];
  for(const match of markdown.matchAll(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2(?=\n|$)|$)/g))ranges.push([match.index??0,(match.index??0)+match[0].length]);
  for(const match of markdown.matchAll(/(`+)[^\n]*?\1/g)){const start=match.index??0;if(!ranges.some(([from,to])=>start>=from&&start<to))ranges.push([start,start+match[0].length]);}
  return ranges;
}
