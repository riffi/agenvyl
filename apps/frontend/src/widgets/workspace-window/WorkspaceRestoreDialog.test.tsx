// @vitest-environment jsdom
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {WorkspaceBuildPreview,WorkspaceHistory as HistoryData,WorkspaceRestorePreview,WorkspaceRestoreRecord} from '@agenvyl/contracts';
import {roomsApi} from '../../entities/room';
import {WorkspaceWindow} from './WorkspaceWindow';
import {WorkspaceRestoreDialog} from './WorkspaceRestoreDialog';
import {WorkspaceAppPreview} from './WorkspaceAppPreview';

const history:HistoryData={items:[{kind:'run',id:'bad',agent:'builder',createdAt:'2026-09-10T10:00:00.000Z',status:'failed'}]};
const preview:WorkspaceRestorePreview={target:{kind:'run',id:'bad'},targetHead:'target',fingerprint:'fingerprint',changes:[{path:'src/app.ts',change:'updated'},{path:'extra.txt',change:'deleted'}],affectedRuns:[history.items[0] as WorkspaceRestorePreview['affectedRuns'][number]],savesUncommittedChanges:true,previewRunId:'good',previewAgent:'builder'};
const result:WorkspaceRestoreRecord={kind:'restore',id:'restore',roomId:'room',target:preview.target,targetHead:'target',beforeHead:'before',resultHead:'restored',createdAt:'2026-09-10T11:00:00.000Z',status:'complete'};
const builds:WorkspaceBuildPreview[]=['bad','good'].map(runId=>({runId,agent:'builder',createdAt:'2026-09-10T10:00:00.000Z',runStatus:'completed',sameBuildAsPrevious:false,attachment:{version_id:runId,name:'index.html',path:'index.html',size:1,mime_type:'text/html',url:`/${runId}`,preview_url:`/${runId}`}}));
const mount=(element:React.ReactNode)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>{element}</QueryClientProvider>);
afterEach(()=>{cleanup();vi.restoreAllMocks();});

