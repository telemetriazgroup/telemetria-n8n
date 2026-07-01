-- Marca todos los correos activos como superseded (conserva historial).
-- Tras esto, knownIdsQuery no los excluye y el incremental reprocesa hoy.
-- Siempre devuelve 1 fila.

WITH updated AS (
  UPDATE email_trace
  SET trace_status = 'superseded'
  WHERE trace_status = 'active'
  RETURNING id
)
SELECT
  COUNT(*)::int AS superseded_count,
  now() AS superseded_at
FROM updated;
