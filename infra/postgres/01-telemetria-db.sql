-- Instalación MANUAL de PostgreSQL (solo si NO usas docker-compose)
-- Con Docker, postgres-telemetria + schema.sql se crean solos al primer up.
--
--   psql -h 127.0.0.1 -U postgres -f infra/postgres/01-telemetria-db.sql
--   psql -h 127.0.0.1 -U telemetria_app -d telemetria -f schema.sql

SELECT 'CREATE DATABASE telemetria'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'telemetria')\gexec

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'telemetria_app') THEN
        CREATE USER telemetria_app WITH PASSWORD 'CAMBIAR_PASSWORD';
    END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE telemetria TO telemetria_app;

\c telemetria

GRANT ALL ON SCHEMA public TO telemetria_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO telemetria_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO telemetria_app;

SELECT 'telemetria_db_ok' AS status;
