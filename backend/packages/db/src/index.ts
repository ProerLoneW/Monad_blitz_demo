import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export * as schema from './schema.js';
export * as domain from './domain.js';

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * 惰性单例：smoke / 无 DB 环境下 boot 服务时，未触达数据库的接口（/config /healthz）仍可用。
 */
let _client: postgres.Sql | null = null;
let _db: Db | null = null;

export function getDb(databaseUrl: string): Db {
  if (_db) return _db;
  _client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {}, // NOTICE（如 drizzle push 的提示）不打印
  });
  _db = drizzle(_client, { schema });
  return _db;
}

export function currentDb(): Db | null {
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}
