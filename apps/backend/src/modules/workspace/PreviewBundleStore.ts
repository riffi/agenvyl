import {createHash} from 'node:crypto';
import {mkdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime';
import {unzipSync,zipSync,type Zippable} from 'fflate';

export type PreviewBundleFile={path:string;data:Buffer;mimeType:string};
export type PreviewBundleMetadata={
  version:1;
  previewId:string;
  entrypoint:string;
  bundleSha256:string;
  bundleSize:number;
  uncompressedSize:number;
  files:Array<{path:string;size:number;mimeType:string;sha256:string}>;
};

export class PreviewBundleStore{
  constructor(private readonly root:string,private readonly maxBytes:number){}

  async write(previewId:string,entrypoint:string,files:PreviewBundleFile[]){
    const normalizedEntrypoint=safeBundlePath(entrypoint);
    if(!files.some(file=>file.path===normalizedEntrypoint))throw new Error('Preview entrypoint is missing from the bundle');
    const uncompressedSize=files.reduce((total,file)=>total+file.data.length,0);
    if(uncompressedSize>this.maxBytes)throw new Error(`Preview bundle exceeds the ${this.maxBytes} byte limit`);
    const listed=files.map(file=>({path:safeBundlePath(file.path),size:file.data.length,mimeType:file.mimeType,sha256:digest(file.data)})).sort((left,right)=>left.path.localeCompare(right.path));
    if(new Set(listed.map(file=>file.path)).size!==listed.length)throw new Error('Preview bundle contains duplicate paths');
    const internalManifest=Buffer.from(`${JSON.stringify({version:1,entrypoint:normalizedEntrypoint,files:listed},null,2)}\n`);
    const archive:Zippable={};
    for(const file of [...files].sort((left,right)=>left.path.localeCompare(right.path)))archive[safeBundlePath(file.path)]=[file.data,{mtime:zipEpoch}];
    archive['__agenvyl__/manifest.json']=[internalManifest,{mtime:zipEpoch}];
    const bundle=Buffer.from(zipSync(archive,{level:6}));
    if(bundle.length>this.maxBytes)throw new Error(`Compressed preview bundle exceeds the ${this.maxBytes} byte limit`);
    const metadata:PreviewBundleMetadata={version:1,previewId,entrypoint:normalizedEntrypoint,bundleSha256:digest(bundle),bundleSize:bundle.length,uncompressedSize,files:listed};
    await this.publish(previewId,bundle,metadata);
    return metadata;
  }

  async read(previewId:string,filePath:string){
    const relative=safeBundlePath(filePath),bundle=await readFile(path.join(this.directory(previewId),'bundle.zip'));
    const extracted=unzipSync(bundle,{filter:file=>file.name===relative})[relative];
    if(!extracted)throw new Error('Preview bundle file not found');
    const data=Buffer.from(extracted);
    return{data,sha256:digest(data),contentType:mime.getType(relative)??'application/octet-stream'};
  }

  async remove(previewIds:string[]){for(const previewId of previewIds)await rm(this.directory(previewId),{recursive:true,force:true})}

  private async publish(previewId:string,bundle:Buffer,metadata:PreviewBundleMetadata){
    const target=this.directory(previewId),temporary=`${target}.tmp-${crypto.randomUUID()}`;
    await mkdir(path.dirname(target),{recursive:true});
    if(await stat(target).then(()=>true).catch(()=>false)){
      const existing=await this.metadata(previewId).catch(()=>undefined);
      if(existing?.bundleSha256===metadata.bundleSha256)return;
      throw new Error('An immutable preview bundle already exists with different contents');
    }
    try{
      await mkdir(temporary,{recursive:false});
      await writeFile(path.join(temporary,'bundle.zip'),bundle,{flag:'wx'});
      await writeFile(path.join(temporary,'metadata.json'),`${JSON.stringify(metadata,null,2)}\n`,{flag:'wx'});
      await rename(temporary,target);
    }catch(error){await rm(temporary,{recursive:true,force:true});throw error}
  }

  private async metadata(previewId:string){return JSON.parse(await readFile(path.join(this.directory(previewId),'metadata.json'),'utf8')) as PreviewBundleMetadata}
  private directory(previewId:string){
    if(!/^[a-zA-Z0-9_-]+$/.test(previewId))throw new Error('Invalid preview id');
    return path.join(path.resolve(this.root),previewId);
  }
}

const zipEpoch=new Date('1980-01-01T00:00:00.000Z');
const digest=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const safeBundlePath=(value:string)=>{
  const normalized=value.replaceAll('\\','/').normalize('NFC');
  if(!normalized||normalized.startsWith('/')||normalized.includes('\0')||normalized.split('/').some(part=>!part||part==='.'||part==='..')||path.posix.normalize(normalized)!==normalized)throw new Error('Invalid preview bundle path');
  return normalized;
};
