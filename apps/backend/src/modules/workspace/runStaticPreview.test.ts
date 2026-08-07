import {describe,expect,it} from 'vitest';
import {hasUnbuiltWebProject,selectStaticPreviewPath} from './runStaticPreview.js';

describe('static run preview discovery',()=>{
  it('selects the nearest output with a deterministic directory priority',()=>{
    expect(selectStaticPreviewPath([
      'apps/site/build/index.html',
      'deep/example/dist/index.html',
      'dist/index.html',
      'out/index.html',
    ])).toBe('dist/index.html');
    expect(selectStaticPreviewPath(['z/dist/index.html','a/dist/index.html'])).toBe('a/dist/index.html');
  });

  it('uses a root html file only when the snapshot has no bundler marker',()=>{
    expect(selectStaticPreviewPath(['index.html','styles.css'])).toBe('index.html');
    expect(selectStaticPreviewPath(['package.json','index.html','src/main.tsx'])).toBeUndefined();
    expect(hasUnbuiltWebProject(['package.json','index.html','src/main.tsx'])).toBe(true);
  });

  it('normalizes Windows paths',()=>{
    expect(selectStaticPreviewPath(['app\\dist\\index.html'])).toBe('app/dist/index.html');
  });
});
