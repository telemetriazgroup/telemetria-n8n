#!/usr/bin/env bash
set -uo pipefail

echo "=== Contenedores ==="
docker compose ps 2>/dev/null || docker ps --filter name=telemetria

echo ""
echo "=== Postgres ==="
docker exec postgres-telemetria pg_isready -U telemetria_app -d telemetria 2>/dev/null && echo "OK" || echo "FAIL"

echo ""
echo "=== Tablas ==="
docker exec postgres-telemetria psql -U telemetria_app -d telemetria -c '\dt' 2>/dev/null || echo "Sin acceso"

echo ""
echo "=== n8n ==="
curl -sI http://127.0.0.1:7001/healthz 2>/dev/null | grep HTTP || echo "n8n no responde"

echo ""
echo "=== Adminer ==="
curl -sI http://127.0.0.1:7901/ 2>/dev/null | grep HTTP || echo "Adminer no responde"
