import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

/** Directory holding the scripts. The Docker image runs the same files from here. */
export const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts');

export interface DbConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface ApplyOptions {
  /** Defaults to database/scripts. */
  dir?: string;
  /** Progress output; defaults to silent. */
  log?: (line: string) => void;
}

/** A script that records a release in db_version. */
export interface ReleaseScript {
  file: string;
  /** For example "release-1.2.3", as written in the script's db_version INSERT. */
  release: string;
}

const LOCK_NAME = 'dlc_db_apply';
const LOCK_TIMEOUT_S = 120;

const STRUCTURE = '1-structure.sql';
const MIGRATION = /^AA-migration-release-(\d+)\.(\d+)\.(\d+)\.sql$/;
// 0-*: server-level setup (databases, grants) run by the Docker image only.
// Z-*: test data, Docker image only.
const DOCKER_ONLY = /^[0Z]-.+\.sql$/;
const RELEASE_INSERT =
  /INSERT INTO\s+`?db_version`?[^;]*?VALUES\s*\(\s*'release-(\d+)\.(\d+)\.(\d+)'/i;

// The first release used to be a Knex migration. A database created by it has the same tables,
// so it is recorded as release-1.0.0 instead of running 1-structure.sql against it.
const KNEX_INITIAL = '20261003000001_initial.ts';

type Version = [number, number, number];

const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Release scripts in apply order, which is filename order, the same order the Docker entrypoint
 * uses. Fails if a script has no db_version INSERT, if a migration filename and its INSERT
 * disagree, or if filename order is not release order (for example 1.10.0 sorting before 1.9.0).
 */
export async function listReleases(dir = scriptsDir): Promise<ReleaseScript[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const releases: (ReleaseScript & { version: Version })[] = [];
  for (const file of files) {
    if (DOCKER_ONLY.test(file)) continue;
    const named = MIGRATION.exec(file);
    if (file !== STRUCTURE && !named) {
      throw new Error(`Unexpected script name ${file}: use AA-migration-release-X.Y.Z.sql`);
    }
    const inserted = RELEASE_INSERT.exec(await readFile(path.join(dir, file), 'utf8'));
    if (!inserted) throw new Error(`${file} has no INSERT INTO db_version for its release`);
    const version = inserted.slice(1, 4).map(Number) as Version;
    if (named && compare(version, named.slice(1, 4).map(Number) as Version) !== 0) {
      throw new Error(`${file} inserts release-${version.join('.')}, filename says otherwise`);
    }
    const previous = releases.at(-1);
    if (previous && compare(version, previous.version) <= 0) {
      throw new Error(
        `${file} sorts after ${previous.file} but has a lower release; Docker applies scripts in ` +
          'filename order, so pick a version that also sorts last',
      );
    }
    releases.push({ file, release: `release-${version.join('.')}`, version });
  }
  return releases.map(({ file, release }) => ({ file, release }));
}

/**
 * Applies every release script whose release is not in db_version, in filename order. There is
 * no rollback: MySQL DDL is not transactional, so a failed script is fixed by hand and followed
 * by a new release. Returns the scripts applied by this call.
 */
export async function applyScripts(
  connection: DbConnection,
  { dir = scriptsDir, log = () => {} }: ApplyOptions = {},
): Promise<string[]> {
  const releases = await listReleases(dir);
  const conn = await mysql.createConnection({
    ...connection,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: true,
  });
  try {
    await conn.query("SET time_zone = '+00:00'");
    // Several test workers or containers may start at once; only one applies at a time.
    const [lockRows] = await conn.query<mysql.RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS ok', [
      LOCK_NAME,
      LOCK_TIMEOUT_S,
    ]);
    if (lockRows[0]?.ok !== 1) throw new Error(`Could not get lock ${LOCK_NAME}`);
    try {
      const applied = await appliedReleases(conn, dir, log);
      const pending = releases.filter((r) => !applied.has(r.release));
      for (const { file, release } of pending) {
        log(`Applying ${file}`);
        await conn.query(await readFile(path.join(dir, file), 'utf8'));
        const [rows] = await conn.query<mysql.RowDataPacket[]>(
          'SELECT 1 FROM db_version WHERE release_version = ?',
          [release],
        );
        if (!rows.length) throw new Error(`${file} ran but ${release} is not in db_version`);
      }
      return pending.map((r) => r.file);
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
  } finally {
    await conn.end();
  }
}

async function tableExists(conn: mysql.Connection, table: string): Promise<boolean> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [table],
  );
  return rows.length > 0;
}

async function appliedReleases(
  conn: mysql.Connection,
  dir: string,
  log: (line: string) => void,
): Promise<Set<string>> {
  if (await tableExists(conn, 'db_version')) {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT release_version FROM db_version',
    );
    return new Set(rows.map((r) => r.release_version as string));
  }
  if (await tableExists(conn, 'knex_migrations')) {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT 1 FROM knex_migrations WHERE name = ?',
      [KNEX_INITIAL],
    );
    if (rows.length) {
      log(`Adopting Knex-created schema as ${STRUCTURE}`);
      const sql = await readFile(path.join(dir, STRUCTURE), 'utf8');
      // Run only the db_version part (table and release row) of the structure script.
      await conn.query(sql.slice(0, sql.indexOf('CREATE TABLE `integrator`')));
      return new Set(['release-1.0.0']);
    }
  }
  return new Set();
}
