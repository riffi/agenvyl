import {forwardRef,useImperativeHandle,useLayoutEffect,useRef,type ClipboardEvent,type KeyboardEvent} from 'react';
import type {ProjectReference} from '@agenvyl/contracts';
import {useProjectReferenceActions} from '../../shared/project-references/ProjectReferenceContext';
import {serializeProjectReferenceDraft,restoreProjectReferenceDraft} from './projectReferenceDraft';
import styles from './ReferenceEditor.module.css';

export type ReferenceEditorElement=HTMLDivElement&{selectionStart:number;selectionEnd:number;setSelectionRange:(start:number,end:number)=>void};
type Props={value:string;initialValue?:string;references:Map<string,ProjectReference>;className?:string;maxLength:number;label:string;placeholder?:string;describedBy?:string;onChange:(value:string,caret:number)=>void;onSelect:(value:string,caret:number)=>void;onKeyDown:(event:KeyboardEvent<HTMLElement>)=>void;onPaste:(event:ClipboardEvent<HTMLElement>)=>void;onBlur:()=>void};
const clipboardType='application/x-agenvyl-project-references';

// The draft keeps stable reference tokens; the DOM presents each token as one atom.
export function referenceEditorText(node:Node):string{
  if(node.nodeType===Node.TEXT_NODE)return node.textContent??'';
  if(node instanceof HTMLElement&&node.dataset.referenceToken)return node.dataset.referenceToken;
  if(node instanceof HTMLBRElement)return '\n';
  return [...node.childNodes].map(referenceEditorText).join('');
}
function selectionOffsets(root:HTMLElement){
  const selection=window.getSelection();if(!selection?.rangeCount)return;
  const range=selection.getRangeAt(0).cloneRange();if(!root.contains(range.commonAncestorContainer))return;
  const atom=(node:Node)=>(node instanceof Element?node:node.parentElement)?.closest('[data-reference-token]');
  const first=atom(range.startContainer),last=atom(range.endContainer);
  if(range.collapsed&&first){range.setStartAfter(first);range.collapse(true);}else{if(first)range.setStartBefore(first);if(last)range.setEndAfter(last);}
  const before=document.createRange();before.selectNodeContents(root);before.setEnd(range.startContainer,range.startOffset);
  const start=referenceEditorText(before.cloneContents()).length;
  return{start,end:start+referenceEditorText(range.cloneContents()).length};
}
function setCaret(root:HTMLElement,start:number,end:number){
  const point=(offset:number):[Node,number]=>{
    let remaining=offset;
    for(let index=0;index<root.childNodes.length;index++){
      const node=root.childNodes[index],length=referenceEditorText(node).length;
      if(node.nodeType===Node.TEXT_NODE&&remaining<=length)return[node,remaining];
      if(remaining===0)return[root,index];
      if(remaining<length)return[root,index+1];
      remaining-=length;
    }
    return[root,root.childNodes.length];
  };
  const range=document.createRange();range.setStart(...point(start));range.setEnd(...point(end));
  const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
}
function renderDraft(root:HTMLElement,value:string,references:Map<string,ProjectReference>){
  const nodes:Node[]=[];let cursor=0;
  for(const match of value.matchAll(/⟦[^⟧]*⟧/g)){
    const reference=references.get(match[0]);if(!reference)continue;
    nodes.push(document.createTextNode(value.slice(cursor,match.index)));
    const chip=document.createElement('span');chip.contentEditable='false';chip.dataset.referenceToken=match[0];chip.className=styles.chip;
    chip.title=`${reference.projectName}: ${reference.root.replace(/[\\/]+$/,'')}/${reference.path}`;
    const open=document.createElement('button');open.type='button';open.dataset.action='open';open.setAttribute('aria-label',`Open ${reference.path}`);
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.6');icon.setAttribute('aria-hidden','true');
    const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d',reference.kind==='directory'?'M3 7V4h6l3 3h9v13H3Z':'M6 3h8l4 4v14H6ZM14 3v5h4');icon.append(path);
    const label=document.createElement('span');label.textContent=reference.path.split('/').pop()??reference.path;open.append(icon,label);
    const remove=document.createElement('button');remove.type='button';remove.dataset.action='remove';remove.textContent='×';remove.setAttribute('aria-label',`Remove reference ${reference.path}`);
    chip.append(open,remove);nodes.push(chip);cursor=match.index!+match[0].length;
  }
  nodes.push(document.createTextNode(value.slice(cursor)));root.replaceChildren(...nodes);
}

