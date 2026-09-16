// @vitest-environment jsdom
import {useState} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {projectFilesApi} from '../../entities/project';
import {WorkspaceWindow} from './WorkspaceWindow';
import {applyWorkspaceRequestUpdate,type WorkspaceOpenRequest} from './workspaceModel';
import {ProjectReferenceContext} from '../../shared/project-references/ProjectReferenceContext';

vi.mock('../../shared/features',async importOriginal=>({...await importOriginal<typeof import('../../shared/features')>(),IsolatedHtmlPreview:({previewUrl}:{previewUrl:string})=><iframe title="Project preview" src={previewUrl}/>}));
vi.mock('./WorkspaceContent',()=>({WorkspaceContent:({attachment}:{attachment:{path:string;url:string}})=><a href={attachment.url}>Content: {attachment.path}</a>}));
const project={id:'project',name:'My project',path:'C:/project',availability:'available' as const};
const file={name:'notes.txt',path:'notes.txt',kind:'file' as const,size:8,modified:'2026-09-16T00:00:00Z',mime_type:'text/plain'};
const inspect={candidates:['dist/index.html'],entrypoint:'dist/index.html',detected_command:'npm run build',build_command:'npm run build',settings:{entrypoint:null,build_command:null},build:null,scan_truncated:false};
beforeEach(()=>{
  localStorage.clear();
  vi.stubGlobal('matchMedia',()=>({matches:false}));
  vi.spyOn(projectFilesApi,'list').mockResolvedValue({entries:[file],truncated:false});
  vi.spyOn(projectFilesApi,'inspect').mockResolvedValue(inspect);
  vi.spyOn(projectFilesApi,'buildStatus').mockResolvedValue(null);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function mount(onAttach=vi.fn()){
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  function Host(){const[request,setRequest]=useState<WorkspaceOpenRequest>({origin:'workspace'});return <WorkspaceWindow roomId="room" project={project} request={request} onClose={()=>{}} onRequestChange={update=>setRequest(current=>applyWorkspaceRequestUpdate(current,update))} onAttach={onAttach}/>;}
  render(<QueryClientProvider client={client}><Host/></QueryClientProvider>);return client;
}
describe('project viewer',()=>{
  it('opens a referenced file and inserts folder references from the tree',async()=>{
    const directory={...file,name:'src',path:'src',kind:'directory' as const},nested={...file,path:'src/notes.txt'};
    vi.mocked(projectFilesApi.list).mockImplementation(async(_id,path)=>({entries:path==='src'?[nested]:[directory],truncated:false}));
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),insert=vi.fn();
    const reference={projectId:project.id,projectName:project.name,root:project.path,path:nested.path,kind:'file' as const};
    render(<QueryClientProvider client={client}><ProjectReferenceContext.Provider value={{open:vi.fn(),insert}}><WorkspaceWindow roomId="room" project={project} request={{origin:'workspace',source:'project',section:'files',projectReference:reference}} onClose={vi.fn()} onRequestChange={vi.fn()}/></ProjectReferenceContext.Provider></QueryClientProvider>);
    expect(await screen.findByText('Content: src/notes.txt')).toBeTruthy();
    expect((await screen.findByRole('button',{name:'src'})).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button',{name:'Reference src in chat'}));
    expect(insert).toHaveBeenCalledWith({...reference,path:'src',kind:'directory'});
  });
  it('does not retarget a reference when the registered project root changes',()=>{
    const reference={projectId:project.id,projectName:project.name,root:'C:/original-project',path:file.path,kind:'file' as const};
    render(<QueryClientProvider client={new QueryClient()}><WorkspaceWindow roomId="room" project={project} request={{origin:'workspace',source:'project',projectReference:reference}} onClose={vi.fn()} onRequestChange={vi.fn()}/></QueryClientProvider>);
    expect(screen.getByRole('dialog',{name:'Project reference unavailable'})).toBeTruthy();
    expect(projectFilesApi.list).not.toHaveBeenCalled();
  });
  it('defaults to the current app, opens files and snapshots attachments only on Attach',async()=>{
    const captured={version_id:'saved',name:'notes.txt',path:'snapshots/notes.txt',size:8,mime_type:'text/plain',url:'/saved',preview_url:'/saved/preview'};
    const attach=vi.spyOn(projectFilesApi,'attach').mockResolvedValue(captured),onAttach=vi.fn();mount(onAttach);
    expect((await screen.findByTitle('Project preview')).getAttribute('src')).toContain('/projects/project/preview/');
    fireEvent.click(await screen.findByRole('button',{name:'notes.txt'}));
    expect(await screen.findByText('Content: notes.txt')).toBeTruthy();
    expect(attach).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Project actions'));
    fireEvent.click(screen.getByRole('button',{name:'Attach to message'}));
    await waitFor(()=>expect(onAttach).toHaveBeenCalledWith(captured));
    expect(attach).toHaveBeenCalledWith('project','room','notes.txt');
    expect(screen.queryByRole('button',{name:'Upload files'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Trash'})).toBeNull();
  });
  it('shows equal build choices, supports overriding and resetting detection',async()=>{
    vi.mocked(projectFilesApi.inspect).mockResolvedValue({...inspect,candidates:['apps/a/dist/index.html','apps/b/dist/index.html'],entrypoint:null});
    const save=vi.spyOn(projectFilesApi,'saveSettings').mockResolvedValue({entrypoint:null,build_command:null});mount();
    fireEvent.click(await screen.findByRole('button',{name:'apps/b/dist/index.html'}));
    await waitFor(()=>expect(save).toHaveBeenCalledWith('project',{entrypoint:'apps/b/dist/index.html',build_command:null}));
    fireEvent.click(screen.getByLabelText('Project actions'));fireEvent.click(screen.getByRole('button',{name:'Build settings…'}));
    fireEvent.change(screen.getByLabelText('Build command'),{target:{value:'pnpm custom'}});
    fireEvent.click(screen.getByRole('button',{name:'Save'}));
    await waitFor(()=>expect(save).toHaveBeenCalledWith('project',{entrypoint:null,build_command:'pnpm custom'}));
  });
});
