import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';

const defaultUrl = 'postgres://hermes_group_chat:hermes_group_chat@127.0.0.1:8793/hermes_group_chat';
const managedDatabasePattern = /^agenvyl_test_(\d{13})_[0-9a-f]{8}$/;
const staleAfterMs = 24 * 60 * 60 * 1_000;

export default async function setup(project: TestProject) {
  const baseUrl = new URL(process.env.TEST_DATABASE_URL ?? process.env.AGENVYL_DATABASE_URL ?? defaultUrl);
  baseUrl.searchParams.delete('schema');
  baseUrl.searchParams.delete('options');

  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  const databaseName = `agenvyl_test_${Date.now()}_${randomBytes(4).toString('hex')}`;

  try {
    await removeStaleDatabases(admin, databaseName);
    await admin`CREATE DATABASE ${admin(databaseName)}`;
  } catch (error) {
    await admin.end();
    throw error;
  }

  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${databaseName}`;
  project.provide('agenvylTestDatabaseUrl', testUrl.toString());

  return async () => {
    try {
      await dropManagedDatabase(admin, databaseName);
    } finally {
      await admin.end();
    }
  };
}

async function removeStaleDatabases(admin: postgres.Sql, currentName: string) {
  const cutoff = Date.now() - staleAfterMs;
  const rows = await admin`SELECT datname FROM pg_database WHERE datname LIKE 'agenvyl_test_%'`;
  for (const row of rows) {
    const name = String(row.datname);
    const match = managedDatabasePattern.exec(name);
    if (!match || name === currentName || Number(match[1]) >= cutoff) continue;
    await dropManagedDatabase(admin, name);
  }
}

async function dropManagedDatabase(admin: postgres.Sql, name: string) {
  if (!managedDatabasePattern.test(name)) throw new Error(`Refusing to drop unmanaged database: ${name}`);
  await admin`DROP DATABASE IF EXISTS ${admin(name)} WITH (FORCE)`;
}
