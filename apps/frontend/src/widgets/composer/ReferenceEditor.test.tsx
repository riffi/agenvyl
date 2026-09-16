// @vitest-environment jsdom
import {createRef,useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {projectReferenceToken} from '@agenvyl/contracts';
import {ProjectReferenceContext} from '../../shared/project-references/ProjectReferenceContext';
import {ReferenceEditor,referenceEditorText,type ReferenceEditorElement} from './ReferenceEditor';
const reference={projectId:'project',projectName:'Project',root:'/original',path:'src/main.ts',kind:'file' as const};
const token=projectReferenceToken(reference);
afterEach(cleanup);
function mount(value=`before ${token} after`){
  const ref=createRef<ReferenceEditorElement>(),change=vi.fn(),key=vi.fn(),open=vi.fn(),references=new Map([[token,reference]]);
  function Host(){const[text,setText]=useState(value);return <ProjectReferenceContext.Provider value={{open,insert:vi.fn()}}><ReferenceEditor ref={ref} value={text} initialValue="before  after" references={references} label="Message" maxLength={1000} onChange={(next,caret)=>{change(next,caret);setText(next);}} onSelect={vi.fn()} onKeyDown={key} onPaste={vi.fn()} onBlur={vi.fn()}/></ProjectReferenceContext.Provider>;}
  render(<Host/>);return{ref,change,key,open,references,editor:screen.getByRole('textbox',{name:'Message'})};
}
it('renders one atomic chip with a short name and full path tooltip',()=>{
  const{editor}=mount();expect(editor.textContent).toBe('before main.ts× after');expect(editor.textContent).not.toContain('⟦');
  const chip=screen.getByRole('button',{name:'Open src/main.ts'}).parentElement!;
  expect(chip.contentEditable).toBe('false');expect(chip.title).toBe('Project: /original/src/main.ts');
  expect(referenceEditorText(editor)).toBe(`before ${token} after`);
});
it('deletes an entire chip with Backspace and restores it with Undo',()=>{
  const{ref,editor,change}=mount();act(()=>{ref.current!.focus();ref.current!.setSelectionRange(7+token.length,7+token.length);});
  fireEvent.keyDown(editor,{key:'Backspace'});expect(change).toHaveBeenLastCalledWith('before  after',7);
  expect(screen.queryByRole('button',{name:'Open src/main.ts'})).toBeNull();
  fireEvent.keyDown(editor,{key:'z',ctrlKey:true});expect(screen.getByRole('button',{name:'Open src/main.ts'})).toBeTruthy();
  fireEvent.keyDown(editor,{key:'z',ctrlKey:true,shiftKey:true});expect(screen.queryByRole('button',{name:'Open src/main.ts'})).toBeNull();
});
it('moves the caret across the complete token and inserts line breaks around it',()=>{
  const{ref,editor,change}=mount();act(()=>{ref.current!.focus();ref.current!.setSelectionRange(7,7);});
  fireEvent.keyDown(editor,{key:'ArrowRight'});expect(ref.current!.selectionStart).toBe(7+token.length);
  fireEvent.keyDown(editor,{key:'Enter',shiftKey:true});expect(change).toHaveBeenLastCalledWith(`before ${token}\n after`,8+token.length);
});
it('copies reference metadata, pastes it as a chip, and ignores rich HTML',()=>{
  const{ref,editor}=mount();act(()=>{ref.current!.focus();ref.current!.setSelectionRange(7,7+token.length);});
  const data=new Map<string,string>(),clipboardData={setData:(type:string,value:string)=>data.set(type,value),getData:(type:string)=>data.get(type)??''};
  fireEvent.copy(editor,{clipboardData});expect(data.get('application/x-agenvyl-project-references')).toContain('[[project:');
  act(()=>ref.current!.setSelectionRange(0,0));fireEvent.paste(editor,{clipboardData});
  expect(screen.getAllByRole('button',{name:'Open src/main.ts'})).toHaveLength(2);
});
it('removes only the chosen chip and does not send on keyboard activation of a chip button',()=>{
  const{key,change}=mount();const remove=screen.getByRole('button',{name:'Remove reference src/main.ts'});
  fireEvent.keyDown(remove,{key:'Enter'});expect(key).not.toHaveBeenCalled();fireEvent.click(remove);expect(change).toHaveBeenLastCalledWith('before  after',7);
});
it('does not dispatch an Enter used to confirm IME composition',()=>{
  const{editor,key}=mount();fireEvent.compositionStart(editor);fireEvent.keyDown(editor,{key:'Enter',isComposing:true});expect(key).not.toHaveBeenCalled();fireEvent.compositionEnd(editor);
});
