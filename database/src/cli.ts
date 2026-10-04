/**
 * Applies pending release scripts. Reads DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME from the
 * environment, for example: `node --env-file=../server/.env` or exported variables.
 */
import { applyScripts } from './apply.js';

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const applied = await applyScripts(
  {
    host: env('DB_HOST', '127.0.0.1'),
    port: Number(env('DB_PORT', '3306')),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME'),
  },
  { log: (line) => console.warn(line) },
);
console.warn(applied.length ? `Applied ${applied.length} script(s)` : 'Already up to date');
