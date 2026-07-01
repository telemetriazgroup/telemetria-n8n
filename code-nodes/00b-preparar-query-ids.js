// ── Armar query de IDs conocidos según modo ─────────────────────────────────
// Emite la SQL para el nodo Postgres "Obtener IDs en BD".
// incremental/today → solo IDs del flujo incremental de hoy
// range             → solo IDs ya guardados en ese rango de fechas

const cfg = $('Configuración').first().json;
const mode = String(cfg.mode || 'incremental').toLowerCase();

let query;

if (mode === 'range') {
  const start = String(cfg.startDate || '').trim();
  const end = String(cfg.endDate || '').trim();
  if (!start || !end) {
    throw new Error('Modo range: startDate y endDate requeridos.');
  }
  query = `
SELECT message_id
FROM email_trace
WHERE review_mode = 'range'
  AND email_date >= '${start}'::date
  AND email_date < ('${end}'::date + INTERVAL '1 day')
`.trim();
} else {
  query = `
SELECT message_id
FROM email_trace
WHERE review_mode = 'incremental'
  AND search_before::date = CURRENT_DATE
`.trim();
}

return [{ json: { query, mode, startDate: cfg.startDate || null, endDate: cfg.endDate || null } }];
