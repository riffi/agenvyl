import type {HarnessSettingsInstance,SetupHarnessCandidate} from '@agenvyl/contracts';
import {ChevronRight} from 'lucide-react';
import {HarnessIcon} from '../../entities/harness';
import {configurationStatus,healthStatus} from './harnessSettingsModel';
import styles from './HarnessSettingsPage.module.css';

const healthLabel={healthy:'Healthy',degraded:'Degraded',unavailable:'Unavailable'} as const;

export const HarnessInstanceRow=({instance,candidate,selected,onSelect}:{instance:HarnessSettingsInstance;candidate?:SetupHarnessCandidate;selected:boolean;onSelect:()=>void})=>{
  const health=healthStatus(instance),configuration=configurationStatus(instance),secondary=instance.endpoint??candidate?.cli.version;
  return <button type="button" className={`${styles.instanceRow} ${selected?styles.selectedRow:''}`} aria-current={selected?'page':undefined} onClick={onSelect}>
    <HarnessIcon type={instance.type} size="md"/>
    <span className={styles.rowIdentity}><strong>{instance.id}</strong><small>{instance.type}{secondary?` · ${secondary}`:''}</small></span>
    <span className={styles.rowMeta}>
      <span className={`${styles.health} ${health?styles[`health_${health}`]:styles.health_idle}`}><i/>{health?healthLabel[health]:'Not checked'}</span>
      <small>{configuration==='disabled'?'Disabled':`${instance.personas.length} agent${instance.personas.length===1?'':'s'}`}</small>
    </span>
    <ChevronRight aria-hidden="true"/>
  </button>;
};
