# Development and test database image: MySQL 8.0 with the dlc schema built in.
# On first start (empty data directory) the entrypoint runs scripts/ in filename order:
# 0-dlc_init_setup.sql, 1-structure.sql, then every AA-migration-release-*.sql.
# The credentials below are local development placeholders. Never use this image in production;
# production uses plain mysql:8.0 and applies releases with `npm run migrate` (see README.md).
FROM mysql:8.0

ENV MYSQL_ROOT_PASSWORD=root
ENV MYSQL_DATABASE=dlc
ENV MYSQL_USER=dlc
ENV MYSQL_PASSWORD=dlc

EXPOSE 3306

COPY dlc.cnf /etc/mysql/conf.d/
COPY scripts /docker-entrypoint-initdb.d
