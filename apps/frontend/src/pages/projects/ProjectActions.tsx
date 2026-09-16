import {useEffect,useRef,useState} from 'react';
import {Copy,MoreHorizontal,Pencil,Trash2} from 'lucide-react';
import {IconButton} from '../../shared/ui';
import styles from './ProjectsPage.module.css';

export function ProjectActions({name,onEdit,onCopy,onDelete,disabled}:{name:string;onEdit:()=>void;onCopy:()=>void;onDelete:()=>void;disabled:boolean}){
  const[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',close);
    return()=>document.removeEventListener('pointerdown',close);
  },[open]);
  const run=(action:()=>void)=>{setOpen(false);root.current?.querySelector('button')?.focus();action();};
  return <div ref={root} className={styles.actions} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);root.current?.querySelector('button')?.focus();}
    if(open&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const items=Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
      const current=items.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      items[next]?.focus();
    }
  }}>
    <IconButton aria-label={`Actions for ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)}><MoreHorizontal/></IconButton>
    {open&&<div className={styles.actionMenu} role="menu" aria-label={`${name} actions`}>
      <button type="button" role="menuitem" onClick={()=>run(onEdit)}><Pencil/>Edit project</button>
      <button type="button" role="menuitem" onClick={()=>run(onCopy)}><Copy/>Copy path</button>
      <button type="button" role="menuitem" className={styles.delete} disabled={disabled} onClick={()=>run(onDelete)}><Trash2/>Delete project</button>
    </div>}
  </div>;
}
