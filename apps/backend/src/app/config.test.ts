import {afterEach,describe,expect,it,vi} from 'vitest';
import {resolveAppConfig} from './config.js';

describe('resolveAppConfig Connector routing',()=>{
  afterEach(()=>vi.unstubAllEnvs());

  it('requires and returns the Connector endpoint',()=>{
    expect(resolveAppConfig({connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32)}).connectorUrl).toBe('http://connector.test');
  });

  it('fails fast when the default Connector is not fully configured',()=>{
    expect(()=>resolveAppConfig()).toThrow('Core requires');
    expect(()=>resolveAppConfig({connectorUrl:'http://connector.test'})).toThrow('must be configured together');
  });

  it('uses an explicit positive execution timeout with a safe default',()=>{
    expect(resolveAppConfig({connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32)}).runTimeoutMs).toBe(900_000);
    expect(resolveAppConfig({connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32),runTimeoutMs:2_500}).runTimeoutMs).toBe(2_500);
  });

  it('rejects the removed backend selector instead of silently accepting a rollback',()=>{
    vi.stubEnv('AGENVYL_EXECUTION_BACKEND','hermes');
    expect(()=>resolveAppConfig({connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32)})).toThrow('no longer supported');
  });
});
