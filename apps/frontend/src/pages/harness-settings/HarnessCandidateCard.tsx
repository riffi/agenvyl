import type {SetupHarnessCandidate,SetupHarnessInstance} from '@agenvyl/contracts';
import {Check,RefreshCw} from 'lucide-react';
import {HarnessIcon} from '../../entities/harness';
import {Button} from '../../shared/ui';
import {harnessCandidateDetail,harnessCandidateState,type HarnessCandidateState} from './harnessSettingsModel';
import styles from './HarnessSettingsPage.module.css';

const labelOf:Record<HarnessCandidateState,string>={connected:'Connected',ready:'Ready to connect',setup:'Setup required',missing:'Not detected'};

export const HarnessCandidateCard=({candidate,instances,connecting,connectDisabled,onConnect,onRescan}:{candidate:SetupHarnessCandidate;instances:SetupHarnessInstance[];connecting:boolean;connectDisabled:boolean;onConnect:()=>void;onRescan:()=>void})=>{
  const connectedInstances=instances.filter(instance=>instance.type===candidate.type);
  const state=harnessCandidateState(candidate,connectedInstances.length>0);
  return <article className={`${styles.candidate} ${styles[`candidate_${state}`]}`}>
    <header><HarnessIcon type={candidate.type} size="md"/><span><strong>{candidate.label}</strong><small>{labelOf[state]}</small></span><i/></header>
    <p>{state==='connected'?`${connectedInstances.length} configured instance${connectedInstances.length===1?'':'s'}.`:harnessCandidateDetail(candidate,state)}</p>
    <footer>
      <code>{candidate.cli.version?`${candidate.cli.command} ${candidate.cli.version}`:candidate.cli.command}</code>
      {state==='connected'?<span className={styles.connectedMark}><Check/>Connected</span>:state==='ready'?<Button type="button" variant="primary" disabled={connecting||connectDisabled} title={connectDisabled?'Save or discard pending changes before connecting another harness':undefined} onClick={onConnect}>{connecting?'Connecting…':'Connect'}</Button>:<Button type="button" variant="ghost" disabled={connectDisabled} title={connectDisabled?'Save or discard pending changes before rescanning':undefined} icon={<RefreshCw/>} onClick={onRescan}>Check again</Button>}
    </footer>
  </article>;
};
