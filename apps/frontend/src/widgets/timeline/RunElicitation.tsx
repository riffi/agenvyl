import {useState} from 'react';
import {ExternalLink,ShieldQuestion} from 'lucide-react';
import type {JsonValue,McpElicitation,McpElicitationAnswer} from '@agenvyl/contracts';
import {Button,Input,Select} from '../../shared/ui';
import styles from './Timeline.module.css';

type Field={name:string;type:'string'|'number'|'integer'|'boolean'|'enum'|'multi';title:string;description?:string;required:boolean;options?:Array<{value:string;label:string}>;defaultValue?:JsonValue;minimum?:number;maximum?:number;minLength?:number;maxLength?:number;format?:string};

export const RunElicitation=({elicitation,submitting,onSubmit}:{elicitation:McpElicitation;submitting:boolean;onSubmit:(answer:McpElicitationAnswer)=>void})=>{
  if(elicitation.mode==='url')return <UrlElicitation elicitation={elicitation} submitting={submitting} onSubmit={onSubmit}/>;
  return <FormElicitation elicitation={elicitation} submitting={submitting} onSubmit={onSubmit}/>;
};

const UrlElicitation=({elicitation,submitting,onSubmit}:{elicitation:Extract<McpElicitation,{mode:'url'}>;submitting:boolean;onSubmit:(answer:McpElicitationAnswer)=>void})=><div className={styles['elicitation-flow']}>
  <p className={styles['elicitation-source']}><ShieldQuestion/>Requested by {elicitation.serverName}</p>
  <a className={styles['elicitation-link']} href={elicitation.url} target="_blank" rel="noreferrer">Open secure flow<ExternalLink/></a>
  <small>Complete the external flow, then continue this run.</small>
  <div className={styles['elicitation-actions']}>
    <Button size="sm" variant="primary" disabled={submitting} onClick={()=>onSubmit({action:'accept',content:null})}>Continue</Button>
    <Button size="sm" disabled={submitting} onClick={()=>onSubmit({action:'decline',content:null})}>Decline</Button>
    <Button size="sm" disabled={submitting} onClick={()=>onSubmit({action:'cancel',content:null})}>Cancel</Button>
  </div>
</div>;

const FormElicitation=({elicitation,submitting,onSubmit}:{elicitation:Extract<McpElicitation,{mode:'form'|'openai/form'}>;submitting:boolean;onSubmit:(answer:McpElicitationAnswer)=>void})=>{
  const parsed=parseFields(elicitation.requestedSchema),[values,setValues]=useState<Record<string,JsonValue>>(()=>initialValues(parsed.fields));
  const complete=parsed.supported&&parsed.fields.every(field=>!field.required||hasValue(values[field.name],field));
  return <form className={styles['elicitation-form']} onSubmit={event=>{event.preventDefault();if(complete)onSubmit({action:'accept',content:values});}}>
    <p className={styles['elicitation-source']}><ShieldQuestion/>Requested by {elicitation.serverName}</p>
    {parsed.supported?parsed.fields.map(field=><ElicitationField key={field.name} field={field} value={values[field.name]} setValue={value=>setValues(current=>value===undefined?omit(current,field.name):{...current,[field.name]:value})}/>):<p className={styles['elicitation-unsupported']}>This MCP server requested a form shape that Agenvyl cannot safely render. Decline it or cancel the request.</p>}
    <div className={styles['elicitation-actions']}>
      {parsed.supported&&<Button variant="primary" size="sm" disabled={submitting||!complete}>Submit</Button>}
      <Button type="button" size="sm" disabled={submitting} onClick={()=>onSubmit({action:'decline',content:null})}>Decline</Button>
      <Button type="button" size="sm" disabled={submitting} onClick={()=>onSubmit({action:'cancel',content:null})}>Cancel</Button>
    </div>
  </form>;
};

