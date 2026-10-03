// Creates server/.env from server/.env.example if missing, then fills any EMPTY secret with a
// freshly generated value. Existing non-empty values are never changed, because data already
// encrypted or hashed with them would become unreadable. Values are never printed.
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server');
const envFile = path.join(serverDir, '.env');
const example = path.join(serverDir, '.env.example');

const GENERATORS = {
  ENCRYPTION_MASTER_KEY: () => randomBytes(32).toString('base64'),
  API_KEY_PEPPER: () => randomBytes(32).toString('base64url'),
  HMAC_SECRET: () => randomBytes(32).toString('base64url'),
  COOKIE_SECRET: () => randomBytes(32).toString('base64url'),
};

if (!existsSync(envFile)) {
  copyFileSync(example, envFile);
  console.log('Created server/.env from server/.env.example');
}
let text = readFileSync(envFile, 'utf8');
const filled = [];
for (const [key, generate] of Object.entries(GENERATORS)) {
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const match = re.exec(text);
  if (!match) {
    text += `${text.endsWith('\n') ? '' : '\n'}${key}=${generate()}\n`;
    filled.push(key);
  } else if (match[1].trim() === '') {
    text = text.replace(re, `${key}=${generate()}`);
    filled.push(key);
  }
}
writeFileSync(envFile, text);
chmodSync(envFile, 0o600);
console.log(
  filled.length ? `Generated: ${filled.join(', ')}` : 'All secrets already set; nothing changed.',
);
