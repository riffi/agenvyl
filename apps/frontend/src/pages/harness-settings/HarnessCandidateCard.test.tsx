import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import type {SetupHarnessCandidate,SetupHarnessInstance} from '@agenvyl/contracts';
import {HarnessCandidateCard} from './HarnessCandidateCard';

const candidate:SetupHarnessCandidate={type:'codex',label:'Codex',cli:{found:true,command:'codex',version:'0.145.0',compatible:true},safeToSelect:true,supportsManagedServer:false};
const render=(value:SetupHarnessCandidate,instances:SetupHarnessInstance[]=[])=>renderToStaticMarkup(<HarnessCandidateCard candidate={value} instances={instances} connecting={false} connectDisabled={false} onConnect={vi.fn()} onRescan={vi.fn()}/>);

describe('HarnessCandidateCard',()=>{
  it('offers one-click connection for a ready discovered harness',()=>{
    const html=render(candidate);
    expect(html).toContain('Ready to connect');
    expect(html).toContain('codex 0.145.0');
    expect(html).toContain('>Connect</button>');
  });

  it('surfaces actionable discovery warnings instead of an unavailable runtime status',()=>{
    const html=render({...candidate,cli:{found:false,command:'codex',compatible:false},safeToSelect:false,warning:'Install Codex CLI 0.145.0 or newer and run codex login.'});
    expect(html).toContain('Not detected');
    expect(html).toContain('Install Codex CLI 0.145.0 or newer and run codex login.');
    expect(html).toContain('Check again');
  });

  it('derives connected state only from saved instances',()=>{
    const html=render(candidate,[{id:'local-codex',type:'codex',enabled:true}]);
    expect(html).toContain('Connected');
    expect(html).toContain('1 configured instance.');
    expect(html).not.toContain('>Connect</button>');
  });
});
