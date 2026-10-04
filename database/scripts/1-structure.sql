-- Release 1.0.0: initial schema (SPEC section 11). Applied to whichever database is current, so
-- there is no USE statement: the Docker image runs it against dlc, the runner against any database.
-- All tables InnoDB, utf8mb4_unicode_ci. Ids are CHAR(26) ULIDs; session ids carry a "ses_"
-- prefix so that column is CHAR(30). Timestamps are DATETIME(3) in UTC.
-- Index and constraint names match the earlier Knex migration, so databases created by it
-- are adopted as this release (see README.md).

CREATE TABLE `db_version` (
  `id` int NOT NULL AUTO_INCREMENT,
  `release_version` varchar(191) NOT NULL,
  `major_release_number` int NOT NULL,
  `minor_release_number` int NOT NULL,
  `point_release_number` int NOT NULL,
  `registered` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `db_version_release_version_unique` (`release_version`),
  UNIQUE KEY `db_version_release_number_unique` (`major_release_number`,`minor_release_number`,`point_release_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO db_version(release_version, major_release_number, minor_release_number, point_release_number)
VALUES ('release-1.0.0', 1, 0, 0);

CREATE TABLE `integrator` (
  `id` char(26) NOT NULL,
  `name` varchar(128) NOT NULL,
  `display_name` varchar(128) NOT NULL,
  `logo_url` varchar(512) DEFAULT NULL,
  `theme_json` json DEFAULT NULL,
  `return_url_hosts_json` json NOT NULL,
  `webhook_secret_enc` varbinary(512) DEFAULT NULL,
  `default_requirements_json` json DEFAULT NULL,
  `decision_policy_json` json DEFAULT NULL,
  `allow_image_download` tinyint(1) NOT NULL DEFAULT '0',
  `allow_reopen` tinyint(1) NOT NULL DEFAULT '0',
  `retention_days` int NOT NULL DEFAULT '30',
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `disabled_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `integrator_name_unique` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `api_key` (
  `id` char(26) NOT NULL,
  `integrator_id` char(26) NOT NULL,
  `prefix` varchar(16) NOT NULL,
  `key_hash` char(64) NOT NULL,
  `mode` enum('live','test') NOT NULL,
  `last_used_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `api_key_integrator_id_foreign` (`integrator_id`),
  KEY `api_key_prefix_index` (`prefix`),
  CONSTRAINT `api_key_integrator_id_foreign` FOREIGN KEY (`integrator_id`) REFERENCES `integrator` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `verification_session` (
  `id` char(30) NOT NULL,
  `integrator_id` char(26) NOT NULL,
  `reference` varchar(128) DEFAULT NULL,
  `status` enum('created','in_progress','submitted','processing','completed','failed','expired','cancelled') NOT NULL,
  `token_hash` char(64) NOT NULL,
  `return_url` varchar(2048) DEFAULT NULL,
  `webhook_url` varchar(2048) DEFAULT NULL,
  `country_hint` char(2) DEFAULT NULL,
  `locale` varchar(8) DEFAULT NULL,
  `requirements_json` json DEFAULT NULL,
  `consent_version` varchar(32) DEFAULT NULL,
  `consent_at` datetime(3) DEFAULT NULL,
  `opened_at` datetime(3) DEFAULT NULL,
  `submitted_at` datetime(3) DEFAULT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  `expires_at` datetime(3) NOT NULL,
  `decision` enum('approved','review','rejected') DEFAULT NULL,
  `decision_reasons_json` json DEFAULT NULL,
  `template` varchar(32) DEFAULT NULL,
  `country` char(2) DEFAULT NULL,
  `pii_purged_at` datetime(3) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `verification_session_token_hash_unique` (`token_hash`),
  KEY `verification_session_integrator_id_created_at_index` (`integrator_id`,`created_at`),
  KEY `verification_session_integrator_id_reference_index` (`integrator_id`,`reference`),
  KEY `verification_session_status_expires_at_index` (`status`,`expires_at`),
  KEY `verification_session_status_completed_at_index` (`status`,`completed_at`),
  CONSTRAINT `verification_session_integrator_id_foreign` FOREIGN KEY (`integrator_id`) REFERENCES `integrator` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `session_image` (
  `id` char(26) NOT NULL,
  `session_id` char(30) NOT NULL,
  `side` enum('front','back') NOT NULL,
  `kind` enum('original','processed') NOT NULL,
  `storage_key` varchar(255) NOT NULL,
  `mime` varchar(64) NOT NULL,
  `width` int NOT NULL,
  `height` int NOT NULL,
  `bytes` int NOT NULL,
  `sha256` char(64) NOT NULL,
  `phash` char(16) DEFAULT NULL,
  `enc_key_id` varchar(32) NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `session_image_session_id_side_kind_unique` (`session_id`,`side`,`kind`),
  KEY `session_image_phash_index` (`phash`),
  CONSTRAINT `session_image_session_id_foreign` FOREIGN KEY (`session_id`) REFERENCES `verification_session` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `extraction_result` (
  `session_id` char(30) NOT NULL,
  `fields_enc` mediumblob,
  `raw_ocr_enc` mediumblob,
  `enc_key_id` varchar(32) DEFAULT NULL,
  `license_number_hmac` char(64) DEFAULT NULL,
  `identity_hmac` char(64) DEFAULT NULL,
  `ocr_engine_version` varchar(64) DEFAULT NULL,
  `template_version` varchar(32) DEFAULT NULL,
  `processing_ms` int DEFAULT NULL,
  `ocr_mean_confidence` decimal(5,4) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`session_id`),
  KEY `extraction_result_license_number_hmac_index` (`license_number_hmac`),
  CONSTRAINT `extraction_result_session_id_foreign` FOREIGN KEY (`session_id`) REFERENCES `verification_session` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `check_result` (
  `id` char(26) NOT NULL,
  `session_id` char(30) NOT NULL,
  `code` varchar(64) NOT NULL,
  `status` enum('pass','warn','fail','skipped') NOT NULL,
  `severity` enum('critical','major','minor') NOT NULL,
  `message` varchar(512) NOT NULL,
  `details_json` json DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `check_result_session_id_index` (`session_id`),
  KEY `check_result_code_status_index` (`code`,`status`),
  CONSTRAINT `check_result_session_id_foreign` FOREIGN KEY (`session_id`) REFERENCES `verification_session` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `job` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `type` varchar(64) NOT NULL,
  `payload_json` json NOT NULL,
  `status` enum('queued','running','done','failed') NOT NULL,
  `attempts` int NOT NULL DEFAULT '0',
  `run_after` datetime(3) NOT NULL,
  `locked_by` varchar(128) DEFAULT NULL,
  `locked_at` datetime(3) DEFAULT NULL,
  `last_error` text,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `job_status_run_after_index` (`status`,`run_after`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `webhook_delivery` (
  `id` char(26) NOT NULL,
  `session_id` char(30) NOT NULL,
  `integrator_id` char(26) NOT NULL,
  `event_id` varchar(32) NOT NULL,
  `event` varchar(64) NOT NULL,
  `url` varchar(2048) NOT NULL,
  `attempt` int NOT NULL,
  `response_status` int DEFAULT NULL,
  `response_ms` int DEFAULT NULL,
  `error` varchar(512) DEFAULT NULL,
  `next_attempt_at` datetime(3) DEFAULT NULL,
  `delivered_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `webhook_delivery_session_id_index` (`session_id`),
  KEY `webhook_delivery_event_id_index` (`event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `audit_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `actor_type` enum('integrator','end_user','system','admin') NOT NULL,
  `actor_id` varchar(64) DEFAULT NULL,
  `action` varchar(64) NOT NULL,
  `session_id` char(30) DEFAULT NULL,
  `ip_hash` char(64) DEFAULT NULL,
  `user_agent` varchar(512) DEFAULT NULL,
  `request_id` varchar(40) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `audit_log_session_id_index` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
