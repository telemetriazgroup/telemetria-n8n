-- Franjas horarias del día en vivo (seguimiento incremental GMT-5)
CREATE TABLE IF NOT EXISTS email_history_slot (
    id                      BIGSERIAL PRIMARY KEY,
    analyzed_date           DATE NOT NULL,
    slot_index              SMALLINT NOT NULL,
    slot_start              TIMESTAMPTZ NOT NULL,
    slot_end                TIMESTAMPTZ NOT NULL,
    gmail_query             TEXT,
    emails_listed_count     INT NOT NULL DEFAULT 0,
    emails_processed_count  INT NOT NULL DEFAULT 0,
    emails_match_count      INT NOT NULL DEFAULT 0,
    message_ids_processed   JSONB NOT NULL DEFAULT '[]'::jsonb,
    message_ids_match       JSONB NOT NULL DEFAULT '[]'::jsonb,
    status                  TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'partial', 'completed', 'failed')),
    analyzed_at             TIMESTAMPTZ,
    UNIQUE (analyzed_date, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_email_history_slot_date
    ON email_history_slot (analyzed_date, slot_index);

ALTER TABLE control_state
    ADD COLUMN IF NOT EXISTS live_today_date DATE,
    ADD COLUMN IF NOT EXISTS live_last_slot_index SMALLINT,
    ADD COLUMN IF NOT EXISTS live_last_poll_at TIMESTAMPTZ;

COMMENT ON TABLE email_history_slot IS 'Seguimiento en vivo por franja horaria (día actual, America/Lima)';
