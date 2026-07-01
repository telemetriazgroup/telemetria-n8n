-- Migración: registro de análisis histórico día a día
--   psql -U telemetria_app -d telemetria -f infra/postgres/05-email-history-day.sql

CREATE TABLE IF NOT EXISTS email_history_day (
    id                      BIGSERIAL PRIMARY KEY,
    analyzed_date           DATE NOT NULL UNIQUE,
    range_start             DATE NOT NULL,
    range_end               DATE NOT NULL,
    gmail_query             TEXT,
    emails_listed_count     INTEGER NOT NULL DEFAULT 0,
    emails_processed_count  INTEGER NOT NULL DEFAULT 0,
    emails_match_count      INTEGER NOT NULL DEFAULT 0,
    message_ids_listed      JSONB NOT NULL DEFAULT '[]'::jsonb,
    message_ids_processed   JSONB NOT NULL DEFAULT '[]'::jsonb,
    message_ids_match       JSONB NOT NULL DEFAULT '[]'::jsonb,
    status                  TEXT NOT NULL DEFAULT 'completed',
    analyzed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_history_day_status
        CHECK (status IN ('completed', 'partial', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_history_day_range
    ON email_history_day (range_start, range_end);
CREATE INDEX IF NOT EXISTS idx_history_day_analyzed_at
    ON email_history_day (analyzed_at DESC);

COMMENT ON TABLE email_history_day IS
    'Un registro por día calendario analizado en modo historical. Evita reprocesar días ya revisados.';
