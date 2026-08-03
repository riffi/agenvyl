import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {resolveSupervisorConfig} from './config.js';
import {archiveInvalidSettings,inspectSettings,loadSettings,saveSettings} from './preferences.js';

const roots:string[]=[];
afterEach(async()=>Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true}))));

describe('supervisor settings',()=>{
  it('round-trips versioned user-only preferences without secrets',async()=>{
    const root=await temporaryRoot(),config=hostConfig(root);
    const settings={schemaVersion:2 as const,locale:'ru' as const,initializedAt:'2026-07-21T00:00:00.000Z',shortcuts:[]};
    await saveSettings(config,settings);
    await expect(loadSettings(config)).resolves.toEqual(settings);
    expect(await readFile(config.settingsFile,'utf8')).not.toContain('token');
  });

  it('returns a typed error and archives malformed settings',async()=>{
    const root=await temporaryRoot(),config=hostConfig(root);
    await saveSettings(config,{schemaVersion:2,locale:'en',initializedAt:'now',shortcuts:[]});
    await writeFile(config.settingsFile,'{}');
    await expect(loadSettings(config)).rejects.toMatchObject({code:'SETTINGS_INVALID',action:'Run agenvyl repair.'});
    await expect(inspectSettings(config)).resolves.toMatchObject({status:'invalid'});
    const backup=await archiveInvalidSettings(config);
    expect(backup).toContain('.invalid-');
    await expect(readFile(backup!,'utf8')).resolves.toBe('{}');
    await expect(inspectSettings(config)).resolves.toEqual({status:'missing'});
  });

  it('upgrades settings v1 without losing locale or shortcuts',async()=>{
    const root=await temporaryRoot(),config=hostConfig(root);
    await mkdir(dirname(config.settingsFile),{recursive:true});
    await writeFile(config.settingsFile,JSON.stringify({schemaVersion:1,locale:'en',initializedAt:'before-v2',shortcuts:[]}));
    await expect(loadSettings(config)).resolves.toEqual({schemaVersion:2,locale:'en',initializedAt:'before-v2',shortcuts:[],command:undefined});
  });

  it('archives an unsupported schema without trusting partial values',async()=>{
    const root=await temporaryRoot(),config=hostConfig(root);
    await mkdir(dirname(config.settingsFile),{recursive:true});
    await writeFile(config.settingsFile,JSON.stringify({schemaVersion:99,locale:'ru',initializedAt:'old',shortcuts:[]}));
    await expect(inspectSettings(config)).resolves.toMatchObject({status:'invalid'});
    expect(await archiveInvalidSettings(config)).toBeTruthy();
  });
});

async function temporaryRoot(){const root=await mkdtemp(join(tmpdir(),'agenvyl-settings-'));roots.push(root);return root;}
function hostConfig(root:string){
  const platform=process.platform as 'win32'|'darwin'|'linux';
  const env=platform==='win32'?{LOCALAPPDATA:join(root,'local')}:platform==='linux'?{XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data')}:{};
  return resolveSupervisorConfig(env,{platform,home:root,cwd:join(root,'bundle')});
}
