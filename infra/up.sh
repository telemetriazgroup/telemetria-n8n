#!/usr/bin/env bash
# Levantar n8n telemetría en 161.132.53.51:7001
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "Creando .env desde .env.example — revisa valores antes de producción."
  cp .env.example .env
fi

# Permisos del volumen nombrado: Docker lo gestiona; si usas bind mount local:
# mkdir -p ../data/n8n-telemetria && sudo chown -R 1000:1000 ../data/n8n-telemetria

docker compose pull
docker compose up -d

echo ""
echo "n8n telemetría iniciado."
echo "  Directo:  http://161.132.53.51:7001/automatico/"
echo "  Público:  https://ztrack.app/automatico/  (tras configurar Apache en ztrack.app)"
echo ""
docker compose ps
