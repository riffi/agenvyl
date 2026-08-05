// @vitest-environment jsdom
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {RouterProvider,createMemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {HarnessSettingsState} from '@agenvyl/contracts';
import {HarnessSettingsPage} from './HarnessSettingsPage';

const cache={state:'fresh' as const,refreshedAt:null,expiresAt:null};
const settings:HarnessSettingsState={connectorEpoch:'epoch',discoveryCache:cache,candidates:[
  {type:'opencode',label:'OpenCode',cli:{found:true,command:'opencode',version:'1.18.4'},endpoint:{url:'http://127.0.0.1:4096',reachable:true},safeToSelect:true,supportsManagedServer:true},
  {type:'codex',label:'Codex',cli:{found:true,command:'codex',version:'0.145.0'},safeToSelect:true,supportsManagedServer:false},
  {type:'hermes',label:'Hermes',cli:{found:true,command:'hermes'},endpoint:{url:'http://127.0.0.1:8642',reachable:true},safeToSelect:true,supportsManagedServer:false},
],instances:[
  {id:'local-opencode',type:'opencode',enabled:true,endpoint:'http://127.0.0.1:4096',managed:true,externalDirectoryRoots:[],status:'healthy',capabilities:['model_catalog'],personas:[]},
  {id:'local-codex',type:'codex',enabled:false,status:'disabled',capabilities:[],personas:[{id:'agent',name:'Builder',handle:'builder',archived:false}]},
]};

let requests:Array<{url:string;method:string;body?:unknown}>=[],testHealthy=true;
beforeEach(()=>{
  requests=[];testHealthy=true;vi.stubGlobal('confirm',vi.fn(()=>true));vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 1;});
  vi.stubGlobal('fetch',vi.fn<typeof fetch>(async(input,init)=>{const url=String(input),method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):undefined;requests.push({url,method,body});
    if(url==='/api/v1/harness-settings/test')return Response.json(testHealthy?{instanceId:(body as {instance:{id:string}}).instance.id,status:'healthy',capabilities:[]}:{instanceId:(body as {instance:{id:string}}).instance.id,status:'unavailable',capabilities:[],error:{code:'connection_test_failed',message:'Harness connection test failed'}});
    if(url==='/api/v1/harnesses/local-opencode/restart'&&method==='POST')return Response.json({instanceId:'local-opencode',status:'healthy',models:[{id:'fresh-model'}]});
    if(url==='/api/v1/harness-settings'&&method==='PUT')return Response.json({});
    if(url==='/api/v1/harnesses?refresh=true')return Response.json({connectorEpoch:'epoch',cache,instances:[]});
    if(url.startsWith('/api/v1/harness-settings'))return Response.json(settings);
    return new Response('{}',{status:404});
  }));
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

const renderPage=(entry='/settings/harnesses')=>{const router=createMemoryRouter([{path:'/settings/harnesses',element:<HarnessSettingsPage/>},{path:'/settings/harnesses/:instanceId',element:<HarnessSettingsPage/>}],{initialEntries:[entry]});render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><RouterProvider router={router}/></QueryClientProvider>);return router;};

describe('HarnessSettingsPage',()=>{
  it('shows configured instances once and leaves the desktop detail unselected',async()=>{
    renderPage();expect(await screen.findByText('Select a harness')).toBeTruthy();expect(screen.queryByText('Available harnesses')).toBeNull();
    expect(screen.getAllByText('local-opencode')).toHaveLength(1);expect(screen.getByText('Not checked')).toBeTruthy();
  });

  it('guards a dirty draft when selecting another instance',async()=>{
    const user=userEvent.setup(),router=renderPage('/settings/harnesses/local-opencode');
    const endpoint=await screen.findByRole('textbox',{name:'Endpoint'});fireEvent.change(endpoint,{target:{value:'http://127.0.0.1:4999'}});
    await user.click(screen.getByRole('button',{name:/local-codex/i}));expect(await screen.findByRole('dialog',{name:'Unsaved harness changes'})).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'Discard'}));await waitFor(()=>expect(router.state.location.pathname).toBe('/settings/harnesses/local-codex'));
  });

  it('tests the current draft without saving it',async()=>{
    const user=userEvent.setup();renderPage('/settings/harnesses/local-opencode');
    const endpoint=await screen.findByRole('textbox',{name:'Endpoint'});await user.clear(endpoint);await user.type(endpoint,'http://127.0.0.1:4999');await user.click(screen.getByRole('button',{name:'Test connection'}));
    expect(await screen.findByText('Connection is healthy.')).toBeTruthy();expect(requests.some(request=>request.method==='PUT')).toBe(false);
    expect(requests.find(request=>request.url.endsWith('/test'))?.body).toMatchObject({instance:{endpoint:'http://127.0.0.1:4999'}});
  });

  it('confirms managed OpenCode restart and refreshes settings and catalog',async()=>{
    const user=userEvent.setup();renderPage('/settings/harnesses/local-opencode');
    const restart=await screen.findByRole('button',{name:'Restart OpenCode'});await user.click(restart);
    expect(vi.mocked(confirm)).toHaveBeenCalled();
    await waitFor(()=>expect(requests.some(request=>request.url==='/api/v1/harnesses/local-opencode/restart'&&request.method==='POST')).toBe(true));
    expect(await screen.findByText('local-opencode restarted with a fresh model catalog.')).toBeTruthy();
    expect(requests.some(request=>request.url==='/api/v1/harnesses?refresh=true')).toBe(true);
  });

  it('keeps an add draft when preflight fails',async()=>{
    testHealthy=false;const user=userEvent.setup();renderPage();await screen.findByText('Select a harness');await user.click(screen.getByRole('button',{name:'Add harness'}));
    await user.click(screen.getByRole('button',{name:'Configure'}));expect(await screen.findByDisplayValue('local-hermes')).toBeTruthy();const addButton=screen.getByRole('button',{name:'Add & test'});expect(addButton.hasAttribute('disabled')).toBe(false);await user.click(addButton);
    await waitFor(()=>expect(requests.some(request=>request.url.endsWith('/test'))).toBe(true));expect(await screen.findByText(/Harness connection test failed/)).toBeTruthy();expect(screen.getByDisplayValue('local-hermes')).toBeTruthy();expect(requests.some(request=>request.method==='PUT')).toBe(false);
  });
});
