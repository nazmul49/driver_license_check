#!/usr/bin/env bash
# Creates deploy/.env from deploy/.env.example and fills every empty secret with a random value.
# Existing values are never changed (changing the encryption key or pepper would make stored
# data and API keys unusable). Secrets are not printed.
# Usage: deploy/init-env.sh <domain> <acme-email>
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created deploy/.env"
fi

set_if_empty() {
  local key="$1" value="$2"
  if grep -qE "^${key}=$" .env; then
    # | is not used by base64/base64url/hex output or by hostnames and emails.
    sed -i.bak "s|^${key}=$|${key}=${value}|" .env && rm -f .env.bak
    echo "Set ${key}"
  fi
}

[[ $# -ge 1 ]] && set_if_empty DLC_DOMAIN "$1"
[[ $# -ge 2 ]] && set_if_empty ACME_EMAIL "$2"
set_if_empty MYSQL_ROOT_PASSWORD "$(openssl rand -hex 24)"
set_if_empty MYSQL_PASSWORD "$(openssl rand -hex 24)"
set_if_empty ENCRYPTION_MASTER_KEY "$(openssl rand -base64 32)"
set_if_empty API_KEY_PEPPER "$(openssl rand -hex 32)"
set_if_empty HMAC_SECRET "$(openssl rand -hex 32)"
set_if_empty COOKIE_SECRET "$(openssl rand -hex 32)"
set_if_empty METRICS_TOKEN "$(openssl rand -hex 24)"

for key in DLC_DOMAIN ACME_EMAIL; do
  grep -qE "^${key}=.+" .env || echo "Still empty: ${key} (edit deploy/.env)"
done
