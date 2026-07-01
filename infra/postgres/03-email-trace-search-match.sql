-- Migración: ventana de búsqueda + posiciones de coincidencia de keywords
-- Ejecutar en BD existente:
--   psql -h postgres-telemetria -U telemetria_app -d telemetria -f infra/postgres/03-email-trace-search-match.sql

ALTER TABLE email_trace
  ADD COLUMN IF NOT EXISTS search_after       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS search_before      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS match_telemetria_pos   INTEGER,
  ADD COLUMN IF NOT EXISTS match_person_pos       INTEGER,
  ADD COLUMN IF NOT EXISTS match_person_keyword   TEXT;
