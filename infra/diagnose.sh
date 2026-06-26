#!/usr/bin/env bash
# Diagnóstico n8n telemetría — ejecutar en 161.132.53.51 dentro de infra/
set -uo pipefail

BASE="http://127.0.0.1:7001"
SUB="/automatico"

echo "=== 1. Estado del contenedor ==="
docker compose ps 2>/dev/null || docker ps --filter name=n8n-telemetria

echo ""
echo "=== 2. Últimas líneas del log ==="
docker compose logs --tail 20 n8n-telemetria 2>/dev/null || docker logs --tail 20 n8n-telemetria

echo ""
echo "=== 3. Variables N8N dentro del contenedor ==="
docker exec n8n-telemetria printenv 2>/dev/null | grep -E '^(N8N_|WEBHOOK_)' | sort || echo "Contenedor no accesible"

echo ""
echo "=== 4. Rutas en el BACKEND (161.132.53.51:7001) ==="
for path in \
  "/" \
  "/static/base-path.js" \
  "${SUB}/" \
  "${SUB}/static/base-path.js" \
  "/healthz"; do
  echo "--- GET ${BASE}${path}"
  curl -sI "${BASE}${path}" 2>/dev/null | grep -E 'HTTP/|Content-Type|Location' || echo "  (sin respuesta)"
done

echo ""
echo "=== 5. Interpretación (n8n 2.x + subruta /automatico/) ==="
cat <<'EOF'
ARQUITECTURA CORRECTA (patrón oficial n8n):

  • Backend n8n escucha en RAÍZ:  /  /static/  /healthz  → 200 OK
  • /automatico/ en el backend → 404 (NORMAL con strip-prefix en proxy)
  • N8N_PATH=/automatico/ solo genera URLs públicas con prefijo
  • Apache en ztrack.app QUITA /automatico/ al reenviar:
      https://ztrack.app/automatico/static/x.js
        → http://161.132.53.51:7001/static/x.js

QUÉ ESPERAR EN ESTE DIAGNÓSTICO:
  ✓  /static/base-path.js     → 200, text/javascript
  ✓  /                        → 200, text/html
  ✓  /healthz                 → 200
  ✓  /automatico/             → 404  (correcto en backend directo)
  ✓  /automatico/static/...   → 404  (correcto en backend directo)

NO abras http://161.132.53.51:7001/automatico/ en el navegador.
Usa: https://ztrack.app/automatico/  (con Apache strip-prefix configurado)

Si ztrack.app sigue en blanco tras corregir Apache:
  curl -sI https://ztrack.app/automatico/static/base-path.js | grep Content-Type
  → debe ser text/javascript, no text/html
EOF
