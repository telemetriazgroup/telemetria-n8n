-- Migración: tablas del programa de control (control_correo)
-- Ejecutar en BD existente:
--   docker exec -i postgres-telemetria psql -U telemetria_app -d telemetria \
--     < infra/postgres/06-control-correo.sql

CREATE TABLE IF NOT EXISTS control_schedule (
    year       SMALLINT NOT NULL,
    month      SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    enabled    BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (year, month)
);

CREATE TABLE IF NOT EXISTS control_run (
    id                    BIGSERIAL PRIMARY KEY,
    started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at           TIMESTAMPTZ,
    n8n_execution_id      TEXT,
    window_start          DATE NOT NULL,
    window_end            DATE NOT NULL,
    days_completed_before INT NOT NULL DEFAULT 0,
    days_completed_after  INT,
    action                TEXT NOT NULL DEFAULT 'launch'
        CHECK (action IN ('launch', 'retry_same', 'slide_window', 'stop', 'wait')),
    status                TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'cancelled', 'failed', 'timeout')),
    note                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_control_run_started
    ON control_run (started_at DESC);

CREATE TABLE IF NOT EXISTS control_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    paused BOOLEAN NOT NULL DEFAULT false,
    last_poll_at TIMESTAMPTZ,
    last_completed_date DATE,
    current_window_start DATE,
    current_window_end DATE,
    active_n8n_execution_id TEXT,
    program_range_start DATE NOT NULL DEFAULT '2025-01-01',
    program_range_end DATE NOT NULL DEFAULT '2026-06-30'
);

INSERT INTO control_state (id, paused)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

-- Semilla: 2025 completo + 2026 enero–junio
INSERT INTO control_schedule (year, month, enabled) VALUES
    (2025, 1, true), (2025, 2, true), (2025, 3, true), (2025, 4, true),
    (2025, 5, true), (2025, 6, true), (2025, 7, true), (2025, 8, true),
    (2025, 9, true), (2025, 10, true), (2025, 11, true), (2025, 12, true),
    (2026, 1, true), (2026, 2, true), (2026, 3, true), (2026, 4, true),
    (2026, 5, true), (2026, 6, true)
ON CONFLICT (year, month) DO NOTHING;

COMMENT ON TABLE control_schedule IS 'Meses habilitados para barrido histórico (app control_correo)';
COMMENT ON TABLE control_run IS 'Log de lanzamientos/cancelaciones n8n';
COMMENT ON TABLE control_state IS 'Estado global del scheduler (una fila)';
