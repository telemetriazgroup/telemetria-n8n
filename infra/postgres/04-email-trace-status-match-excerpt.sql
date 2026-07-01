-- Migración: estado de trazas + contexto de coincidencias en texto largo
-- Ejecutar en BD existente:
--   psql -h postgres-telemetria -U telemetria_app -d telemetria -f infra/postgres/04-email-trace-status-match-excerpt.sql

ALTER TABLE email_trace
  ADD COLUMN IF NOT EXISTS trace_status            TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS match_telemetria_keyword TEXT,
  ADD COLUMN IF NOT EXISTS match_telemetria_excerpt TEXT,
  ADD COLUMN IF NOT EXISTS match_person_excerpt     TEXT,
  ADD COLUMN IF NOT EXISTS match_in_field           TEXT;

UPDATE email_trace SET trace_status = 'active' WHERE trace_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_email_trace_status ON email_trace (trace_status);
