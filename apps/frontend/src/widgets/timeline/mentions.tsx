import type {CSSProperties,ReactNode} from 'react';
import type {Persona} from '../../entities/persona';
import styles from './Timeline.module.css';

type MentionOptions={handles:string[]};
type MarkdownNode={type:string;value?:string;url?:string;children?:MarkdownNode[]};

const mentionPattern=/(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_-]+)/giu;
const excludedMarkdownNodes=new Set(['code','inlineCode','link','linkReference','image','imageReference','definition','html']);

export function remarkPersonaMentions(options:MentionOptions={handles:[]}){
  const known=new Set(options.handles.map(handle=>handle.toLocaleLowerCase()));
  return(tree:MarkdownNode)=>transformMarkdownNode(tree,known);
}

function transformMarkdownNode(node:MarkdownNode,known:Set<string>){
  if(!node.children||excludedMarkdownNodes.has(node.type))return;
  const next:MarkdownNode[]=[];
  for(const child of node.children){
    if(child.type==='text'&&typeof child.value==='string')next.push(...mentionNodes(child.value,known));
    else{transformMarkdownNode(child,known);next.push(child)}
  }
  node.children=next;
}

function mentionNodes(text:string,known:Set<string>):MarkdownNode[]{
  const result:MarkdownNode[]=[];
  let cursor=0;
  for(const match of text.matchAll(mentionPattern)){
    const prefix=match[1],rawHandle=match[2],handle=rawHandle.toLocaleLowerCase();
    if(handle!=='all'&&!known.has(handle))continue;
    const start=(match.index??0)+prefix.length,end=start+rawHandle.length+1;
    if(start>cursor)result.push({type:'text',value:text.slice(cursor,start)});
    result.push({type:'link',url:`mention:${encodeURIComponent(handle)}`,children:[{type:'text',value:text.slice(start,end)}]});
    cursor=end;
  }
  if(cursor<text.length)result.push({type:'text',value:text.slice(cursor)});
  return result.length?result:[{type:'text',value:text}];
}

export function MentionLink({handle,personas,onMentionPersona}:{handle:string;personas:readonly Persona[];onMentionPersona?:(handle:string)=>void}){
  if(handle==='all')return <span className={`${styles.mention} ${styles['mention-all']}`} title="@all">Все участники</span>;
  const persona=personas.find(item=>item.handle.toLocaleLowerCase()===handle.toLocaleLowerCase());
  if(!persona)return <>@{handle}</>;
  return <button
    type="button"
    className={styles.mention}
    style={{'--mention-color':persona.color} as CSSProperties}
    title={`Добавить @${persona.handle} в сообщение${persona.role?` · ${persona.role}`:''}`}
    aria-label={`Добавить ${persona.name}, @${persona.handle}, в сообщение`}
    onClick={()=>onMentionPersona?.(persona.handle)}
  >{persona.name}</button>;
}

export function MentionText({text,personas,onMentionPersona}:{text:string;personas:readonly Persona[];onMentionPersona?:(handle:string)=>void}){
  const known=new Set(personas.map(persona=>persona.handle.toLocaleLowerCase()));
  const parts:ReactNode[]=[];
  let cursor=0,index=0;
  for(const match of text.matchAll(mentionPattern)){
    const prefix=match[1],rawHandle=match[2],handle=rawHandle.toLocaleLowerCase();
    if(handle!=='all'&&!known.has(handle))continue;
    const start=(match.index??0)+prefix.length,end=start+rawHandle.length+1;
    if(start>cursor)parts.push(text.slice(cursor,start));
    parts.push(<MentionLink key={`${start}-${index++}`} handle={handle} personas={personas} onMentionPersona={onMentionPersona}/>);
    cursor=end;
  }
  if(cursor<text.length)parts.push(text.slice(cursor));
  return <>{parts.length?parts:text}</>;
}