export const ReferenceEditor=forwardRef<ReferenceEditorElement,Props>(function ReferenceEditor(props,ref){
  const root=useRef<HTMLDivElement>(null),latest=useRef(props),saved=useRef({start:props.value.length,end:props.value.length}),composing=useRef(false);
  latest.current=props;const actions=useProjectReferenceActions();
  const history=useRef<{values:string[];index:number}>({values:props.initialValue!==undefined&&props.initialValue!==props.value?[props.initialValue,props.value]:[props.value],index:props.initialValue!==undefined&&props.initialValue!==props.value?1:0});
  const remember=(value:string)=>{const state=history.current;if(state.values[state.index]===value)return;state.values=state.values.slice(0,state.index+1);state.values.push(value);if(state.values.length>100)state.values.shift();state.index=state.values.length-1;};
  const publish=(value:string,caret:number)=>{remember(value);saved.current={start:caret,end:caret};props.onChange(value,caret);};
  const replaceSelection=(replacement:string)=>{
    const element=root.current!;const current=referenceEditorText(element),range=selectionOffsets(element)??saved.current;
    const next=current.slice(0,range.start)+replacement+current.slice(range.end);if(next.length>props.maxLength)return;
    renderDraft(element,next,props.references);setCaret(element,range.start+replacement.length,range.start+replacement.length);publish(next,range.start+replacement.length);
  };
  useImperativeHandle(ref,()=>{
    const element=root.current! as ReferenceEditorElement;
    Object.defineProperties(element,{selectionStart:{configurable:true,get:()=>selectionOffsets(element)?.start??saved.current.start},selectionEnd:{configurable:true,get:()=>selectionOffsets(element)?.end??saved.current.end}});
    element.setSelectionRange=(start,end)=>{saved.current={start,end};setCaret(element,start,end);};return element;
  },[]);
  useLayoutEffect(()=>{
    const element=root.current!;if(composing.current)return;
    const selection=selectionOffsets(element)??saved.current,focused=document.activeElement===element;
    if(referenceEditorText(element)!==props.value||element.dataset.rendered!=='true'){
      renderDraft(element,props.value,props.references);element.dataset.rendered='true';
      if(focused)setCaret(element,Math.min(selection.start,props.value.length),Math.min(selection.end,props.value.length));
    }
    remember(props.value);
  },[props.value,props.references]);
  useLayoutEffect(()=>{
    const track=()=>{const element=root.current;if(!element||document.activeElement!==element)return;const selected=selectionOffsets(element);if(selected){saved.current=selected;latest.current.onSelect(referenceEditorText(element),selected.start);}};
    document.addEventListener('selectionchange',track);return()=>document.removeEventListener('selectionchange',track);
  },[]);
  const input=()=>{if(composing.current)return;const element=root.current!,value=referenceEditorText(element),caret=selectionOffsets(element)?.start??value.length;if(value.length>props.maxLength){renderDraft(element,props.value,props.references);setCaret(element,props.value.length,props.value.length);return;}publish(value,caret);};
  return <div ref={root} className={`${props.className??''} ${styles.editor}`} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={props.label} aria-describedby={props.describedBy} data-placeholder={props.placeholder} onBlur={props.onBlur} onInput={input} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;input();}}
    onMouseDown={event=>{if((event.target as Element).closest('button'))event.preventDefault();}}
    onClick={event=>{
      const button=(event.target as Element).closest<HTMLButtonElement>('button'),chip=button?.closest<HTMLElement>('[data-reference-token]'),token=chip?.dataset.referenceToken;if(!token||!chip)return;
      const reference=props.references.get(token);if(!reference)return;
      if(button?.dataset.action==='open'){actions?.open(reference);return;}
      const range=document.createRange();range.selectNodeContents(root.current!);range.setEndBefore(chip);const start=referenceEditorText(range.cloneContents()).length;
      const next=props.value.slice(0,start)+props.value.slice(start+token.length);root.current?.focus();renderDraft(root.current!,next,props.references);setCaret(root.current!,start,start);publish(next,start);
    }}
    onPaste={event=>{props.onPaste(event);if(event.defaultPrevented)return;event.preventDefault();const encoded=event.clipboardData.getData(clipboardType);replaceSelection(encoded?restoreProjectReferenceDraft(props.references,encoded):event.clipboardData.getData('text/plain'));}}
    onCopy={event=>{const selected=selectionOffsets(root.current!);if(!selected)return;event.preventDefault();const value=props.value.slice(selected.start,selected.end);event.clipboardData.setData('text/plain',value);event.clipboardData.setData(clipboardType,serializeProjectReferenceDraft(props.references,value));}}
    onCut={event=>{const selected=selectionOffsets(root.current!);if(!selected)return;event.preventDefault();const value=props.value.slice(selected.start,selected.end);event.clipboardData.setData('text/plain',value);event.clipboardData.setData(clipboardType,serializeProjectReferenceDraft(props.references,value));replaceSelection('');}}
    onDragOver={event=>event.preventDefault()} onDrop={event=>event.preventDefault()}
    onKeyDown={event=>{
      if(event.target!==root.current)return;
      if(composing.current||event.nativeEvent.isComposing)return;
      if((event.ctrlKey||event.metaKey)&&['b','i','u'].includes(event.key.toLowerCase())){event.preventDefault();return;}
      if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){
        event.preventDefault();const state=history.current,next=state.index+(event.shiftKey||event.key.toLowerCase()==='y'?1:-1);if(next<0||next>=state.values.length)return;
        state.index=next;const value=state.values[next];renderDraft(root.current!,value,props.references);setCaret(root.current!,value.length,value.length);saved.current={start:value.length,end:value.length};props.onChange(value,value.length);return;
      }
      props.onKeyDown(event);if(event.defaultPrevented)return;
      if(!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){
        const selected=selectionOffsets(root.current!);if(selected&&selected.start===selected.end)for(const match of props.value.matchAll(/⟦[^⟧]*⟧/g)){
          if(!props.references.has(match[0]))continue;const start=match.index!,end=start+match[0].length;
          if((event.key==='ArrowRight'&&selected.start===start)||(event.key==='ArrowLeft'&&selected.start===end)){event.preventDefault();const next=event.key==='ArrowRight'?end:start;setCaret(root.current!,next,next);return;}
        }
      }
      if(event.key==='Enter'){event.preventDefault();replaceSelection('\n');return;}
      if(event.key==='Backspace'||event.key==='Delete'){
        const element=root.current!,range=selectionOffsets(element);if(!range)return;
        if(range.start!==range.end){event.preventDefault();replaceSelection('');return;}
        for(const match of props.value.matchAll(/⟦[^⟧]*⟧/g)){
          if(!props.references.has(match[0]))continue;const start=match.index!,end=start+match[0].length;
          if((event.key==='Backspace'&&range.start===end)||(event.key==='Delete'&&range.start===start)){event.preventDefault();setCaret(element,start,end);replaceSelection('');return;}
        }
      }
    }}/>
});
