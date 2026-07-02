-- Ampliar planificación: todo 2025 + enero–junio 2026
-- Idempotente — ejecutar en BD ya migrada con 06-control-correo.sql

UPDATE control_state
SET program_range_start = '2025-01-01',
    program_range_end = '2026-06-30'
WHERE id = 1;

INSERT INTO control_schedule (year, month, enabled) VALUES
    (2025, 1, true), (2025, 2, true), (2025, 3, true), (2025, 4, true),
    (2025, 5, true), (2025, 6, true), (2025, 7, true), (2025, 8, true),
    (2025, 9, true), (2025, 10, true), (2025, 11, true), (2025, 12, true),
    (2026, 1, true), (2026, 2, true), (2026, 3, true), (2026, 4, true),
    (2026, 5, true), (2026, 6, true)
ON CONFLICT (year, month) DO UPDATE SET enabled = EXCLUDED.enabled;

DELETE FROM control_schedule WHERE year > 2026 OR (year = 2026 AND month > 6);
