import {AppError} from '../../shared/errors/AppError.js';
import {isValidHandle,normalizeHandle} from '../../shared/identity/handles.js';
import type {UserProfileRepository} from './userProfile.repository.js';

export class UserProfileService{
  constructor(private readonly profiles:UserProfileRepository){}
  get(){return this.profiles.get();}
  async update(input:{display_name?:string;handle?:string}){
    const displayName=input.display_name?.trim(),handle=normalizeHandle(input.handle);
    if(!displayName)throw new AppError('display_name_required',400,'Display name is required');
    if(!handle||!isValidHandle(handle))throw new AppError('invalid_handle',400,'Invalid user handle');
    if(handle==='all')throw new AppError('reserved_handle',400,'The handle all is reserved');
    try{return await this.profiles.update(displayName,handle);}catch(error){
      if(isUniqueViolation(error))throw new AppError('user_handle_conflict',409,'User handle conflicts with a persona',{handle});
      throw error;
    }
  }
}
function isUniqueViolation(error:unknown){return Boolean(error&&typeof error==='object'&&'code'in error&&(error as{code?:string}).code==='23505');}
