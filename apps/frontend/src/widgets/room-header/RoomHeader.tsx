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
  const mod10=count%10,mod100=count%100;
  const noun=mod10===1&&mod100!==11?'активный запуск':mod10>=2&&mod10<=4&&(mod100<12||mod100>14)?'активных запуска':'активных запусков';
  return `${count} ${noun}`;
}

const connectionLabels:Record<Connection,string>={
  connecting:'Подключение…',
  connected:'На связи',
  reconnecting:'Переподключение…',
  replaying:'Восстановление истории…',
};

export function RoomHeader({ title, personas, active, connection, openMenu, openArtifacts, manageAgents }: RoomHeaderProps) {
  return <header className={styles['room-header']} ui-spec-block-id="room_header">
    <button className={styles['menu-button']} onClick={openMenu} aria-label="Открыть меню"><Menu /></button>
    <div className={styles.identity}>
      <h1>{title}</h1>
      <small className={connection==='connected'?styles.connected:styles.reconnecting}><i /> {connectionLabels[connection]}{active>0&&<> · {activeRunsLabel(active)}</>}</small>
    </div>
    <div className={styles.actions}>
      <button className={styles.roster} onClick={manageAgents} aria-label="Управлять агентами комнаты" title="Управлять агентами комнаты">
        <Users className={styles['roster-icon']} />
        <span className={styles.avatars}>{personas.slice(0, 5).map(persona => <Avatar size="sm" key={persona.id} label={persona.name} color={persona.color} title={`${persona.name} · ${persona.requested_model ?? 'модель не задана'}`} />)}{personas.length>5&&<em>+{personas.length-5}</em>}</span>
        <span className={styles['roster-label']}>{personas.length?`${personas.length} агентов`:'Добавить агентов'}</span>
        <span className={styles['roster-count']}>{personas.length}</span>
      </button>
      <button className={styles.artifacts} onClick={openArtifacts} aria-label="Открыть артефакты"><FolderOpen /><span>Артефакты</span></button>
    </div>
  </header>;
}
