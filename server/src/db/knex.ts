import knexFactory, { type Knex } from 'knex';
import type { Config } from '../config/index.js';

export type Db = Knex;

export function createDb(config: Config, overrides: Partial<Knex.Config> = {}): Db {
  return knexFactory({
    client: 'mysql2',
    connection: {
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME,
      charset: 'utf8mb4',
      timezone: 'Z',
      dateStrings: false,
      // DATE columns would otherwise be shifted by the client timezone; we do not use DATE
      // columns for document dates (those live in the encrypted JSON), but keep this explicit.
      typeCast: (field: { type: string; string: () => string | null }, next: () => unknown) => {
        if (field.type === 'DATE') return field.string();
        if (field.type === 'TINY' && (field as unknown as { length: number }).length === 1) {
          const v = field.string();
          return v === null ? null : v === '1';
        }
        return next();
      },
    },
    pool: {
      min: 0,
      max: config.DB_POOL_MAX,
      afterCreate: (
        conn: { query: (sql: string, cb: (err: Error | null) => void) => void },
        done: (err: Error | null, conn: unknown) => void,
      ) => {
        conn.query("SET time_zone = '+00:00'", (err) => done(err, conn));
      },
    },
    migrations: {
      directory: new URL('./migrations', import.meta.url).pathname,
      loadExtensions: ['.ts'],
    },
    ...overrides,
  });
}
