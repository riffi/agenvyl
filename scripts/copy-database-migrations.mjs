import {copyFile,mkdir,readdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';

const source=resolve(import.meta.dirname,'../apps/backend/src/infrastructure/database/migrations');
const destination=resolve(import.meta.dirname,'../apps/backend/dist/infrastructure/database/migrations');
const migrations=(await readdir(source)).filter(file=>file.endsWith('.sql'));

if(migrations.length===0)throw new Error(`No database migrations found in ${source}`);
await mkdir(destination,{recursive:true});
const staleMigrations=(await readdir(destination)).filter(file=>file.endsWith('.sql'));
await Promise.all(staleMigrations.map(file=>rm(resolve(destination,file),{force:true})));
await Promise.all(migrations.map(file=>copyFile(resolve(source,file),resolve(destination,file))));
