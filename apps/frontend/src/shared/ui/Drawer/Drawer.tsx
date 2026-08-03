import {useEffect,useRef,type KeyboardEvent,type ReactNode} from 'react';
import { Button } from '../Button';
import styles from './Drawer.module.css';

export function Drawer({open,title,leading,children,onClose,wide=false,modal=false,specBlockId}:{open:boolean;title:ReactNode;leading?:ReactNode;children:ReactNode;onClose:()=>void;wide?:boolean;modal?:boolean;specBlockId?:string}) {
  const drawerRef=useRef<HTMLElement>(null),closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    if(!open||!modal)return;
    const prior=document.activeElement instanceof HTMLElement?document.activeElement:undefined,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    requestAnimationFrame(()=>drawerRef.current?.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')?.focus());
    const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape')closeRef.current();};
    addEventListener('keydown',escape);
    return()=>{removeEventListener('keydown',escape);document.body.style.overflow=overflow;prior?.focus();};
  },[open,modal]);
  const trapFocus=(event:KeyboardEvent<HTMLElement>)=>{
    if(!modal||event.key!=='Tab')return;
    const focusable=[...(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')??[])];
    if(!focusable.length){event.preventDefault();drawerRef.current?.focus();return;}
    const first=focusable[0]!,last=focusable.at(-1)!;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  return <>{modal&&open&&<div className={styles.backdrop} role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}/>}<aside ref={drawerRef} className={`${styles.drawer} ${open ? styles.open : ''} ${wide ? styles.wide : ''}`} ui-spec-block-id={specBlockId} aria-hidden={!open} {...(modal?{role:'dialog','aria-modal':true,'aria-label':typeof title==='string'?title:undefined}: {})} tabIndex={-1} onKeyDown={trapFocus}>
    <header>{leading}<strong>{title}</strong><Button variant="ghost" className={styles.close} onClick={onClose} aria-label="Close">×</Button></header>
    <div className={styles.content}>{children}</div>
  </aside></>;
}
