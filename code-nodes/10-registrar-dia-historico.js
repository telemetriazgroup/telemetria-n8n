// ── Registrar resumen del día histórico ─────────────────────────────────────
// Consolida IDs del LOTE ACTUAL (Sector lote) y genera upsert en email_history_day.

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

function sectorMessageIds() {
  const ids = new Set();
  for (const item of safeAll('Sector lote')) {
    if (item.json && item.json.id) ids.add(item.json.id);
  }
  if (!ids.size) {
    for (const item of safeAll('Filtrar solo nuevos')) {
      if (item.json && item.json.id) ids.add(item.json.id);
    }
  }
  return ids;
}

const cfg = getCfg();
const qinfoMain = safeFirstJson('Construir consulta Gmail') || {};
const filtrarRow = safeFirstJson('Filtrar solo nuevos') || safeFirstJson('Sector lote') || {};
const sectorRow = safeFirstJson('Sector lote') || {};
const sectorIds = sectorMessageIds();

const dayCtx =
  filtrarRow._dayCtx ||
  sectorRow._dayCtx ||
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
      return $('Listar IDs Gmail').item?.json || safeFirstJson('Listar IDs Gmail') || {};
    } catch (e) {
      return safeFirstJson('Listar IDs Gmail') || {};
    }
  })();

const listedIds = Array.isArray(listResp.messages)
  ? listResp.messages.map(m => m && m.id).filter(Boolean)
  : [];

// Solo IDs del lote actual (evita mezclar vueltas anteriores del bucle n8n)
const processedIds = safeAll('Normalizar correo')
  .filter(i => i.json && i.json.message_id && sectorIds.has(i.json.message_id))
  .map(i => i.json.message_id);

const matchIds = safeAll('Filtrar recibidos relevantes')
  .filter(i => {
    const j = i.json || {};
    return j.message_id && !j._cerrarDiaHistorico && sectorIds.has(j.message_id);
  })
  .map(i => i.json.message_id);

const inputJson = $input.first()?.json || {};
const emptyMarker = inputJson._empty === true || inputJson._historicalEmptyDay === true;
const emptyReason = String(filtrarRow.reason || inputJson.reason || '');

const sector = sectorRow._sector || filtrarRow._sector || null;

let batchProcessed = processedIds;
let batchMatch = matchIds;
let statusHint = 'completed';

if (emptyMarker && emptyReason === 'sin_correos_en_gmail') {
  batchProcessed = [];
  batchMatch = [];
  statusHint = 'completed';
} else if (emptyMarker && emptyReason === 'todos_ya_en_bd') {
  batchProcessed = listedIds;
  batchMatch = matchIds;
  statusHint = 'completed';
} else if (sectorIds.size > 0 && batchProcessed.length === 0) {
  throw new Error(
    `Registrar día ${processDate}: el lote tiene ${sectorIds.size} ID(s) en Sector lote ` +
    'pero Normalizar no devolvió message_id. Revisa Leer Gmail antes de Guardar resumen.'
  );
} else if (sector && sector.remainingAfter > 0) {
  statusHint = 'partial';
} else if (listedIds.length > 0 && batchProcessed.length < listedIds.length) {
  statusHint = 'partial';
} else if (listedIds.length > 0) {
  statusHint = 'completed';
}

const row = {
  analyzed_date: processDate,
  range_start: dayCtx.rangeStart || cfg.startDate,
  range_end: dayCtx.rangeEnd || cfg.endDate,
  gmail_query: qinfo.gmailQuery || '',
  emails_listed_count: listedIds.length,
  emails_processed_count: batchProcessed.length,
  emails_match_count: batchMatch.length,
  message_ids_listed: listedIds,
  message_ids_processed: batchProcessed,
  message_ids_match: batchMatch,
  status: statusHint,
  empty_day: emptyMarker && emptyReason === 'sin_correos_en_gmail',
  empty_reason: emptyReason,
  sector: sector || null
};

const mergeProcSql = `
  SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(email_history_day.message_ids_processed, '[]'::jsonb)) AS elem
    UNION ALL
    SELECT jsonb_array_elements_text(EXCLUDED.message_ids_processed) AS elem
  ) u
`.trim();

const mergeMatchSql = `
  SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(email_history_day.message_ids_match, '[]'::jsonb)) AS elem
    UNION ALL
    SELECT jsonb_array_elements_text(EXCLUDED.message_ids_match) AS elem
  ) u
`.trim();

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
  message_ids_listed = EXCLUDED.message_ids_listed,
  message_ids_processed = (${mergeProcSql}),
  message_ids_match = (${mergeMatchSql}),
  emails_processed_count = jsonb_array_length((${mergeProcSql})),
  emails_match_count = jsonb_array_length((${mergeMatchSql})),
  status = CASE
    WHEN EXCLUDED.emails_listed_count = 0 THEN 'completed'
    WHEN jsonb_array_length((${mergeProcSql})) >= EXCLUDED.emails_listed_count THEN 'completed'
    ELSE 'partial'
  END,
  analyzed_at = now()
RETURNING analyzed_date::text AS analyzed_date,
  emails_listed_count, emails_processed_count, emails_match_count,
  status,
  message_ids_processed, message_ids_match;
`.trim();

return [{ json: { ...row, upsertSql } }];
