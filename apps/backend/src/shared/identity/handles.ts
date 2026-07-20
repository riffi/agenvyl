export function normalizeHandle(value:string|undefined){return value?.trim().replace(/^@/,'').toLowerCase();}
export function isValidHandle(value:string){return/^[a-z0-9][a-z0-9_-]*$/.test(value);}
