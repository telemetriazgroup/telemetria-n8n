# Infraestructura — stack telemetría

## Servicios (161.132.53.51)

| Puerto | Servicio | URL |
|--------|----------|-----|
| 7001 | n8n | `https://ztrack.app/automatico/` (proxy) |
| 7901 | Adminer | `http://161.132.53.51:7901` (solo admin) |
| — | Postgres | red Docker `postgres-telemetria:5432` |

## Arranque

```bash
cd infra
cp .env.example .env    # editar TELEMETRIA_DB_PASSWORD
docker compose up -d
docker compose ps
```

## Adminer

http://161.132.53.51:7901 → PostgreSQL → servidor `postgres-telemetria` →
usuario `telemetria_app` → base `telemetria`.

## n8n → Postgres

Credencial en n8n: host **`postgres-telemetria`**, puerto **5432**.

Implicancias: [fase_0_implicancias_postgres_docker.md](../fase_0_implicancias_postgres_docker.md)
