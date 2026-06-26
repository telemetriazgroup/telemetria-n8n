-- Postgres INTERNO de n8n (workflows, credenciales, historial de ejecuciones)
-- Solo necesario si en infra/.env tienes DB_TYPE=postgresdb descomentado.
--
--   psql -h 127.0.0.1 -U postgres -f infra/postgres/02-n8n-internal-db.sql
--
-- Cambia CAMBIAR_N8N_PASSWORD antes de ejecutar.
-- Debe coincidir EXACTAMENTE con DB_POSTGRESDB_PASSWORD en infra/.env

SELECT 'CREATE DATABASE n8n_telemetria'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n_telemetria')\gexec

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'n8n_telemetria') THEN
        CREATE USER n8n_telemetria WITH PASSWORD 'CAMBIAR_N8N_PASSWORD';
    ELSE
        ALTER USER n8n_telemetria WITH PASSWORD 'CAMBIAR_N8N_PASSWORD';
    END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE n8n_telemetria TO n8n_telemetria;

\c n8n_telemetria

GRANT ALL ON SCHEMA public TO n8n_telemetria;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO n8n_telemetria;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO n8n_telemetria;

SELECT 'n8n_internal_db_ok' AS status;
