-- Semilla inicial 2025 + 2026 (idempotente). Ya no borra meses futuros ni fija fin de rango.
-- El fin del barrido automático lo define la app (ayer Lima) vía PROGRAM_RANGE_END_OVERRIDE.

UPDATE control_state
SET program_range_start = COALESCE(program_range_start, '2025-01-01'::date)
WHERE id = 1;

INSERT INTO control_schedule (year, month, enabled) VALUES
    (2025, 1, true), (2025, 2, true), (2025, 3, true), (2025, 4, true),
    (2025, 5, true), (2025, 6, true), (2025, 7, true), (2025, 8, true),
    (2025, 9, true), (2025, 10, true), (2025, 11, true), (2025, 12, true),
    (2026, 1, true), (2026, 2, true), (2026, 3, true), (2026, 4, true),
    (2026, 5, true), (2026, 6, true)
ON CONFLICT (year, month) DO NOTHING;
