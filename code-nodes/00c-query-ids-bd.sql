-- IDs ya guardados según el modo de búsqueda (ver code-nodes/00c-query-ids-bd.sql)
-- En n8n: pegar la rama correspondiente según Configuración.mode

-- ── MODO incremental / today: solo lo revisado hoy en flujo incremental ──
SELECT message_id
FROM email_trace
WHERE review_mode = 'incremental'
  AND search_before::date = CURRENT_DATE;

-- ── MODO range: solo correos cuya fecha cae en el rango configurado ──
-- Reemplaza fechas al ejecutar o usa expresión n8n con startDate/endDate:
-- SELECT message_id
-- FROM email_trace
-- WHERE review_mode = 'range'
--   AND email_date >= '2026-06-20'::date
--   AND email_date < ('2026-06-26'::date + INTERVAL '1 day');
