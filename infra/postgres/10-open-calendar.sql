-- Calendario abierto: todos los meses habilitados por defecto (sin borrar filas).
-- Idempotente.

INSERT INTO control_schedule (year, month, enabled) VALUES
    (2026, 7, true), (2026, 8, true), (2026, 9, true), (2026, 10, true),
    (2026, 11, true), (2026, 12, true),
    (2027, 1, true), (2027, 2, true), (2027, 3, true), (2027, 4, true),
    (2027, 5, true), (2027, 6, true), (2027, 7, true), (2027, 8, true),
    (2027, 9, true), (2027, 10, true), (2027, 11, true), (2027, 12, true),
    (2028, 1, true), (2028, 2, true), (2028, 3, true), (2028, 4, true),
    (2028, 5, true), (2028, 6, true), (2028, 7, true), (2028, 8, true),
    (2028, 9, true), (2028, 10, true), (2028, 11, true), (2028, 12, true),
    (2029, 1, true), (2029, 2, true), (2029, 3, true), (2029, 4, true),
    (2029, 5, true), (2029, 6, true), (2029, 7, true), (2029, 8, true),
    (2029, 9, true), (2029, 10, true), (2029, 11, true), (2029, 12, true),
    (2030, 1, true), (2030, 2, true), (2030, 3, true), (2030, 4, true),
    (2030, 5, true), (2030, 6, true), (2030, 7, true), (2030, 8, true),
    (2030, 9, true), (2030, 10, true), (2030, 11, true), (2030, 12, true)
ON CONFLICT (year, month) DO NOTHING;
