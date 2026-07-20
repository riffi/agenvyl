import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { migrations } from './migrations/manifest.js';
import { seedDatabase } from './seed.js';

export type DatabaseSql = Sql<Record<string, unknown>>;
export type QueryContext = DatabaseSql | TransactionSql<Record<string, unknown>>;

export class Database {
  private constructor(readonly sql: DatabaseSql) {}

  static async connect(url: string) {
    const parsed = new URL(url);
    const schema = parsed.searchParams.get('schema');
    parsed.searchParams.delete('schema');
    if (schema) {
      const bootstrap = postgres(parsed.toString(), { max: 1 });
      await bootstrap`CREATE SCHEMA IF NOT EXISTS ${bootstrap(schema)}`;
      await bootstrap.end();
      parsed.searchParams.set('options', `-csearch_path=${schema}`);
    }
    const sql = postgres(parsed.toString(), { max: 10, transform: { undefined: null } });
    const database = new Database(sql);
    try {
      await database.migrate();
      await seedDatabase(database);
      return database;
    } catch (error) {
      await sql.end();
      throw error;
    }
  }

  transaction<T>(callback: (tx: TransactionSql<Record<string, unknown>>) => Promise<T>) {
    return this.sql.begin(callback);
  }

  close() { return this.sql.end(); }
  async ping() { await this.sql`SELECT 1`; }

  private async migrate() {
    await this.sql`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
    const directory = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
    for (const migration of migrations) {
      if ((await this.sql`SELECT 1 FROM schema_migrations WHERE version=${migration.version}`).length) continue;
      const source = await readFile(join(directory, migration.file), 'utf8');
      await this.transaction(async tx => {
        await tx.unsafe(source);
        await tx`INSERT INTO schema_migrations (version,name) VALUES (${migration.version},${migration.name})`;
      });
    }
  }
}
