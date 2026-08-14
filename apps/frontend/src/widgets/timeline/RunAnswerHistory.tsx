import { Check, CircleX, LoaderCircle } from 'lucide-react';
import type { HumanAuthorSnapshot, RunIntervention, WorkspaceAttachment } from '@agenvyl/contracts';
import type { Persona } from '../../entities/persona';
import type { Run } from '../../entities/run';
import { Avatar } from '../../shared/ui';
import { MarkdownAnswer } from './MarkdownAnswer';
import styles from './Timeline.module.css';

type Props={
  run:Run;
  chapters?:Run[];
  fallbackAuthor:HumanAuthorSnapshot;
  personas:Persona[];
  onMentionPersona:(handle:string)=>void;
  openWorkspace:(attachment:WorkspaceAttachment)=>void;
  collapsed:boolean;
  hiddenInterventionIds?:ReadonlySet<string>;
  routedInterventionIds?:ReadonlySet<string>;
};

const precedingText=(intervention:RunIntervention)=>intervention.precedingText??intervention.supersededText;

export const answerHistoryText=(run:Run)=>[
  ...run.interventions.flatMap(intervention=>precedingText(intervention)??''),
  run.text,
].join('\n\n');
export const continuationHistoryText=(runs:Run[])=>runs.map(run=>`${run.continuationInstruction??''}\n\n${answerHistoryText(run)}`).join('\n\n');

const statusView=(intervention:RunIntervention,appliedLabel='Applied')=>intervention.status==='pending'
  ? {label:'Sending…',icon:<LoaderCircle aria-hidden="true"/>}
  : intervention.status==='applied'
    ? {label:appliedLabel,icon:<Check aria-hidden="true"/>}
    : {label:'Failed',icon:<CircleX aria-hidden="true"/>};

const timeLabel=(createdAt:string|undefined)=>createdAt?new Date(createdAt).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):undefined;

const InstructionMessage=({intervention,fallbackAuthor,appliedLabel}:{intervention:RunIntervention;fallbackAuthor:HumanAuthorSnapshot;appliedLabel?:string})=>{
  const author=intervention.author??fallbackAuthor,status=statusView(intervention,appliedLabel),time=timeLabel(intervention.createdAt);
  return <section className={`${styles['instruction-message']} ${styles[`instruction-${intervention.status}`]}`} aria-label={`Instruction from ${author.displayName}`}>
    <header>
      <Avatar className={styles['instruction-avatar']} label={author.displayName} color="#4f6ef7" size="sm" aria-hidden="true"/>
      <span><strong>{author.displayName}</strong><small>@{author.handle}{time?` · ${time}`:''}</small></span>
      <span className={styles['instruction-state']} role="status" aria-live="polite"><span>{status.icon}{status.label}</span>{intervention.error&&<small>{intervention.error}</small>}</span>
    </header>
    <p>{intervention.text}</p>
  </section>;
};

const AnswerChapter=({run,fallbackAuthor,personas,onMentionPersona,openWorkspace,hiddenInterventionIds,routedInterventionIds}:{run:Run;fallbackAuthor:HumanAuthorSnapshot;personas:Persona[];onMentionPersona:(handle:string)=>void;openWorkspace:(attachment:WorkspaceAttachment)=>void;hiddenInterventionIds:ReadonlySet<string>;routedInterventionIds:ReadonlySet<string>})=>{
  const anchored=run.interventions.filter(intervention=>precedingText(intervention)!==undefined),legacyUnanchored=run.interventions.filter(intervention=>precedingText(intervention)===undefined);
  const visibleLegacyUnanchored=legacyUnanchored.filter(intervention=>!hiddenInterventionIds.has(intervention.id));
  const currentText=run.text||(run.status==='queued'?'Waiting for an available slot…':run.status==='streaming'?'Analyzing…':'');
  const cursorAfterCurrent=run.status==='streaming'&&!visibleLegacyUnanchored.length;
  return <>
    {anchored.map(intervention=><div className={styles['answer-chapter']} key={intervention.id}>
      {precedingText(intervention)&&<div className={styles.answer}><MarkdownAnswer text={precedingText(intervention)!} run={run} personas={personas} onMentionPersona={onMentionPersona} openWorkspace={openWorkspace}/></div>}
      {!hiddenInterventionIds.has(intervention.id)&&<InstructionMessage intervention={intervention} fallbackAuthor={fallbackAuthor} appliedLabel={routedInterventionIds.has(intervention.id)?'Applied now':undefined}/>}
    </div>)}
    {(currentText||run.status==='streaming')&&<div className={styles.answer}>
      {currentText&&<MarkdownAnswer text={currentText} run={run} personas={personas} onMentionPersona={onMentionPersona} openWorkspace={openWorkspace}/>} 
      {cursorAfterCurrent&&<i className={styles.cursor}/>} 
    </div>}
    {visibleLegacyUnanchored.map(intervention=><InstructionMessage key={intervention.id} intervention={intervention} fallbackAuthor={fallbackAuthor} appliedLabel={routedInterventionIds.has(intervention.id)?'Applied now':undefined}/>)}
    {run.status==='streaming'&&visibleLegacyUnanchored.length>0&&<div className={styles.answer}><i className={styles.cursor}/></div>}
  </>;
};

export const RunAnswerHistory=({run,chapters=[run],fallbackAuthor,personas,onMentionPersona,openWorkspace,collapsed,hiddenInterventionIds=new Set(),routedInterventionIds=new Set()}:Props)=>{
  return <div className={`${styles['answer-history']} ${collapsed?styles['answer-collapsed']:''}`}>
    {chapters.map((chapter,index)=><div className={styles['answer-chapter']} key={chapter.id}>
      {index>0&&chapter.continuationInstruction&&<InstructionMessage intervention={{id:`continuation-${chapter.id}`,text:chapter.continuationInstruction,status:['failed','cancelled'].includes(chapter.status)?'failed':'applied',...(chapter.continuationAuthor?{author:chapter.continuationAuthor}:{}),...(chapter.error?{error:chapter.error}:{})}} fallbackAuthor={fallbackAuthor} appliedLabel="Sent"/>}
      <AnswerChapter run={chapter} fallbackAuthor={fallbackAuthor} personas={personas} onMentionPersona={onMentionPersona} openWorkspace={openWorkspace} hiddenInterventionIds={hiddenInterventionIds} routedInterventionIds={routedInterventionIds}/>
    </div>)}
  </div>;
};
