import 'dotenv/config';
import { loadConfigOrExit } from '../config/index.js';
import { createDb } from './knex.js';

const config = loadConfigOrExit();
const db = createDb(config);
try {
  const [batch, files] = await db.migrate.latest();
  console.warn(
    files.length ? `Migration batch ${batch}: ${files.join(', ')}` : 'Already up to date',
  );
} finally {
  await db.destroy();
}
