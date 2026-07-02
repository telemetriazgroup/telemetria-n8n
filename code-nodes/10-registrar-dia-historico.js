// ── Registrar resumen del día histórico ─────────────────────────────────────
// Consolida IDs y genera SQL upsert seguro para email_history_day.

function safeAll(nodeName) {
  try { return $(nodeName).all() || []; } catch (e) { return []; }
}

function safeFirstJson(nodeName) {
  try { return $(nodeName).first()?.json || null; } catch (e) { return null; }
}

function pgStr(v) {
  return `'${String(v ?? '').replace(/'/g, "''")}'`;
}

function pgJson(arr) {
  return `'${JSON.stringify(arr || [])}'::jsonb`;
}

function getCfg() {
  for (const name of ['Config histórico API', 'Config histórico', 'Configuración']) {
    try {
      const j = $(name).first()?.json;
      if (j && (j.mode || j.startDate !== undefined)) return j;
    } catch (e) {}
  }
  throw new Error('Ejecuta Configuración o Config histórico.');
}

const cfg = getCfg();
const qinfoMain = safeFirstJson('Construir consulta Gmail') || {};
const filtrarRow = safeFirstJson('Filtrar solo nuevos') || {};
const dayCtx =
  filtrarRow._dayCtx ||
  $input.first()?.json?._dayCtx ||
  {
    processDate: qinfoMain.processDate,
    rangeStart: qinfoMain.rangeStart || cfg.startDate,
    rangeEnd: qinfoMain.rangeEnd || cfg.endDate
  };

const processDate = dayCtx.processDate || qinfoMain.processDate;
if (!processDate) {
  throw new Error('Registrar día histórico: falta processDate del día en curso.');
}

const listRespMain = safeFirstJson('Listar IDs Gmail') || {};
const qinfo =
  (() => {
    try {
      const j = $('Construir consulta Gmail').item?.json;
      if (j && j.gmailQuery) return j;
    } catch (e) { /* optional */ }
    return qinfoMain;
  })();
const listResp =
  (() => {
    try {
      return $('Listar IDs Gmail').item?.json || listRespMain;
    } catch (e) {
      return listRespMain;
    }
  })();

const listedIds = Array.isArray(listResp.messages)
  ? listResp.messages.map(m => m && m.id).filter(Boolean)
  : [];

const processedIds = safeAll('Normalizar correo')
  .map(i => i.json.message_id)
  .filter(Boolean);

const matchIds = safeAll('Filtrar recibidos relevantes')
  .map(i => i.json.message_id)
  .filter(Boolean);

const inputJson = $input.first()?.json || {};
const emptyDay = inputJson._empty === true || inputJson._historicalEmptyDay === true;

const row = {
  analyzed_date: processDate,
  range_start: dayCtx.rangeStart || cfg.startDate,
  range_end: dayCtx.rangeEnd || cfg.endDate,
  gmail_query: qinfo.gmailQuery || '',
  emails_listed_count: listedIds.length,
  emails_processed_count: emptyDay ? 0 : processedIds.length,
  emails_match_count: matchIds.length,
  message_ids_listed: listedIds,
  message_ids_processed: emptyDay ? [] : processedIds,
  message_ids_match: matchIds,
  status: 'completed',
  empty_day: emptyDay
};

const upsertSql = `
INSERT INTO email_history_day (
  analyzed_date, range_start, range_end, gmail_query,
  emails_listed_count, emails_processed_count, emails_match_count,
  message_ids_listed, message_ids_processed, message_ids_match,
  status, analyzed_at
) VALUES (
  ${pgStr(row.analyzed_date)}::date,
  ${pgStr(row.range_start)}::date,
  ${pgStr(row.range_end)}::date,
  ${pgStr(row.gmail_query)},
  ${row.emails_listed_count},
  ${row.emails_processed_count},
  ${row.emails_match_count},
  ${pgJson(row.message_ids_listed)},
  ${pgJson(row.message_ids_processed)},
  ${pgJson(row.message_ids_match)},
  ${pgStr(row.status)},
  now()
)
ON CONFLICT (analyzed_date) DO UPDATE SET
  range_start = EXCLUDED.range_start,
  range_end = EXCLUDED.range_end,
  gmail_query = EXCLUDED.gmail_query,
  emails_listed_count = EXCLUDED.emails_listed_count,
  emails_processed_count = EXCLUDED.emails_processed_count,
  emails_match_count = EXCLUDED.emails_match_count,
  message_ids_listed = EXCLUDED.message_ids_listed,
  message_ids_processed = EXCLUDED.message_ids_processed,
  message_ids_match = EXCLUDED.message_ids_match,
  status = EXCLUDED.status,
  analyzed_at = now()
RETURNING analyzed_date::text AS analyzed_date,
  emails_listed_count, emails_processed_count, emails_match_count;
`.trim();

return [{ json: { ...row, upsertSql } }];
