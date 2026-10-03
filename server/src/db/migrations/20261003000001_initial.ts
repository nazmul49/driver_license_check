import type { Knex } from 'knex';

/**
 * Initial schema (SPEC section 11). All tables InnoDB, utf8mb4_unicode_ci, ids CHAR(26) ULIDs
 * (session ids carry a "ses_" prefix so that column is CHAR(30)), timestamps DATETIME(3) UTC.
 */
export async function up(knex: Knex): Promise<void> {
  const dt = (t: Knex.CreateTableBuilder, name: string) => t.specificType(name, 'DATETIME(3)');

  const common = (t: Knex.CreateTableBuilder) => {
    t.engine('InnoDB');
    t.charset('utf8mb4');
    t.collate('utf8mb4_unicode_ci');
  };

  await knex.schema.createTable('integrator', (t) => {
    common(t);
    t.specificType('id', 'CHAR(26)').primary();
    t.string('name', 128).notNullable().unique();
    t.string('display_name', 128).notNullable();
    t.string('logo_url', 512).nullable();
    t.json('theme_json').nullable();
    t.json('return_url_hosts_json').notNullable();
    t.specificType('webhook_secret_enc', 'VARBINARY(512)').nullable();
    t.json('default_requirements_json').nullable();
    t.json('decision_policy_json').nullable();
    t.boolean('allow_image_download').notNullable().defaultTo(false);
    t.boolean('allow_reopen').notNullable().defaultTo(false);
    t.integer('retention_days').notNullable().defaultTo(30);
    dt(t, 'created_at').notNullable();
    dt(t, 'updated_at').notNullable();
    dt(t, 'disabled_at').nullable();
  });

  await knex.schema.createTable('api_key', (t) => {
    common(t);
    t.specificType('id', 'CHAR(26)').primary();
    t.specificType('integrator_id', 'CHAR(26)').notNullable().references('integrator.id');
    t.string('prefix', 16).notNullable().index();
    t.specificType('key_hash', 'CHAR(64)').notNullable();
    t.enum('mode', ['live', 'test']).notNullable();
    dt(t, 'last_used_at').nullable();
    dt(t, 'created_at').notNullable();
    dt(t, 'revoked_at').nullable();
  });

  await knex.schema.createTable('verification_session', (t) => {
    common(t);
    t.specificType('id', 'CHAR(30)').primary();
    t.specificType('integrator_id', 'CHAR(26)').notNullable().references('integrator.id');
    t.string('reference', 128).nullable();
    t.enum('status', [
      'created',
      'in_progress',
      'submitted',
      'processing',
      'completed',
      'failed',
      'expired',
      'cancelled',
    ]).notNullable();
    t.specificType('token_hash', 'CHAR(64)').notNullable().unique();
    t.string('return_url', 2048).nullable();
    t.string('webhook_url', 2048).nullable();
    t.specificType('country_hint', 'CHAR(2)').nullable();
    t.string('locale', 8).nullable();
    t.json('requirements_json').nullable();
    t.string('consent_version', 32).nullable();
    dt(t, 'consent_at').nullable();
    dt(t, 'opened_at').nullable();
    dt(t, 'submitted_at').nullable();
    dt(t, 'completed_at').nullable();
    dt(t, 'expires_at').notNullable();
    t.enum('decision', ['approved', 'review', 'rejected']).nullable();
    t.json('decision_reasons_json').nullable();
    t.string('template', 32).nullable();
    t.specificType('country', 'CHAR(2)').nullable();
    dt(t, 'pii_purged_at').nullable();
    dt(t, 'deleted_at').nullable();
    dt(t, 'created_at').notNullable();
    dt(t, 'updated_at').notNullable();
    t.index(['integrator_id', 'created_at']);
    t.index(['integrator_id', 'reference']);
    t.index(['status', 'expires_at']);
    t.index(['status', 'completed_at']);
  });

  await knex.schema.createTable('session_image', (t) => {
    common(t);
    t.specificType('id', 'CHAR(26)').primary();
    t.specificType('session_id', 'CHAR(30)').notNullable().references('verification_session.id');
    t.enum('side', ['front', 'back']).notNullable();
    t.enum('kind', ['original', 'processed']).notNullable();
    t.string('storage_key', 255).notNullable();
    t.string('mime', 64).notNullable();
    t.integer('width').notNullable();
    t.integer('height').notNullable();
    t.integer('bytes').notNullable();
    t.specificType('sha256', 'CHAR(64)').notNullable();
    t.specificType('phash', 'CHAR(16)').nullable().index();
    t.string('enc_key_id', 32).notNullable();
    dt(t, 'created_at').notNullable();
    dt(t, 'deleted_at').nullable();
    t.unique(['session_id', 'side', 'kind']);
  });

  await knex.schema.createTable('extraction_result', (t) => {
    common(t);
    t.specificType('session_id', 'CHAR(30)').primary().references('verification_session.id');
    t.specificType('fields_enc', 'MEDIUMBLOB').nullable();
    t.specificType('raw_ocr_enc', 'MEDIUMBLOB').nullable();
    t.string('enc_key_id', 32).nullable();
    t.specificType('license_number_hmac', 'CHAR(64)').nullable().index();
    t.specificType('identity_hmac', 'CHAR(64)').nullable();
    t.string('ocr_engine_version', 64).nullable();
    t.string('template_version', 32).nullable();
    t.integer('processing_ms').nullable();
    t.decimal('ocr_mean_confidence', 5, 4).nullable();
    dt(t, 'created_at').notNullable();
  });

  await knex.schema.createTable('check_result', (t) => {
    common(t);
    t.specificType('id', 'CHAR(26)').primary();
    t.specificType('session_id', 'CHAR(30)').notNullable().references('verification_session.id');
    t.string('code', 64).notNullable();
    t.enum('status', ['pass', 'warn', 'fail', 'skipped']).notNullable();
    t.enum('severity', ['critical', 'major', 'minor']).notNullable();
    t.string('message', 512).notNullable();
    t.json('details_json').nullable();
    dt(t, 'created_at').notNullable();
    t.index(['session_id']);
    t.index(['code', 'status']);
  });

  await knex.schema.createTable('job', (t) => {
    common(t);
    t.bigIncrements('id');
    t.string('type', 64).notNullable();
    t.json('payload_json').notNullable();
    t.enum('status', ['queued', 'running', 'done', 'failed']).notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    dt(t, 'run_after').notNullable();
    t.string('locked_by', 128).nullable();
    dt(t, 'locked_at').nullable();
    t.text('last_error').nullable();
    dt(t, 'created_at').notNullable();
    dt(t, 'updated_at').notNullable();
    t.index(['status', 'run_after']);
  });

  await knex.schema.createTable('webhook_delivery', (t) => {
    common(t);
    t.specificType('id', 'CHAR(26)').primary();
    t.specificType('session_id', 'CHAR(30)').notNullable().index();
    t.specificType('integrator_id', 'CHAR(26)').notNullable();
    t.string('event_id', 32).notNullable().index();
    t.string('event', 64).notNullable();
    t.string('url', 2048).notNullable();
    t.integer('attempt').notNullable();
    t.integer('response_status').nullable();
    t.integer('response_ms').nullable();
    t.string('error', 512).nullable();
    dt(t, 'next_attempt_at').nullable();
    dt(t, 'delivered_at').nullable();
    dt(t, 'created_at').notNullable();
  });

  await knex.schema.createTable('audit_log', (t) => {
    common(t);
    t.bigIncrements('id');
    t.enum('actor_type', ['integrator', 'end_user', 'system', 'admin']).notNullable();
    t.string('actor_id', 64).nullable();
    t.string('action', 64).notNullable();
    t.specificType('session_id', 'CHAR(30)').nullable().index();
    t.specificType('ip_hash', 'CHAR(64)').nullable();
    t.string('user_agent', 512).nullable();
    t.string('request_id', 40).nullable();
    dt(t, 'created_at').notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const table of [
    'audit_log',
    'webhook_delivery',
    'job',
    'check_result',
    'extraction_result',
    'session_image',
    'verification_session',
    'api_key',
    'integrator',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
