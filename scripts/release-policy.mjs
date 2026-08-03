export function assertReleaseSource({ref,sha,tagSha}){
  if(ref!=='refs/heads/main')throw new Error(`Release drafts may only be built from refs/heads/main, received ${ref}.`);
  if(!/^[0-9a-f]{40}$/u.test(sha))throw new Error(`Invalid checkout SHA: ${sha}`);
  if(tagSha&&tagSha!==sha)throw new Error(`Release tag resolves to ${tagSha}, but this workflow is building ${sha}.`);
  return{ref,sha,tagSha:tagSha||null};
}

export function assertDraftRelease({exists,isDraft,isPrerelease,targetSha,expectedPrerelease,sha}){
  if(!exists)return{create:true};
  if(!isDraft)throw new Error('Published release assets are immutable.');
  if(isPrerelease!==expectedPrerelease)throw new Error(`Draft prerelease=${isPrerelease}, expected ${expectedPrerelease}.`);
  if(targetSha!==sha)throw new Error(`Draft targets ${targetSha}, but this workflow is building ${sha}.`);
  return{create:false};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const [command,...args]=process.argv.slice(2);
  try{
    let result;
    if(command==='source')result=assertReleaseSource({ref:args[0],sha:args[1],tagSha:args[2]});
    else if(command==='draft')result=assertDraftRelease(JSON.parse(args[0]??'{}'));
    else throw new Error('Usage: release-policy.mjs <source|draft> ...');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }catch(error){process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;}
}
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
