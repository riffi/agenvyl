// @vitest-environment jsdom

import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ImplementationHandoff} from './ImplementationHandoff';

afterEach(cleanup);

describe('ImplementationHandoff',()=>{
  it('requires an explicit choice when several agents are available and preserves the idempotency key on retry',async()=>{
    const onStart=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined),onClose=vi.fn();
    render(<ImplementationHandoff targets={[{handle:'sol',name:'Sol',detail:'Codex',color:'#334155'},{handle:'deep',name:'Deep',detail:'DeepSeek',color:'#0f766e'}]} initialTargets={[]} onStart={onStart} onClose={onClose}/>);
    const start=screen.getByRole('button',{name:'Start with 0 agents'}) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox',{name:/Deep/}));
    fireEvent.click(screen.getByRole('button',{name:'Start with 1 agent'}));
    await waitFor(()=>expect(screen.getByRole('alert')).toBeTruthy());
    fireEvent.click(screen.getByRole('button',{name:'Start with 1 agent'}));
    await waitFor(()=>expect(onClose).toHaveBeenCalled());
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStart.mock.calls[0][0]).toMatchObject({text:'Implement the approved plan.',targets:['deep'],messageId:expect.any(String)});
    expect(onStart.mock.calls[1][0].messageId).toBe(onStart.mock.calls[0][0].messageId);
  });
});
