-- Test database used by the integration test suite.
CREATE DATABASE IF NOT EXISTS dlc_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON dlc_test.* TO 'dlc'@'%';
-- Database used by the Playwright e2e suite.
CREATE DATABASE IF NOT EXISTS dlc_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON dlc_e2e.* TO 'dlc'@'%';
