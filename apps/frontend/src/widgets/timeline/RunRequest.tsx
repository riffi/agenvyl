import { useState } from 'react';
import { ChevronLeft, ChevronRight, CircleHelp, TriangleAlert } from 'lucide-react';
import type { Run, RunRequestResolution, StructuredQuestion } from '@agenvyl/contracts';
import { Button, Input } from '../../shared/ui';
import styles from './Timeline.module.css';

type RequestSnapshot = NonNullable<Run['request']>;

export const RunRequest = ({ request, resolve }: { request:RequestSnapshot; resolve:(value:RunRequestResolution|string)=>void }) => {
  const [reply,setReply]=useState('');
  const [activeIndex,setActiveIndex]=useState(0);
  const [answers,setAnswers]=useState<Record<string,string[]>>({});
  const [otherAnswers,setOtherAnswers]=useState<Record<string,string>>({});
  const questions=request.questions??[];
  const activeQuestion=questions[activeIndex];

  if(request.resolved)return <RequestFrame request={request}><small>Response: {request.resolved}</small></RequestFrame>;
  if(request.kind==='approval'){
    const choices=request.choices?.length?request.choices:['approved','denied'];
    return <RequestFrame request={request}><div>{choices.map((choice,index)=><Button key={choice} variant={index===0?'primary':undefined} size="sm" onClick={()=>resolve(choice)}>{approvalLabel(choice)}</Button>)}</div></RequestFrame>;
  }
  if(activeQuestion)return <RequestFrame request={request}><form className={styles['request-questions']} onSubmit={event=>{event.preventDefault();const payload=questionAnswers(questions,answers,otherAnswers);if(Object.values(payload).every(values=>values.length>0))resolve({answers:payload});}}>
    <div className={styles['request-progress']} aria-label={`Question ${activeIndex+1} of ${questions.length}`}>
      <span>Question {activeIndex+1} of {questions.length}</span>
      <div aria-hidden="true">{questions.map((question,index)=><i key={question.id} className={index===activeIndex?styles.active:index<activeIndex?styles.complete:''}/>)}</div>
    </div>
    <QuestionStep question={activeQuestion} answers={answers} otherAnswers={otherAnswers} setAnswers={setAnswers} setOtherAnswers={setOtherAnswers}/>
    <div className={styles['request-navigation']}>
      <Button type="button" size="sm" icon={<ChevronLeft/>} disabled={activeIndex===0} onClick={()=>setActiveIndex(index=>Math.max(0,index-1))}>Back</Button>
      {activeIndex<questions.length-1
        ? <Button type="button" variant="primary" size="sm" disabled={!hasAnswer(activeQuestion,answers,otherAnswers)} onClick={()=>setActiveIndex(index=>Math.min(questions.length-1,index+1))}>Next<ChevronRight/></Button>
        : <Button variant="primary" size="sm" disabled={!hasAnswer(activeQuestion,answers,otherAnswers)}>Respond</Button>}
    </div>
  </form></RequestFrame>;

  return <RequestFrame request={request}>{request.choices?.length?<div className={styles['request-choices']}>{request.choices.map(choice=><Button key={choice} type="button" size="sm" onClick={()=>setReply(choice)}>{choice}</Button>)}</div>:null}<form onSubmit={event=>{event.preventDefault();if(reply.trim())resolve(reply.trim());}}><Input value={reply} onChange={event=>setReply(event.target.value)} placeholder="Your response…"/><Button variant="primary" size="sm">Respond</Button></form></RequestFrame>;
};

const RequestFrame = ({request,children}:{request:RequestSnapshot;children:React.ReactNode}) => <div className={`${styles.request} ${styles[request.kind]??''}`}>
  <strong>{request.kind==='approval'?<><TriangleAlert/> Action approval</>:<><CircleHelp/> Agent clarification</>}</strong>
  <p>{request.prompt}</p>
  {request.directory&&<p><code>{request.directory}</code></p>}
  {children}
</div>;

const QuestionStep = ({question,answers,otherAnswers,setAnswers,setOtherAnswers}:{question:StructuredQuestion;answers:Record<string,string[]>;otherAnswers:Record<string,string>;setAnswers:React.Dispatch<React.SetStateAction<Record<string,string[]>>>;setOtherAnswers:React.Dispatch<React.SetStateAction<Record<string,string>>>}) => <fieldset className={styles['request-question']}>
  <legend>{question.header}</legend>
  <p>{question.question}</p>
  <div className={styles['request-options']}>
    {question.options?.map(option=>{const checked=answers[question.id]?.includes(option.label)??false;return <label key={option.label}><input type={question.multiSelect?'checkbox':'radio'} name={question.id} checked={checked} onChange={()=>{setAnswers(current=>({...current,[question.id]:question.multiSelect?(checked?(current[question.id]??[]).filter(value=>value!==option.label):[...(current[question.id]??[]),option.label]):[option.label]}));if(!question.multiSelect)setOtherAnswers(current=>({...current,[question.id]:''}));}}/><span>{option.label}{option.description&&<small>{option.description}</small>}</span></label>;})}
  </div>
  {(!question.options?.length||question.isOther)&&<Input type={question.isSecret?'password':'text'} autoComplete={question.isSecret?'off':undefined} value={otherAnswers[question.id]??''} onChange={event=>{const value=event.target.value;setOtherAnswers(current=>({...current,[question.id]:value}));if(!question.multiSelect&&value)setAnswers(current=>({...current,[question.id]:[]}));}} placeholder={question.isOther?'Other…':'Your response…'}/>} 
</fieldset>;

const hasAnswer = (question:StructuredQuestion,answers:Record<string,string[]>,otherAnswers:Record<string,string>) => Boolean(answers[question.id]?.length||otherAnswers[question.id]?.trim());
const questionAnswers = (questions:StructuredQuestion[],answers:Record<string,string[]>,otherAnswers:Record<string,string>) => Object.fromEntries(questions.map(question=>{const other=otherAnswers[question.id]?.trim();return[question.id,[...(answers[question.id]??[]),...(other?[other]:[])]];}));
const approvalLabel=(choice:string)=>choice==='allow_directory'?'Add directory and allow':choice==='once'||choice==='approved'?'Allow once':choice==='always'||choice==='session'?'Allow for session':choice==='deny'||choice==='denied'?'Deny':choice;
