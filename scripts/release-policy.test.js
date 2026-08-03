import {describe,expect,it} from 'vitest';
import {assertDraftRelease,assertReleaseSource} from './release-policy.mjs';

const sha='a'.repeat(40);
describe('release source policy',()=>{
  it('accepts main with an absent or matching tag',()=>{
    expect(assertReleaseSource({ref:'refs/heads/main',sha})).toMatchObject({sha,tagSha:null});
    expect(assertReleaseSource({ref:'refs/heads/main',sha,tagSha:sha})).toMatchObject({tagSha:sha});
  });
  it('rejects another ref and a mismatched existing tag',()=>{
    expect(()=>assertReleaseSource({ref:'refs/heads/feature',sha})).toThrow('only be built');
    expect(()=>assertReleaseSource({ref:'refs/heads/main',sha,tagSha:'b'.repeat(40)})).toThrow('Release tag resolves');
  });
});

describe('draft release policy',()=>{
  it('allows creation or an idempotent matching draft',()=>{
    expect(assertDraftRelease({exists:false,sha,expectedPrerelease:true})).toEqual({create:true});
    expect(assertDraftRelease({exists:true,isDraft:true,isPrerelease:true,targetSha:sha,expectedPrerelease:true,sha})).toEqual({create:false});
  });
  it.each([
    [{exists:true,isDraft:false,isPrerelease:true,targetSha:sha,expectedPrerelease:true,sha},'immutable'],
    [{exists:true,isDraft:true,isPrerelease:false,targetSha:sha,expectedPrerelease:true,sha},'prerelease'],
    [{exists:true,isDraft:true,isPrerelease:true,targetSha:'b'.repeat(40),expectedPrerelease:true,sha},'targets'],
  ])('rejects unsafe release state', (input,message)=>expect(()=>assertDraftRelease(input)).toThrow(message));
});
