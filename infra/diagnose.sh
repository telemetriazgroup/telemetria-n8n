#!/usr/bin/env bash
# Diagnóstico n8n telemetría — ejecutar en 161.132.53.51 dentro de infra/
set -uo pipefail

BASE="http://127.0.0.1:7001"
SUB="/automatico"

echo "=== 1. Estado del contenedor ==="
docker compose ps 2>/dev/null || docker ps --filter name=n8n-telemetria

echo ""
echo "=== 2. Últimas líneas del log (buscar 'error initializing DB') ==="
docker compose logs --tail 30 n8n-telemetria 2>/dev/null || docker logs --tail 30 n8n-telemetria

echo ""
echo "=== 3. Variables N8N dentro del contenedor ==="
docker exec n8n-telemetria printenv 2>/dev/null | grep -E '^(N8N_|WEBHOOK_)' | sort || echo "Contenedor no accesible (¿crasheando?)"

echo ""
echo "=== 4. Prueba de rutas (Content-Type) ==="
for path in \
  "${SUB}/" \
  "${SUB}/static/base-path.js" \
  "/static/base-path.js" \
  "/" \
  "${SUB}/healthz"; do
  echo "--- GET ${BASE}${path}"
  curl -sI "${BASE}${path}" 2>/dev/null | grep -E 'HTTP/|Content-Type|Location' || echo "  (sin respuesta — n8n caído)"
done

echo ""
echo "=== 5. Interpretación rápida ==="
cat <<'EOF'
• Si el log muestra "error initializing DB" → comenta DB_* en .env y reinicia.
• Si /automatico/static/... devuelve Content-Type: text/html → n8n NO sirve JS (caído o N8N_PATH mal).
• Si /static/... devuelve application/javascript pero /automatico/static/ no → N8N_PATH no activo.
• Si / devuelve 200 pero /automatico/ no → accede sin subruta o corrige N8N_PATH=/automatico/
• Content-Type correcto para base-path.js: application/javascript o text/javascript
EOF
