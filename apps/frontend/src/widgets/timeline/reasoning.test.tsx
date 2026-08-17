// @vitest-environment jsdom

import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import {afterEach, describe, expect, it,vi } from 'vitest';
import { ReasoningBlock, UpstreamStatusNotice } from './Timeline';

afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals()});

const openReasoning=async()=>{
  fireEvent.click(screen.getByText('Reasoning').closest('summary')!);
  return screen.findByRole('region',{name:'Reasoning output'});
};

const setScrollMetrics=(body:HTMLElement,{height,clientHeight,top}:{height:number;clientHeight:number;top:number})=>{
  Object.defineProperty(body,'scrollHeight',{configurable:true,value:height});
  Object.defineProperty(body,'clientHeight',{configurable:true,value:clientHeight});
  body.scrollTop=top;
};

describe('ReasoningBlock', () => {
  it('renders reasoning in a collapsed disclosure by default', async() => {
    const {container}=render(<ReasoningBlock text={'**Planning**\n\n- inspect data\n- render safely'} />);
    const details=container.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.dataset.streaming).toBeUndefined();
    expect(screen.queryByText('Planning')).toBeNull();
    await openReasoning();
    expect(screen.getByText('Planning').tagName).toBe('STRONG');
    expect(screen.getByText('inspect data').tagName).toBe('LI');
  });

  it('keeps a streaming block active when it is expanded', async() => {
    const {container}=render(<ReasoningBlock text="Waiting for a result" isStreaming />);
    const details=container.querySelector('details') as HTMLDetailsElement;
    expect(details.dataset.streaming).toBe('true');
    const body=await openReasoning();
    expect(details.open).toBe(true);
    expect(details.dataset.streaming).toBe('true');
    expect(body.querySelector('span[aria-hidden="true"]')).toBeTruthy();
  });

  it('does not load images embedded in reasoning markdown',async()=>{
    const {container}=render(<ReasoningBlock text="![private diagram](https://example.com/diagram.png)"/>);
    await openReasoning();
    expect(screen.getByText('[Image omitted: private diagram]')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('https://example.com/diagram.png');
  });

  it('restores paragraph boundaries in reasoning persisted by the legacy Codex adapter',async()=>{
    const {container}=render(<ReasoningBlock harnessType="codex" text="**Inspecting data****Summarizing results**"/>);
    await openReasoning();
    expect(container.innerHTML).toContain('<p><strong>Inspecting data</strong></p>');
    expect(container.innerHTML).toContain('<p><strong>Summarizing results</strong></p>');
  });

  it('coalesces live markdown updates into the latest 250ms snapshot',()=>{
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const view=render(<ReasoningBlock text="Initial reasoning" isStreaming/>);
    const details=document.querySelector('details') as HTMLDetailsElement;
    Object.defineProperty(details,'open',{configurable:true,value:true,writable:true});
    fireEvent(details,new Event('toggle'));
    expect(screen.getByRole('region',{name:'Reasoning output'})).toBeTruthy();
    view.rerender(<ReasoningBlock text="Intermediate reasoning" isStreaming/>);
    view.rerender(<ReasoningBlock text="Latest reasoning" isStreaming/>);
    expect(screen.queryByText('Latest reasoning')).toBeNull();
    act(()=>vi.advanceTimersByTime(249));
    expect(screen.queryByText('Latest reasoning')).toBeNull();
    act(()=>vi.advanceTimersByTime(1));
    expect(screen.getByText('Latest reasoning')).toBeTruthy();
    expect(screen.queryByText('Intermediate reasoning')).toBeNull();
  });

  it('flushes the latest snapshot immediately when a followed stream stops',()=>{
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const view=render(<ReasoningBlock text="Initial reasoning" isStreaming/>);
    const details=document.querySelector('details') as HTMLDetailsElement;
    Object.defineProperty(details,'open',{configurable:true,value:true,writable:true});
    fireEvent(details,new Event('toggle'));
    view.rerender(<ReasoningBlock text="Final reasoning" isStreaming/>);
    expect(screen.queryByText('Final reasoning')).toBeNull();
    view.rerender(<ReasoningBlock text="Final reasoning" isStreaming={false}/>);
    expect(screen.getByText('Final reasoning')).toBeTruthy();
  });

  it('freezes markdown while scrolled up and applies the final snapshot on demand',async()=>{
    const view=render(<ReasoningBlock text="Initial reasoning" isStreaming/>);
    const body=await openReasoning();
    setScrollMetrics(body,{height:500,clientHeight:100,top:120});
    fireEvent.scroll(body);
    expect(screen.getByRole('button',{name:'Jump to latest'})).toBeTruthy();
    vi.useFakeTimers();
    view.rerender(<ReasoningBlock text="Final reasoning" isStreaming/>);
    act(()=>vi.advanceTimersByTime(500));
    expect(screen.queryByText('Final reasoning')).toBeNull();
    view.rerender(<ReasoningBlock text="Final reasoning" isStreaming={false}/>);
    expect(screen.queryByText('Final reasoning')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Jump to latest'}));
    expect(screen.getByText('Final reasoning')).toBeTruthy();
    expect(body.scrollTop).toBe(400);
    expect(screen.queryByRole('button',{name:'Jump to latest'})).toBeNull();
  });

  it('resumes follow when the user returns within 24px of the bottom',async()=>{
    const view=render(<ReasoningBlock text="Initial reasoning" isStreaming/>);
    const body=await openReasoning();
    setScrollMetrics(body,{height:500,clientHeight:100,top:120});
    fireEvent.scroll(body);
    view.rerender(<ReasoningBlock text="Current reasoning" isStreaming/>);
    expect(screen.queryByText('Current reasoning')).toBeNull();
    body.scrollTop=376;
    fireEvent.scroll(body);
    expect(screen.getByText('Current reasoning')).toBeTruthy();
    expect(body.scrollTop).toBe(400);
    expect(screen.queryByRole('button',{name:'Jump to latest'})).toBeNull();
  });

  it('smoothly follows a new snapshot when motion is allowed',async()=>{
    const frames:FrameRequestCallback[]=[];
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true})));
    vi.stubGlobal('requestAnimationFrame',vi.fn((callback:FrameRequestCallback)=>{frames.push(callback);return frames.length}));
    vi.stubGlobal('cancelAnimationFrame',vi.fn());
    const view=render(<ReasoningBlock text="Initial reasoning" isStreaming/>);
    const body=await openReasoning();
    setScrollMetrics(body,{height:500,clientHeight:100,top:400});
    Object.defineProperty(body,'scrollHeight',{configurable:true,value:600});
    view.rerender(<ReasoningBlock text="Final reasoning" isStreaming={false}/>);
    expect(frames).toHaveLength(1);
    const now=performance.now();
    act(()=>frames.shift()!(now+75));
    expect(body.scrollTop).toBeGreaterThan(400);
    expect(body.scrollTop).toBeLessThan(500);
    act(()=>frames.shift()!(now+200));
    expect(body.scrollTop).toBe(500);
  });

  it('follows immediately when motion is not allowed',async()=>{
    const requestFrame=vi.fn();
    vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
    vi.stubGlobal('requestAnimationFrame',requestFrame);
    const view=render(<ReasoningBlock text="Initial reasoning" isStreaming/>);
    const body=await openReasoning();
    setScrollMetrics(body,{height:500,clientHeight:100,top:400});
    Object.defineProperty(body,'scrollHeight',{configurable:true,value:600});
    view.rerender(<ReasoningBlock text="Final reasoning" isStreaming={false}/>);
    expect(body.scrollTop).toBe(500);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('cancels pending work, then shows the latest snapshot and resumes follow when reopened',()=>{
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const view=render(<ReasoningBlock text="Initial reasoning" isStreaming/>);
    const details=document.querySelector('details') as HTMLDetailsElement;
    Object.defineProperty(details,'open',{configurable:true,value:true,writable:true});
    fireEvent(details,new Event('toggle'));
    view.rerender(<ReasoningBlock text="Pending reasoning" isStreaming/>);
    expect(vi.getTimerCount()).toBe(1);
    details.open=false;
    fireEvent(details,new Event('toggle'));
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(<ReasoningBlock text="Newest reasoning" isStreaming/>);
    details.open=true;
    fireEvent(details,new Event('toggle'));
    expect(screen.getByText('Newest reasoning')).toBeTruthy();
  });
});

describe('UpstreamStatusNotice',()=>{
  it('presents provider retry as a run-local transient state',()=>{
    const html=renderToStaticMarkup(<UpstreamStatusNotice status={{state:'retrying',reason:'provider_unavailable',retryable:true,attempt:3}}/>);
    expect(html).toContain('The provider is temporarily unavailable. Retrying…');
    expect(html).toContain('Attempt 3');
    expect(html).toContain('role="status"');
  });
});
