-- Barrido histórico automático (editable desde dashboard).

ALTER TABLE control_state
    ADD COLUMN IF NOT EXISTS historical_auto_sync_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN control_state.historical_auto_sync_enabled IS
    'Si true, el watchdog recorre automáticamente los días históricos pendientes.';
