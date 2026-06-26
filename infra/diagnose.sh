#!/usr/bin/env bash
# Diagnóstico — ejecutar en 161.132.53.51 dentro de infra/
set -uo pipefail

BASE="http://127.0.0.1:7001"

echo "=== 1. Contenedor ==="
docker compose ps 2>/dev/null || docker ps --filter name=n8n-telemetria

echo ""
echo "=== 2. Log reciente ==="
docker compose logs --tail 15 n8n-telemetria 2>/dev/null

echo ""
echo "=== 3. Backend en raíz / (161.132.53.51:7001) ==="
for path in "/" "/static/base-path.js" "/healthz"; do
  echo "--- GET ${BASE}${path}"
  curl -sI "${BASE}${path}" 2>/dev/null | grep -E 'HTTP/|Content-Type' || echo "  (sin respuesta)"
done

echo ""
echo "=== 4. Interpretación ==="
cat <<'EOF'
✓ Backend OK si / y /static/base-path.js responden 200.

Usar en navegador:  https://ztrack.app/automatico/
NO usar:           http://161.132.53.51:7001/automatico/  (no existe en backend)

En ztrack.app el proxy debe ser strip-prefix:
  ProxyPass /automatico/  →  http://161.132.53.51:7001/
  (sin /automatico/ al final del backend)

Verificar proxy:
  curl -sI https://ztrack.app/automatico/static/base-path.js | grep Content-Type
EOF
