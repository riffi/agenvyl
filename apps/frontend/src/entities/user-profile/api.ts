import type {LocalUserProfile,UpdateLocalUserProfileRequest} from '@agenvyl/contracts';
import {apiRequest} from '../../shared/api';

export const userProfileKey=['user-profile'] as const;
export const userProfileApi={
  get:(signal?:AbortSignal)=>apiRequest<LocalUserProfile>('/api/v1/user-profile',{signal}),
  update:(input:UpdateLocalUserProfileRequest)=>apiRequest<LocalUserProfile>('/api/v1/user-profile',{method:'PUT',body:input}),
};
