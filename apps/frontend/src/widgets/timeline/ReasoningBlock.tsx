import {memo,useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {SyntheticEvent} from 'react';
import {ArrowDown,Brain,ChevronDown} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Timeline.module.css';

const markdownUpdateInterval=250;
const followThreshold=24;

type ReasoningBlockProps={text:string;harnessType?:string;isStreaming?:boolean};

export const ReasoningBlock=memo(({text,harnessType,isStreaming=false}:ReasoningBlockProps)=>{
  const [open,setOpen]=useState(false);
  const [following,setFollowing]=useState(true);
  const [renderedText,setRenderedText]=useState(text);
  const bodyRef=useRef<HTMLDivElement>(null);
  const latestTextRef=useRef(text);
  const renderedTextRef=useRef(text);
  const openRef=useRef(false);
  const followingRef=useRef(true);
  const timerRef=useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastRenderAtRef=useRef(Date.now());

  useLayoutEffect(()=>{latestTextRef.current=text},[text]);

  const clearRenderTimer=useCallback(()=>{
    if(timerRef.current!==undefined)clearTimeout(timerRef.current);
    timerRef.current=undefined;
  },[]);

  const renderLatest=useCallback(()=>{
    clearRenderTimer();
    lastRenderAtRef.current=Date.now();
    const latest=latestTextRef.current;
    if(renderedTextRef.current===latest)return;
    renderedTextRef.current=latest;
    setRenderedText(latest);
  },[clearRenderTimer]);

  const updateFollowing=useCallback((next:boolean)=>{
    followingRef.current=next;
    setFollowing(next);
    if(!next)clearRenderTimer();
  },[clearRenderTimer]);

  useEffect(()=>{
    if(!openRef.current||!followingRef.current){clearRenderTimer();return;}
    if(!isStreaming){renderLatest();return;}
    if(renderedTextRef.current===text)return;
    const elapsed=Date.now()-lastRenderAtRef.current;
    if(elapsed>=markdownUpdateInterval){renderLatest();return;}
    if(timerRef.current===undefined)timerRef.current=setTimeout(()=>{
      timerRef.current=undefined;
      if(openRef.current&&followingRef.current)renderLatest();
    },markdownUpdateInterval-elapsed);
  },[clearRenderTimer,isStreaming,renderLatest,text]);

  useEffect(()=>()=>clearRenderTimer(),[clearRenderTimer]);

  useLayoutEffect(()=>{
    const body=bodyRef.current;
    if(!open||!following||!body)return;
    body.scrollTop=body.scrollHeight;
  },[following,open,renderedText]);

  const toggle=(event:SyntheticEvent<HTMLDetailsElement>)=>{
    const nextOpen=event.currentTarget.open;
    openRef.current=nextOpen;
    setOpen(nextOpen);
    if(!nextOpen){clearRenderTimer();return;}
    updateFollowing(true);
    renderLatest();
  };

  const scroll=()=>{
    const body=bodyRef.current;
    if(!body)return;
    const atBottom=body.scrollHeight-body.scrollTop-body.clientHeight<=followThreshold;
    if(atBottom){
      if(!followingRef.current){updateFollowing(true);renderLatest();}
    }else if(followingRef.current)updateFollowing(false);
  };

  const jumpToLatest=()=>{
    updateFollowing(true);
    renderLatest();
  };

  return <details className={styles.reasoning} data-streaming={isStreaming?'true':undefined} onToggle={toggle}>
    <summary><Brain className={styles['reasoning-icon']} aria-hidden="true"/><span>Reasoning</span><ChevronDown className={styles['reasoning-chevron']} aria-hidden="true"/></summary>
    {open&&<div className={styles.reasoningPanel}>
      <div ref={bodyRef} className={styles.reasoningBody} role="region" aria-label="Reasoning output" tabIndex={0} onScroll={scroll}>
        <ReasoningMarkdown text={renderedText} harnessType={harnessType}/>
      </div>
      {!following&&<button className={styles.reasoningLatest} type="button" onClick={jumpToLatest}><ArrowDown aria-hidden="true"/><span>Jump to latest</span></button>}
    </div>}
  </details>;
});

ReasoningBlock.displayName='ReasoningBlock';

const ReasoningMarkdown=memo(({text,harnessType}:{text:string;harnessType?:string})=>{
  const markdown=harnessType==='codex'?text.replaceAll('****','**\n\n**'):text;
  return <Markdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    components={{
      a:({node:_node,...props})=><a {...props} target="_blank" rel="noopener noreferrer"/>,
      img:({node:_node,alt})=><span className={styles.reasoningImage}>[Image omitted{alt?.trim()?`: ${alt.trim()}`:''}]</span>,
    }}
  >{markdown}</Markdown>;
});

ReasoningMarkdown.displayName='ReasoningMarkdown';
