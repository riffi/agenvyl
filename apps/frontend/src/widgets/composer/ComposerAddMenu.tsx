import {FolderOpen,Paperclip,Plus} from 'lucide-react';
import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import styles from './Composer.module.css';

type ComposerAddMenuProps={
  attachmentDisabled:boolean;
  onAttach:()=>void;
  onOpenWorkspace:()=>void;
};

export const ComposerAddMenu=({attachmentDisabled,onAttach,onOpenWorkspace}:ComposerAddMenuProps)=>{
  const [open,setOpen]=useState(false);
  const menuId=useId();
  const rootRef=useRef<HTMLDivElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);
  const itemRefs=useRef<Array<HTMLButtonElement|null>>([]);

  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(!rootRef.current?.contains(event.target as Node))setOpen(false)};
    addEventListener('pointerdown',close);
    return()=>removeEventListener('pointerdown',close);
  },[open]);

  const openMenu=()=>{
    setOpen(true);
    requestAnimationFrame(()=>itemRefs.current.find(item=>item&&!item.disabled)?.focus());
  };
  const closeMenu=(restoreFocus=false)=>{
    setOpen(false);
    if(restoreFocus)requestAnimationFrame(()=>triggerRef.current?.focus());
  };
  const run=(action:()=>void)=>{setOpen(false);action()};
  const moveFocus=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
    const available=itemRefs.current.filter((item):item is HTMLButtonElement=>Boolean(item&&!item.disabled));
    if(!available.length)return;
    if(event.key==='Escape'){
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();
    const current=Math.max(0,available.indexOf(itemRefs.current[index]!));
    const next=event.key==='Home'?0:event.key==='End'?available.length-1:(current+(event.key==='ArrowDown'?1:-1)+available.length)%available.length;
    available[next]?.focus();
  };

  return <div ref={rootRef} className={styles['add-menu-wrap']} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setOpen(false)}}>
    <button
      ref={triggerRef}
      type="button"
      className={styles['add-button']}
      aria-label="Add to message"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open?menuId:undefined}
      onClick={()=>open?closeMenu():openMenu()}
      onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();openMenu()}}}
    ><Plus aria-hidden="true"/></button>
    {open&&<div id={menuId} className={styles['add-menu']} role="menu" aria-label="Add to message">
      <button ref={node=>{itemRefs.current[0]=node}} type="button" role="menuitem" disabled={attachmentDisabled} onKeyDown={event=>moveFocus(event,0)} onClick={()=>run(onAttach)}>
        <i><Paperclip aria-hidden="true"/></i><span><strong>Attach files…</strong><small>Upload or choose from workspace</small></span>
      </button>
      <button ref={node=>{itemRefs.current[1]=node}} type="button" role="menuitem" onKeyDown={event=>moveFocus(event,1)} onClick={()=>run(onOpenWorkspace)}>
        <i><FolderOpen aria-hidden="true"/></i><span><strong>Open workspace</strong><small>Browse room files</small></span>
      </button>
    </div>}
  </div>;
};
