// @vitest-environment jsdom

import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import type { Run } from '@agenvyl/contracts';
import { RunRequest } from './RunRequest';

const request:NonNullable<Run['request']>={kind:'clarification',prompt:'OpenCode needs additional input',questions:[
  {id:'stack',header:'Stack',question:'Choose a stack',options:[{label:'React'},{label:'Vanilla'}],isOther:false,isSecret:false},
  {id:'sections',header:'Sections',question:'Choose sections',options:[{label:'Hero'},{label:'Music'}],isOther:false,isSecret:false,multiSelect:true},
  {id:'content',header:'Content',question:'Describe the content',isOther:false,isSecret:false},
]};

describe('RunRequest structured clarification carousel',()=>{
  it('renders external-directory approval choices with user-facing labels',async()=>{
    const user=userEvent.setup(),resolve=vi.fn();
    render(<RunRequest request={{kind:'approval',prompt:'Add this directory?',directory:'C:\\work',choices:['allow_directory','deny']}} resolve={resolve}/>);

    expect(screen.getByText('C:\\work')).toBeTruthy();
    await user.click(screen.getByRole('button',{name:'Add directory and allow'}));
    expect(resolve).toHaveBeenCalledWith('allow_directory');
    expect(screen.getByRole('button',{name:'Deny'})).toBeTruthy();
  });

  it('shows one question at a time, preserves answers and submits the complete payload',async()=>{
    const user=userEvent.setup(),resolve=vi.fn();
    render(<RunRequest request={request} resolve={resolve}/>);

    expect(screen.getByText('Question 1 of 3')).toBeTruthy();
    expect(screen.getByText('Choose a stack')).toBeTruthy();
    expect(screen.queryByText('Choose sections')).toBeNull();
    expect((screen.getByRole('button',{name:'Next'}) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('radio',{name:'React'}));
    await user.click(screen.getByRole('button',{name:'Next'}));
    await user.click(screen.getByRole('checkbox',{name:'Hero'}));
    await user.click(screen.getByRole('checkbox',{name:'Music'}));
    await user.click(screen.getByRole('button',{name:'Back'}));
    expect((screen.getByRole('radio',{name:'React'}) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button',{name:'Next'}));
    expect((screen.getByRole('checkbox',{name:'Hero'}) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox',{name:'Music'}) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button',{name:'Next'}));
    await user.type(screen.getByPlaceholderText('Your response…'),'Ready');
    await user.click(screen.getByRole('button',{name:'Respond'}));

    expect(resolve).toHaveBeenCalledWith({answers:{stack:['React'],sections:['Hero','Music'],content:['Ready']}});
  });
});