const ElicitationField=({field,value,setValue}:{field:Field;value:JsonValue|undefined;setValue:(value:JsonValue|undefined)=>void})=><label className={styles['elicitation-field']}>
  <span>{field.title}{field.required&&<sup>*</sup>}</span>
  {field.description&&<small>{field.description}</small>}
  {field.type==='boolean'?<Select value={value===undefined?'':String(value)} required={field.required} onChange={event=>setValue(event.target.value===''?undefined:event.target.value==='true')}><option value="">Select…</option><option value="true">Yes</option><option value="false">No</option></Select>
    :field.type==='enum'?<Select value={typeof value==='string'?value:''} required={field.required} onChange={event=>setValue(event.target.value||undefined)}><option value="">Select…</option>{field.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</Select>
    :field.type==='multi'?<span className={styles['elicitation-options']}>{field.options?.map(option=>{const selected=Array.isArray(value)&&value.includes(option.value);return<label key={option.value}><input type="checkbox" checked={selected} onChange={()=>setValue(selected?(value as JsonValue[]).filter(item=>item!==option.value):[...(Array.isArray(value)?value:[]),option.value])}/><span>{option.label}</span></label>})}</span>
    :<Input type={inputType(field)} value={typeof value==='string'||typeof value==='number'?String(value):''} required={field.required} min={field.minimum} max={field.maximum} minLength={field.minLength} maxLength={field.maxLength} onChange={event=>setValue(parseInput(field,event.target.value))}/>}
</label>;

const parseFields=(schema:JsonValue):{supported:boolean;fields:Field[]}=>{
  if(!record(schema)||schema.type!=='object'||!record(schema.properties))return{supported:false,fields:[]};
  const properties=schema.properties,required=new Set(Array.isArray(schema.required)?schema.required.filter((item):item is string=>typeof item==='string'):[]),fields:Field[]=[];
  for(const[name,value]of Object.entries(properties)){
    const field=parseField(name,value,required.has(name));if(!field)return{supported:false,fields:[]};fields.push(field);
  }
  if([...required].some(name=>!(name in properties)))return{supported:false,fields:[]};
  return{supported:true,fields};
};

const parseField=(name:string,value:unknown,required:boolean):Field|undefined=>{
  if(!record(value)||!['string','number','integer','boolean','array'].includes(String(value.type)))return;
  const base={name,title:typeof value.title==='string'?value.title:name,description:typeof value.description==='string'?value.description:undefined,required,defaultValue:isJson(value.default)?value.default:undefined};
  const options=enumOptions(value);if(options)return{...base,type:value.type==='array'?'multi':'enum',options};
  if(value.type==='array')return;
  return{...base,type:value.type,minimum:number(value.minimum),maximum:number(value.maximum),minLength:integer(value.minLength),maxLength:integer(value.maxLength),format:typeof value.format==='string'?value.format:undefined} as Field;
};

const enumOptions=(schema:Record<string,unknown>)=>{
  const values=Array.isArray(schema.enum)?schema.enum:record(schema.items)&&Array.isArray(schema.items.enum)?schema.items.enum:undefined;
  const titled=Array.isArray(schema.oneOf)?schema.oneOf:record(schema.items)&&Array.isArray(schema.items.anyOf)?schema.items.anyOf:undefined;
  if(values?.every(value=>typeof value==='string'))return values.map((value,index)=>({value,label:Array.isArray(schema.enumNames)&&typeof schema.enumNames[index]==='string'?schema.enumNames[index]:value}));
  if(titled?.every(option=>record(option)&&typeof option.const==='string'&&typeof option.title==='string'))return titled.map(option=>({value:String((option as Record<string,unknown>).const),label:String((option as Record<string,unknown>).title)}));
};
const initialValues=(fields:Field[])=>Object.fromEntries(fields.flatMap(field=>field.defaultValue===undefined?[]:[[field.name,field.defaultValue]]));
const hasValue=(value:JsonValue|undefined,field:Field)=>field.type==='multi'?Array.isArray(value)&&value.length>0:value!==undefined&&value!=='';
const inputType=(field:Field)=>field.type==='number'||field.type==='integer'?'number':field.format==='email'?'email':field.format==='uri'?'url':field.format==='date'?'date':'text';
const parseInput=(field:Field,value:string):JsonValue|undefined=>{if(!value)return undefined;if(field.type==='number'||field.type==='integer'){const parsed=Number(value);return Number.isFinite(parsed)?parsed:undefined;}return value;};
const omit=(value:Record<string,JsonValue>,key:string)=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
const integer=(value:unknown)=>Number.isSafeInteger(value)?Number(value):undefined;
const isJson=(value:unknown):value is JsonValue=>{if(value===null||typeof value==='string'||typeof value==='boolean')return true;if(typeof value==='number')return Number.isFinite(value);if(Array.isArray(value))return value.every(isJson);return record(value)&&Object.values(value).every(isJson);};
