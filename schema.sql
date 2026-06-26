-- ============================================================================
--  Trazabilidad de correos - Instalaciones de telemetría
--  Solo TEXTO. Los adjuntos/imágenes NO se almacenan como dato del sistema:
--  únicamente se guarda su REFERENCIA para poder ubicarlos luego en Gmail.
--  Motor: PostgreSQL
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tabla principal: un registro por correo revisado (solo texto)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_trace (
    id               BIGSERIAL PRIMARY KEY,
    message_id       TEXT NOT NULL UNIQUE,        -- ID de Gmail (clave anti-duplicados)
    thread_id        TEXT NOT NULL,               -- ID del hilo
    from_address     TEXT,
    to_addresses     TEXT,
    cc_addresses     TEXT,
    subject          TEXT,
    email_date       TIMESTAMPTZ,                 -- fecha del correo
    body_text        TEXT,                        -- SOLO texto (sin HTML, sin binarios)
    snippet          TEXT,
    has_attachments  BOOLEAN NOT NULL DEFAULT FALSE,
    gmail_link       TEXT,                        -- enlace directo al correo en Gmail
    search_query     TEXT,                        -- traza: con qué consulta se encontró
    review_mode      TEXT,                        -- traza: 'today' | 'range'
    reviewed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_trace_thread ON email_trace (thread_id);
CREATE INDEX IF NOT EXISTS idx_email_trace_date   ON email_trace (email_date);

-- ---------------------------------------------------------------------------
-- Referencias de adjuntos (SOLO metadatos, nunca el binario)
-- Permite localizar el archivo directamente en Gmail si se requiere.
-- Nota: se usa message_id como referencia lógica (sin FK estricta) para que el
-- orden de inserción no acople ambas tablas.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_attachment_ref (
    id               BIGSERIAL PRIMARY KEY,
    message_id       TEXT NOT NULL,               -- referencia a email_trace.message_id
    thread_id        TEXT,
    filename         TEXT NOT NULL DEFAULT '',
    mime_type        TEXT,
    size_bytes       BIGINT DEFAULT 0,
    attachment_id    TEXT NOT NULL DEFAULT '',    -- Gmail attachmentId (para recuperar vía API si se requiere)
    gmail_link       TEXT,                        -- enlace al correo que contiene el adjunto
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- evita duplicar la misma referencia al reprocesar
    CONSTRAINT uq_attachment_ref UNIQUE (message_id, attachment_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_attach_message  ON email_attachment_ref (message_id);
CREATE INDEX IF NOT EXISTS idx_attach_filename ON email_attachment_ref (filename);

-- ---------------------------------------------------------------------------
-- Consultas útiles
-- ---------------------------------------------------------------------------
-- Correos revisados hoy:
--   SELECT subject, from_address, email_date, gmail_link
--   FROM email_trace ORDER BY reviewed_at DESC;
--
-- Adjuntos de un hilo (para abrirlos en Gmail):
--   SELECT filename, mime_type, gmail_link
--   FROM email_attachment_ref WHERE thread_id = '<thread_id>';
--
-- Buscar un archivo por nombre y obtener el enlace al correo:
--   SELECT filename, gmail_link FROM email_attachment_ref
--   WHERE filename ILIKE '%reporte%';
