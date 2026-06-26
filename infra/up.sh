#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "Creando .env desde .env.example"
  cp .env.example .env
fi

docker compose pull
docker compose up -d

echo ""
echo "n8n telemetría (raíz /)"
echo "  Backend:  http://161.132.53.51:7001/"
echo "  Público:  https://ztrack.app/automatico/  (proxy strip-prefix en ztrack.app)"
echo ""
docker compose ps
