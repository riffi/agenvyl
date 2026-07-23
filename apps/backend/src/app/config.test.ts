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

  it('keeps Plan Mode off unless the runtime flag is explicitly enabled',()=>{
    expect(resolveAppConfig({connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32)}).planModeEnabled).toBe(false);
    vi.stubEnv('AGENVYL_FEATURE_PLAN_MODE','TrUe');
    expect(resolveAppConfig({connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32)}).planModeEnabled).toBe(true);
    vi.stubEnv('AGENVYL_FEATURE_PLAN_MODE','false');
    expect(resolveAppConfig({connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32)}).planModeEnabled).toBe(false);
  });

  it('rejects an invalid Plan Mode feature flag',()=>{
    vi.stubEnv('AGENVYL_FEATURE_PLAN_MODE','yes');
    expect(()=>resolveAppConfig({connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32)})).toThrow('AGENVYL_FEATURE_PLAN_MODE must be true or false');
  });

  it('rejects the removed backend selector instead of silently accepting a rollback',()=>{
    vi.stubEnv('AGENVYL_EXECUTION_BACKEND','hermes');
    expect(()=>resolveAppConfig({connectorUrl:'http://connector.test',connectorToken:'x'.repeat(32)})).toThrow('no longer supported');
  });
});
