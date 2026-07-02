# Control correo

Orquestador histórico Gmail → n8n + panel web.

- Documentación: [estructura_program_control.md](../estructura_program_control.md)
- Requisitos: [programa_control.md](../programa_control.md)

## Arranque rápido

```bash
# 1. Migración BD (una vez)
docker exec -i postgres-telemetria psql -U telemetria_app -d telemetria \
  < infra/postgres/06-control-correo.sql

# 2. Variables en infra/.env (N8N_API_KEY, N8N_WORKFLOW_ID)

# 3. Levantar stack
cd infra && docker compose up -d --build control-correo-api control-correo-web
```

UI: http://161.132.53.51:7201
