#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "Creando .env desde .env.example — define TELEMETRIA_DB_PASSWORD"
  cp .env.example .env
  echo "Edita .env antes de continuar en producción."
fi

docker compose pull
docker compose up -d

echo ""
echo "Stack telemetría"
echo "  n8n:      https://ztrack.app/automatico/  (proxy) | http://161.132.53.51:7001/"
echo "  Adminer:  http://161.132.53.51:7901  (Postgres UI — restringir firewall)"
echo "  Postgres: postgres-telemetria:5432  (solo red Docker)"
echo ""
docker compose ps
