-- Todos los correos leídos (no solo match) para búsquedas futuras con otras palabras.

CREATE TABLE IF NOT EXISTS correos_procesados (
    message_id       TEXT PRIMARY KEY,
    thread_id        TEXT NOT NULL,
    from_address     TEXT,
    to_addresses     TEXT,
    cc_addresses     TEXT,
    subject          TEXT,
    email_date       TIMESTAMPTZ,
    body_text        TEXT,
    snippet          TEXT,
    has_attachments  BOOLEAN NOT NULL DEFAULT FALSE,
    gmail_link       TEXT,
    search_query     TEXT,
    search_after     TIMESTAMPTZ,
    search_before    TIMESTAMPTZ,
    review_mode      TEXT,
    analyzed_date    DATE,
    slot_index       SMALLINT,
    processed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_correos_procesados_analyzed
    ON correos_procesados (analyzed_date);
CREATE INDEX IF NOT EXISTS idx_correos_procesados_email_date
    ON correos_procesados (email_date);
CREATE INDEX IF NOT EXISTS idx_correos_procesados_review
    ON correos_procesados (review_mode, analyzed_date);

COMMENT ON TABLE correos_procesados IS
    'Archivo completo de correos leídos por n8n (texto). email_trace conserva solo matches.';
