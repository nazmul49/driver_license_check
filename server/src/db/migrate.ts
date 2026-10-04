import 'dotenv/config';
import { loadConfigOrExit } from '../config/index.js';
import { applySchema } from './schema.js';

const config = loadConfigOrExit();
const applied = await applySchema(config, (line) => console.warn(line));
console.warn(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date');
