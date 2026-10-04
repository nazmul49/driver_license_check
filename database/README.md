# Driver license check database schema and migrations

Schema, migrations and the local development database for `dlc`, set up like the Sharebox `database` project. This is the only place table structure is defined; the server reads and writes tables but never creates or alters them.

MySQL 8.0, InnoDB, `utf8mb4` / `utf8mb4_unicode_ci`, UTC (`dlc.cnf`).

## Layout

- `Dockerfile`: development and test image, `mysql:8.0` with `dlc.cnf` and `scripts/` copied into `/docker-entrypoint-initdb.d`.
- `docker-compose.yml`: the local `mysql` service built from the Dockerfile (host port 3307). The root `docker-compose.yml` includes it.
- `build_db.sh`: rebuilds the image and recreates the container with an empty volume.
- `scripts/`: run in filename order.
  - `0-dlc_init_setup.sql`: creates `dlc_test` and `dlc_e2e`. Docker only, not a release.
  - `1-structure.sql`: full schema, release 1.0.0.
  - `AA-migration-release-X.Y.Z.sql`: one per later release.
- `src/`: the migration runner (`@dlc/database`) for databases that already exist.

## Local database

```sh
database/build_db.sh            # rebuild from scratch, follows the logs (Ctrl+C to stop following)
docker compose up -d mysql      # from the repo root: start the existing container
```

`build_db.sh` deletes the data volume, so everything in `dlc`, `dlc_test` and `dlc_e2e` is lost. On first start the entrypoint runs every script in filename order against `dlc`. Check the result in the `db_version` table.

The credentials in the Dockerfile (`dlc` / `dlc`, root `root`) are local placeholders. Do not use this image in production.

## Applying migrations to an existing database

Docker only runs the scripts when the data volume is empty. Every other database (`dlc_test`, `dlc_e2e`, production, a dev database with data) is updated by the runner, which applies each release that is not in `db_version` yet, in the same filename order:

```sh
npm run migrate                                  # from the repo root, uses server/.env
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=dlc DB_PASSWORD=dlc DB_NAME=dlc npm run migrate -w database
```

The server test harness and the e2e setup run it on their own. The runner holds a MySQL named lock, so parallel test workers or containers apply one at a time. Production uses plain `mysql:8.0` and this command (see `docs/deploy.md`).

## Making a schema change

Make a new migration file that sorts last and put the change there. Never edit a script that has already been applied anywhere.

1. Create `scripts/AA-migration-release-X.Y.Z.sql` with the next release number.
2. Start it with the release row:
   ```sql
   INSERT INTO db_version(release_version, major_release_number, minor_release_number, point_release_number)
   VALUES ('release-1.0.1', 1, 0, 1);
   ```
3. Then the DDL. Name indexes and constraints explicitly (`<table>_<columns>_index`, `_unique`, `_foreign`).
4. If you add or drop a table, update the table list in `server/test/helpers/harness.ts` and `server/scripts/e2e-setup.ts`.
5. Run `database/build_db.sh` to check the full build, then `npm run migrate` and `npm test`.

The runner refuses to start, before touching any database, when:

- a script has no `INSERT INTO db_version`, or the release in the INSERT differs from the filename (the Sharebox repo allows this; here it is an error);
- filename order is not release order. Docker sorts alphabetically, so `1.0.10` sorts before `1.0.9` and would be applied first. Choose release numbers that also sort last, for example by moving to the next minor version after `X.Y.9`.

There is no rollback. MySQL DDL is not transactional, so a script that fails halfway leaves its earlier statements applied and no `db_version` row. Fix the database by hand, then rerun, or roll forward with a new release.

Scripts run through the `mysql` client (Docker) and `mysql2` with multiple statements (runner). Do not use `DELIMITER`, and do not add `USE`: the same file must apply to whichever database is current.

No personal data in scripts. The test integrator and API key come from `npm run seed` in `server/`, because keys are hashed with the server pepper.

## Databases created by the old Knex migration

Before this project existed, the schema was a Knex migration (`20261003000001_initial.ts`). `1-structure.sql` produces the same tables, indexes and constraint names. When the runner finds `knex_migrations` with that migration and no `db_version`, it creates `db_version` with `release-1.0.0` instead of running `1-structure.sql`. The `knex_migrations` and `knex_migrations_lock` tables are left in place and can be dropped by hand.
