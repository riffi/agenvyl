import {describe,expect,it} from 'vitest';
import {RunArtifactPolicy} from './RunArtifactPolicy.js';

describe('RunArtifactPolicy',()=>{
  it('keeps project inputs and hides dependencies, build output, caches and secrets',()=>{
    const policy=new RunArtifactPolicy();
    expect(policy.visibility('src/main.ts')).toBe('project');
    expect(policy.visibility('package-lock.json')).toBe('project');
    expect(policy.visibility('pnpm-lock.yaml')).toBe('project');
    expect(policy.visibility('vite.config.ts')).toBe('project');
    expect(policy.visibility('.gitignore')).toBe('project');
    expect(policy.visibility('node_modules/vite/index.js')).toBe('hidden');
    expect(policy.visibility('Node_Modules\\vite\\index.js')).toBe('hidden');
    expect(policy.visibility('apps/site/dist/index.html')).toBe('hidden');
    expect(policy.visibility('tests/playwright-report/index.html')).toBe('hidden');
    expect(policy.visibility('.DS_Store')).toBe('hidden');
    expect(policy.visibility('.env.local')).toBe('hidden');
    expect(policy.visibility('.env.example')).toBe('project');
  });

  it('honours root gitignore negation without overriding hard exclusions',()=>{
    const policy=new RunArtifactPolicy('generated/**\n!generated/keep.ts\nnode_modules/**\n!node_modules/keep.ts');
    expect(policy.visibility('generated/drop.ts')).toBe('hidden');
    expect(policy.visibility('generated/keep.ts')).toBe('project');
    expect(policy.visibility('node_modules/keep.ts')).toBe('hidden');
  });

  it('normalizes Windows paths',()=>{
    const policy=new RunArtifactPolicy('tmp/**');
    expect(policy.visibility('src\\main.ts')).toBe('project');
    expect(policy.visibility('tmp\\cache.bin')).toBe('hidden');
  });
});
