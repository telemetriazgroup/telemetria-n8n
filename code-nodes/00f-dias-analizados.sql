-- Días ya analizados en el rango. Si no hay ninguno, devuelve 1 fila con analyzed_date NULL
-- (evita que n8n corte el flujo cuando email_history_day está vacía).

WITH done AS (
  SELECT analyzed_date
  FROM email_history_day
  WHERE status = 'completed'
    AND analyzed_date >= '{{ $json.startDate }}'::date
    AND analyzed_date <= '{{ $json.endDate }}'::date
)
SELECT analyzed_date::text AS analyzed_date
FROM done
UNION ALL
SELECT NULL::text AS analyzed_date
WHERE NOT EXISTS (SELECT 1 FROM done)
ORDER BY analyzed_date NULLS FIRST;
