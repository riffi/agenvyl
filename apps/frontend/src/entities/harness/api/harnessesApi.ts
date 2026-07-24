import { apiRequest } from '../../../shared/api';
import type {ConfigureSetupHarnessesRequest,HarnessSettingsState} from '@agenvyl/contracts';
import type { HarnessCatalog } from '../model';

export const harnessKeys = { catalog: ['harnesses'] as const,settings:['harness-settings'] as const };
const refreshUrl=(path:string,refresh:boolean)=>refresh?`${path}?refresh=true`:path;
export const harnessCatalogRefreshInterval=(catalog?:HarnessCatalog)=>catalog?.cache.state==='refreshing'?2_000:false;

export const harnessesApi = {
  catalog: (signal?: AbortSignal,refresh=false) => apiRequest<HarnessCatalog>(refreshUrl('/api/v1/harnesses',refresh), { signal }),
  settings:(signal?:AbortSignal,refresh=false)=>apiRequest<HarnessSettingsState>(refreshUrl('/api/v1/harness-settings',refresh),{signal}),
  configure:(input:ConfigureSetupHarnessesRequest)=>apiRequest('/api/v1/harness-settings',{method:'PUT',body:input}),
};
