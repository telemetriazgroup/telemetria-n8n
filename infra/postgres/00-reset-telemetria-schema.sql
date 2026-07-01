-- ============================================================================
--  REINICIO COMPLETO — base de datos telemetria (solo tablas de trazabilidad)
--
--  Borra TODOS los datos y recrea la estructura actual del sistema.
--  NO toca la base n8n ni otras bases.
--
--  Uso con Docker:
--    docker exec -i postgres-telemetria psql -U telemetria_app -d telemetria \
--      < infra/postgres/00-reset-telemetria-schema.sql
--
--  Uso manual:
--    psql -h <host> -U telemetria_app -d telemetria \
--      -f infra/postgres/00-reset-telemetria-schema.sql
--
--  ⚠️  Destructivo: elimina email_trace, email_attachment_ref y email_history_day.
-- ============================================================================

BEGIN;

-- ── 1. Eliminar tablas existentes ───────────────────────────────────────────
DROP TABLE IF EXISTS email_attachment_ref CASCADE;
DROP TABLE IF EXISTS email_history_day CASCADE;
DROP TABLE IF EXISTS email_trace CASCADE;

-- ── 2. Estructura actual (sincronizada con schema.sql) ──────────────────────

CREATE TABLE email_trace (
    id                      BIGSERIAL PRIMARY KEY,
    message_id              TEXT NOT NULL UNIQUE,
    thread_id               TEXT NOT NULL,
    from_address            TEXT,
    to_addresses            TEXT,
    cc_addresses            TEXT,
    subject                 TEXT,
    email_date              TIMESTAMPTZ,
    body_text               TEXT,
    snippet                 TEXT,
    has_attachments         BOOLEAN NOT NULL DEFAULT FALSE,
    gmail_link              TEXT,
    search_query            TEXT,
    search_after            TIMESTAMPTZ,
    search_before           TIMESTAMPTZ,
    review_mode             TEXT,
    match_telemetria_pos    INTEGER,
    match_person_pos        INTEGER,
    match_person_keyword    TEXT,
    match_telemetria_keyword TEXT,
    match_telemetria_excerpt TEXT,
    match_person_excerpt    TEXT,
    match_in_field          TEXT,
    trace_status            TEXT NOT NULL DEFAULT 'active',
    reviewed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_email_trace_status
        CHECK (trace_status IN ('active', 'superseded'))
);

CREATE INDEX idx_email_trace_status ON email_trace (trace_status);
CREATE INDEX idx_email_trace_thread  ON email_trace (thread_id);
CREATE INDEX idx_email_trace_date    ON email_trace (email_date);
CREATE INDEX idx_email_trace_review  ON email_trace (review_mode, trace_status);

COMMENT ON TABLE email_trace IS
    'Trazabilidad de correos Gmail (solo texto). trace_status: active=vigente, superseded=reiniciado.';
COMMENT ON COLUMN email_trace.match_telemetria_excerpt IS
    'Fragmento de texto alrededor del match de telemetría/ztrack/api/software/plataforma (palabra suelta, no email).';
COMMENT ON COLUMN email_trace.match_person_excerpt IS
    'Fragmento de texto alrededor del match de Luis o Eusebio (palabra suelta, no email).';

CREATE TABLE email_attachment_ref (
    id              BIGSERIAL PRIMARY KEY,
    message_id      TEXT NOT NULL,
    thread_id       TEXT,
    filename        TEXT NOT NULL DEFAULT '',
    mime_type       TEXT,
    size_bytes      BIGINT DEFAULT 0,
    attachment_id   TEXT NOT NULL DEFAULT '',
    gmail_link      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_attachment_ref UNIQUE (message_id, attachment_id, filename)
);

CREATE INDEX idx_attach_message  ON email_attachment_ref (message_id);
CREATE INDEX idx_attach_filename ON email_attachment_ref (filename);

COMMENT ON TABLE email_attachment_ref IS
    'Referencias de adjuntos PDF (metadatos). Sin binarios.';

CREATE TABLE email_history_day (
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

CREATE INDEX idx_history_day_range ON email_history_day (range_start, range_end);
CREATE INDEX idx_history_day_analyzed_at ON email_history_day (analyzed_at DESC);

COMMENT ON TABLE email_history_day IS
    'Resumen por día calendario analizado (modo historical).';

COMMIT;

-- ── 3. Verificación ─────────────────────────────────────────────────────────
SELECT 'reset_ok' AS status, now() AS reset_at;

SELECT table_name,
       (SELECT COUNT(*) FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = t.table_name) AS columnas
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('email_trace', 'email_attachment_ref', 'email_history_day')
ORDER BY table_name;

SELECT COUNT(*) AS filas_email_trace FROM email_trace;
SELECT COUNT(*) AS filas_history_day FROM email_history_day;
