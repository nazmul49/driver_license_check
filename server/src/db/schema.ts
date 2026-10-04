import { applyScripts } from '@dlc/database';
import type { Config } from '../config/index.js';

/**
 * Brings the configured database up to date with the release scripts in database/scripts.
 * The schema is owned by the database project; the server only triggers it.
 */
export function applySchema(config: Config, log?: (line: string) => void): Promise<string[]> {
  return applyScripts(
    {
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: config.DB_NAME,
    },
    { log },
  );
}
