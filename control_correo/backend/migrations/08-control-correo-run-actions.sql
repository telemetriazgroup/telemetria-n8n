-- Ampliar acciones válidas en control_run (lotes parciales / cierre de día)
ALTER TABLE control_run DROP CONSTRAINT IF EXISTS control_run_action_check;

ALTER TABLE control_run ADD CONSTRAINT control_run_action_check
    CHECK (action IN (
        'launch',
        'retry_same',
        'slide_window',
        'stop',
        'wait',
        'batch_partial',
        'batch_day_completed'
    ));