describe('workspace restoration UI',()=>{
  it('associates undo with its build and identifies the destination build before restoring',async()=>{
    vi.spyOn(roomsApi,'workspace').mockResolvedValue({path:'/room',head:'head',entries:[],previewHistory:builds});
    vi.spyOn(roomsApi,'workspaceHistory').mockResolvedValue(history);
    const inspect=vi.spyOn(roomsApi,'previewWorkspaceRestore').mockResolvedValue(preview);
    const restore=vi.spyOn(roomsApi,'restoreWorkspace').mockResolvedValue(result),change=vi.fn();
    mount(<WorkspaceWindow roomId="room" request={{origin:'workspace',section:'app'}} onClose={vi.fn()} onRequestChange={change}/>);
    fireEvent.click(screen.getByRole('button',{name:'Choose app build'}));
    const number=await screen.findByText('#2'),row=number.closest('button')!.parentElement!;
    fireEvent.click(await within(row).findByRole('button',{name:'Undo this run'}));
    await waitFor(()=>expect(inspect).toHaveBeenCalledWith('room',{kind:'run',id:'bad'}));
    expect(await screen.findByText(/Build #1 .*will become current/)).toBeTruthy();
    expect(screen.getByText(/Build #2 .*Restore the workspace to before this run/)).toBeTruthy();
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Restore workspace'}));
    await waitFor(()=>expect(change).toHaveBeenCalledWith(expect.objectContaining({section:'app',buildRunId:undefined})));
  });
  it('opens restore from the build menu, including runs without a build, and Escape closes only confirmation',async()=>{
    vi.spyOn(roomsApi,'workspace').mockResolvedValue({path:'/room',head:'head',entries:[],previewHistory:[]});
    vi.spyOn(roomsApi,'workspaceHistory').mockResolvedValue(history);
    const close=vi.fn();mount(<WorkspaceWindow roomId="room" request={{origin:'workspace',section:'files'}} onClose={close} onRequestChange={vi.fn()}/>);
    vi.spyOn(roomsApi,'previewWorkspaceRestore').mockResolvedValue(preview);
    expect(screen.queryByRole('button',{name:'Workspace history'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Choose app build'}));
    fireEvent.click(await screen.findByRole('button',{name:'Undo this run'}));
    await screen.findByText('src/app.ts');
    fireEvent.keyDown(document,{key:'Escape'});
    expect(close).not.toHaveBeenCalled();
    await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Restore workspace?'})).toBeNull());
  });
  it('previews files and builds before confirmation and sends the reviewed fingerprint once',async()=>{
    vi.spyOn(roomsApi,'workspaceHistory').mockResolvedValue(history);
    vi.spyOn(roomsApi,'previewWorkspaceRestore').mockResolvedValue(preview);
    const restore=vi.spyOn(roomsApi,'restoreWorkspace').mockResolvedValue(result),done=vi.fn();
    mount(<WorkspaceRestoreDialog roomId="room" choice={{target:preview.target,label:"Build #2"}} builds={[]} onClose={vi.fn()} onRestored={done}/>);
    expect(await screen.findByText('src/app.ts')).toBeTruthy();
    expect(screen.getByText('extra.txt')).toBeTruthy();
    expect(screen.getByText(/Uncommitted changes/)).toBeTruthy();
    expect(screen.getByText(/saved build by @builder/)).toBeTruthy();
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Restore workspace'}));
    await waitFor(()=>expect(done).toHaveBeenCalledOnce());
    expect(restore).toHaveBeenCalledWith('room',{target:preview.target,fingerprint:'fingerprint',requestId:expect.any(String)});
  });
  it('requires a fresh preview after a stale confirmation and explains active-run blocking',async()=>{
    const historyMock=vi.spyOn(roomsApi,'workspaceHistory').mockResolvedValue(history);
    vi.spyOn(roomsApi,'previewWorkspaceRestore').mockResolvedValue(preview);
    vi.spyOn(roomsApi,'restoreWorkspace').mockRejectedValue(Object.assign(new Error('Workspace changed. Review again.'),{code:'workspace_restore_stale'}));
    mount(<WorkspaceRestoreDialog roomId="room" choice={{target:preview.target,label:"Build #2"}} builds={[]} onClose={vi.fn()} onRestored={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Restore workspace'}));
    expect((await screen.findByRole('alert')).textContent).toContain('Workspace changed. Review again.');
    expect(screen.queryByRole('button',{name:'Restore workspace'})).toBeNull();
    cleanup();historyMock.mockResolvedValue({...history,unavailableReason:'Wait for all agents to finish.'});
    mount(<WorkspaceRestoreDialog roomId="room" choice={{target:preview.target,label:"Build #2"}} builds={[]} onClose={vi.fn()} onRestored={vi.fn()}/>);
    expect((await screen.findByRole('button',{name:'Restore workspace'}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Wait for all agents to finish.')).toBeTruthy();
  });
  it('offers recovery for an interrupted operation and a return action for completed rollback',async()=>{
    vi.spyOn(roomsApi,'workspaceHistory').mockResolvedValue({items:[{...result,status:'pending',error:'Recovery interrupted'}],unavailableReason:'Recovery pending'});
    const retry=vi.spyOn(roomsApi,'retryWorkspaceRestore').mockResolvedValue(result),done=vi.fn();
    mount(<WorkspaceRestoreDialog roomId="room" choice={{target:{kind:"restore",id:"restore"},label:"Workspace restored",recovery:true}} builds={[]} onClose={vi.fn()} onRestored={done}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Retry recovery'}));
    await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(retry).toHaveBeenCalledWith('room','restore');
    cleanup();vi.spyOn(roomsApi,'workspaceHistory').mockResolvedValue({items:[result]});
    const inspect=vi.spyOn(roomsApi,'previewWorkspaceRestore').mockResolvedValue({...preview,target:{kind:'restore',id:'restore'}});
    mount(<WorkspaceRestoreDialog roomId="room" choice={{target:{kind:"restore",id:"restore"},label:"Workspace restored"}} builds={[]} onClose={vi.fn()} onRestored={vi.fn()}/>);
    await waitFor(()=>expect(inspect).toHaveBeenCalledWith('room',{kind:'restore',id:'restore'}));
  });
  it('does not silently display a historical build when restored source has no matching build',()=>{
    mount(<WorkspaceAppPreview staticPreview={{status:'build_missing'}} selected={{runId:'old',agent:'builder',createdAt:'2026-09-10',runStatus:'completed',sameBuildAsPrevious:false,attachment:{version_id:'old',name:'index.html',path:'index.html',size:1,mime_type:'text/html',url:'/old',preview_url:'/old'}}} onSelect={vi.fn()} onFiles={vi.fn()}/>);
    expect(screen.getByText('No build for the current workspace')).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });
});
