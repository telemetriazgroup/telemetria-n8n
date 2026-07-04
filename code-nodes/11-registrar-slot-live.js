// ── Registrar franja horaria live_today (email_history_slot) ────────────────

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
  for (const name of ['Config live API', 'Config histórico API', 'Config histórico', 'Configuración']) {
    try {
      const j = $(name).first()?.json;
      if (j && (j.mode || j.startDate !== undefined)) return j;
    } catch (e) {}
  }
  throw new Error('Config live/histórico requerido.');
}

function sectorMessageIds() {
  const ids = new Set();
  for (const item of safeAll('Sector lote')) {
    if (item.json && item.json.id) ids.add(item.json.id);
  }
  return ids;
}

const cfg = getCfg();
if (String(cfg.mode || '').toLowerCase() !== 'live_today') {
  return [{ json: { _skipSlotRegister: true } }];
}

const qinfo = safeFirstJson('Construir consulta Gmail') || {};
const listResp = safeFirstJson('Listar IDs Gmail') || {};
const sectorIds = sectorMessageIds();

const processDate = String(cfg.processDate || qinfo.processDate || '').trim();
const slotIndex = Number(cfg.slotIndex ?? qinfo.slotIndex ?? 0);
const slotStartEpoch = Number(cfg.slotStartEpoch ?? qinfo.afterEpoch ?? 0);
const slotEndEpoch = Number(cfg.slotEndEpoch ?? qinfo.beforeEpoch ?? 0);

if (!processDate) throw new Error('Registrar slot: falta processDate.');

const listedIds = Array.isArray(listResp.messages)
  ? listResp.messages.map(m => m && m.id).filter(Boolean)
  : [];

const processedIds = safeAll('Normalizar correo')
  .filter(i => i.json && i.json.message_id && sectorIds.has(i.json.message_id))
  .map(i => i.json.message_id);

const matchIds = safeAll('Filtrar recibidos relevantes')
  .filter(i => {
    const j = i.json || {};
    return j.message_id && !j._cerrarDiaHistorico && sectorIds.has(j.message_id);
  })
  .map(i => i.json.message_id);

const sector = safeFirstJson('Sector lote')?._sector || null;
let statusHint = listedIds.length === 0 ? 'completed' : 'completed';
if (sector && sector.remainingAfter > 0) statusHint = 'partial';
else if (listedIds.length > 0 && processedIds.length < listedIds.length) statusHint = 'partial';

const mergeProcSql = `
  SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(email_history_slot.message_ids_processed, '[]'::jsonb)) AS elem
    UNION ALL
    SELECT jsonb_array_elements_text(EXCLUDED.message_ids_processed) AS elem
  ) u
`.trim();

const mergeMatchSql = `
  SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(email_history_slot.message_ids_match, '[]'::jsonb)) AS elem
    UNION ALL
    SELECT jsonb_array_elements_text(EXCLUDED.message_ids_match) AS elem
  ) u
`.trim();

const upsertSql = `
INSERT INTO email_history_slot (
  analyzed_date, slot_index, slot_start, slot_end, gmail_query,
  emails_listed_count, emails_processed_count, emails_match_count,
  message_ids_processed, message_ids_match, status, analyzed_at
) VALUES (
  ${pgStr(processDate)}::date,
  ${slotIndex},
  to_timestamp(${slotStartEpoch}),
  to_timestamp(${slotEndEpoch}),
  ${pgStr(qinfo.gmailQuery || '')},
  ${listedIds.length},
  ${processedIds.length},
  ${matchIds.length},
  ${pgJson(processedIds)},
  ${pgJson(matchIds)},
  ${pgStr(statusHint)},
  now()
)
ON CONFLICT (analyzed_date, slot_index) DO UPDATE SET
  gmail_query = EXCLUDED.gmail_query,
  emails_listed_count = EXCLUDED.emails_listed_count,
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
RETURNING analyzed_date::text, slot_index, status,
  emails_listed_count, emails_processed_count, emails_match_count;
`.trim();

return [{
  json: {
    mode: 'live_today',
    processDate,
    slotIndex,
    upsertSql,
    status: statusHint,
    emails_listed_count: listedIds.length,
    emails_processed_count: processedIds.length,
    emails_match_count: matchIds.length
  }
}];
