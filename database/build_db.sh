#!/bin/sh
# Rebuilds the development database from scratch: deletes the container and its data volume,
# rebuilds the image from scripts/, and starts it. The entrypoint then runs every script in
# filename order. All local data in dlc, dlc_test and dlc_e2e is lost.
set -e
cd "$(dirname "$0")"

echo "rebuilding image, starting container, please check the logs with: docker compose logs -f mysql"

docker compose down -v --remove-orphans
docker compose up -d --build mysql
docker compose logs -f mysql
