import type { Persona } from '../../../entities/persona';
import type { AgentHandle } from '../../../entities/run';
import {withoutProjectReferences} from '@agenvyl/contracts';

export function parseMentions(text: string, personas: readonly Pick<Persona,'handle'>[]): AgentHandle[] {
  text=withoutProjectReferences(text).replace(/⟦[^⟧]*⟧/g,'');
  const handles = personas.map(persona => persona.handle.toLowerCase());
  const known = new Set<AgentHandle>(handles);
  const result: AgentHandle[] = [];
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/giu)) {
    const handle = match[2].toLowerCase();
    const targets = handle === 'all' ? handles : known.has(handle) ? [handle] : [];
    for (const target of targets) if (!result.includes(target)) result.push(target);
  }
  return result;
}

export function activeMentionQuery(text:string,caret:number):{start:number;end:number;query:string}|undefined {
  const before=text.slice(0,caret);
  if(before.lastIndexOf('⟦')>before.lastIndexOf('⟧'))return;
  const match=before.match(/(^|[^\p{L}\p{N}_])@([^\s@⟦⟧]*)$/u);
  if(!match)return;const query=match[2];return {start:caret-query.length-1,end:caret,query:query.toLowerCase()};
}

export function removeMentionTarget(text:string,removedHandle:string,personas:readonly Pick<Persona,'handle'>[]):string {
  const preserved:string[]=[];
  text=text.replace(/⟦[^⟧]*⟧|\[\[project:[^\]\r\n]*\]\]/g,value=>{preserved.push(value);return `\u0000${preserved.length-1}\u0000`;});
  const remaining=personas.map(persona=>persona.handle.toLowerCase()).filter(handle=>handle!==removedHandle.toLowerCase());
  const explicitTargets=remaining.map(handle=>`@${handle}`).join(' ');
  const replaceMention=(value:string,handle:string,replacement:string)=>value.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])@${handle}(?![\\p{L}\\p{N}_-])`,'giu'),(_match,prefix:string)=>`${prefix}${replacement}`);
  const expanded=replaceMention(text,'all',explicitTargets);
  return replaceMention(expanded,removedHandle,'').replace(/[ \t]{2,}/g,' ').replace(/[ \t]+(\r?\n)/g,'$1').trimStart().replace(/\u0000(\d+)\u0000/g,(_,index:string)=>preserved[Number(index)]);
}

export function insertMentionAt(text:string,handle:string,start=text.length,end=start):{text:string;caret:number} {
  const before=text.slice(0,start),after=text.slice(end);
  const leading=before&&!/\s$/u.test(before)?' ':'';
  const trailing=after&&/^\s/u.test(after)?'':' ';
  const mention=`${leading}@${handle}${trailing}`;
  return{text:`${before}${mention}${after}`,caret:before.length+mention.length};
}
