-- Checkpoint SOLO para modo incremental (flujo del día).
-- El modo "range" (días anteriores) NO usa este valor.
-- Siempre devuelve 1 fila.

SELECT
  COALESCE(
    EXTRACT(EPOCH FROM MAX(search_before))::bigint,
    0
  ) AS last_search_before_epoch,
  MAX(search_before) AS last_search_before_iso,
  COUNT(*)::int AS incremental_rows
FROM email_trace
WHERE review_mode = 'incremental';
