import type {CSSProperties} from 'react';
import {Cable} from 'lucide-react';
import antigravityMark from './assets/antigravity.svg';
import hermesMark from './assets/hermes.svg';
import opencodeMark from './assets/opencode.svg';
import codexMark from './assets/codex.svg';
import claudeMark from './assets/claude.svg';
import styles from './HarnessIcon.module.css';

const harnesses:Record<string,{label:string;mark:string}>={
  antigravity:{label:'Antigravity',mark:antigravityMark},
  hermes:{label:'Hermes',mark:hermesMark},
  opencode:{label:'OpenCode',mark:opencodeMark},
  codex:{label:'Codex',mark:codexMark},
  claude:{label:'Claude',mark:claudeMark},
};

export type HarnessIconProps={
  type:string;
  size?:'sm'|'md';
  className?:string;
};

export const HarnessIcon=({type,size='sm',className}:HarnessIconProps)=>{
  const normalized=type.trim().toLowerCase();
  const harness=harnesses[normalized];
  const label=harness?.label??(type.trim()||'Unknown harness');
  const classes=[styles.icon,size==='md'?styles.md:'',className].filter(Boolean).join(' ');
  const markStyle=harness?{'--harness-mark':`url("${harness.mark}")`} as CSSProperties:undefined;

  return <span className={classes} role="img" aria-label={label} title={label} data-harness-type={normalized||'unknown'} data-harness-size={size}>
    {harness?<span className={styles.mark} style={markStyle} aria-hidden="true"/>:<Cable className={styles.fallback} aria-hidden="true"/>}
  </span>;
};
