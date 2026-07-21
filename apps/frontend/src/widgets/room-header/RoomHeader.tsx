import { FolderOpen, Menu, Users } from 'lucide-react';
import type { Persona } from '../../entities/persona';
import type { Connection } from '../../entities/room';
import { Avatar } from '../../shared/ui';
import styles from './RoomHeader.module.css';

export type RoomHeaderProps = {
  title: string;
  personas: Persona[];
  active: number;
  connection: Connection;
  openMenu: () => void;
  openArtifacts: () => void;
  manageAgents: () => void;
};

function activeRunsLabel(count: number) {
  return `${count} active ${count===1?'run':'runs'}`;
}

const connectionLabels:Record<Connection,string>={
  connecting:'Connecting…',
  connected:'Connected',
  reconnecting:'Reconnecting…',
  replaying:'Restoring history…',
};

export function RoomHeader({ title, personas, active, connection, openMenu, openArtifacts, manageAgents }: RoomHeaderProps) {
  return <header className={styles['room-header']} ui-spec-block-id="room_header">
    <button className={styles['menu-button']} onClick={openMenu} aria-label="Open menu"><Menu /></button>
    <div className={styles.identity}>
      <h1>{title}</h1>
      <small className={connection==='connected'?styles.connected:styles.reconnecting}><i /> {connectionLabels[connection]}{active>0&&<> · {activeRunsLabel(active)}</>}</small>
    </div>
    <div className={styles.actions}>
      <button className={styles.roster} onClick={manageAgents} aria-label="Manage room agents" title="Manage room agents">
        <Users className={styles['roster-icon']} />
        <span className={styles.avatars}>{personas.slice(0, 5).map(persona => <Avatar size="sm" key={persona.id} label={persona.name} color={persona.color} title={`${persona.name} · ${persona.requested_model ?? 'model not set'}`} />)}{personas.length>5&&<em>+{personas.length-5}</em>}</span>
        <span className={styles['roster-label']}>{personas.length?`${personas.length} ${personas.length===1?'agent':'agents'}`:'Add agents'}</span>
        <span className={styles['roster-count']}>{personas.length}</span>
      </button>
      <button className={styles.artifacts} onClick={openArtifacts} aria-label="Open workspace"><FolderOpen /><span>Workspace</span></button>
    </div>
  </header>;
}
