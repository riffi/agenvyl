import { createHash } from 'node:crypto';
export function stableSessionId(roomId:string,attemptId:string){return `gc-${createHash('sha256').update(`${roomId}:${attemptId}`).digest('hex').slice(0,48)}`;}
