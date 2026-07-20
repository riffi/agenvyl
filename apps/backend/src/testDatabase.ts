import postgres from 'postgres';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    agenvylTestDatabaseUrl: string;
  }
}

const managedDatabasePattern = /^agenvyl_test_\d{13}_[0-9a-f]{8}$/;

export function testDatabaseUrl(prefix = 'test') {
  const provided = inject('agenvylTestDatabaseUrl');
  if (!provided) throw new Error('Managed test database is unavailable; run tests through npm test');
  const url = new URL(provided);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!managedDatabasePattern.test(databaseName)) throw new Error('Refusing to create a test schema outside a managed test database');
  url.searchParams.set('schema', `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`);
  return url.toString();
}

export function connectTestDatabase(url: string) {
  const parsed = new URL(url);
  const schema = parsed.searchParams.get('schema');
  parsed.searchParams.delete('schema');
  if (schema) parsed.searchParams.set('options', `-csearch_path=${schema}`);
  return postgres(parsed.toString(), { max: 1 });
}
