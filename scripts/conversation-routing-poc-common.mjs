import {createHash} from 'node:crypto';
import {readdir,readFile,stat} from 'node:fs/promises';
import {dirname,relative,resolve} from 'node:path';

export const repositoryRoot=resolve(import.meta.dirname,'..');
export const pocDatabaseName='agenvyl_routing_poc';
export const pocRoot=resolve(repositoryRoot,'data','poc-conversation-routing');
export const pocWorkspaceRoot=resolve(pocRoot,'room-workspaces');
export const pocArtifactRoot=resolve(pocRoot,'artifacts');

export function sourceDatabaseUrl(){return process.env.AGENVYL_SOURCE_DATABASE_URL?.trim()||process.env.AGENVYL_DATABASE_URL?.trim()||`postgres://agenvyl:${encodeURIComponent(process.env.POSTGRES_PASSWORD?.trim()||'agenvyl')}@127.0.0.1:${process.env.AGENVYL_POSTGRES_PORT?.trim()||'55432'}/agenvyl`;}
export function databaseUrl(name){const url=new URL(sourceDatabaseUrl());url.pathname=`/${name}`;return url.toString();}
export function databaseName(url){return decodeURIComponent(new URL(url).pathname.replace(/^\//,''));}
export function assertSafePocTargets(){
  if(databaseName(databaseUrl(pocDatabaseName))!==pocDatabaseName)throw new Error('Refusing to operate on a database other than agenvyl_routing_poc');
  const expected=resolve(repositoryRoot,'data','poc-conversation-routing');
  if(!pocRoot||pocRoot!==expected||dirname(pocRoot)!==resolve(repositoryRoot,'data'))throw new Error('Refusing to operate on an unexpected or broad POC path');
  if(pocRoot===repositoryRoot||pocRoot===resolve(repositoryRoot,'data'))throw new Error('Refusing to operate on a broad path');
}
export async function snapshotFiles(root){
  if(!await exists(root))return[];
  const files=await walk(root),selected=files.length<=24?files:[...files.slice(0,8),...files.slice(Math.max(0,Math.floor(files.length/2)-4),Math.floor(files.length/2)+4),...files.slice(-8)];
  return Promise.all([...new Set(selected)].map(async file=>({path:relative(root,file),sha256:createHash('sha256').update(await readFile(file)).digest('hex')})));
}
export async function exists(path){try{await stat(path);return true}catch{return false}}
async function walk(root){const result=[];for(const entry of await readdir(root,{withFileTypes:true})){const path=resolve(root,entry.name);if(entry.isDirectory())result.push(...await walk(path));else if(entry.isFile())result.push(path)}return result.sort();}
