// ── Upsert correos_procesados (todos los correos leídos, no solo match) ─────

function pgStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function pgTs(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `${pgStr(v)}::timestamptz`;
}

function pgDate(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `${pgStr(String(v).slice(0, 10))}::date`;
}

function getCfg() {
  for (const name of ['Config live API', 'Config histórico API', 'Config histórico', 'Configuración']) {
    try {
      const j = $(name).first()?.json;
      if (j && (j.mode || j.startDate !== undefined)) return j;
    } catch (e) {}
  }
  return {};
}

function qinfoForMessage() {
  try {
    const j = $('Construir consulta Gmail').first()?.json;
    if (j) return j;
  } catch (e) {}
  return {};
}

const cfg = getCfg();
const qinfo = qinfoForMessage();
const src = $input.item?.json || $input.first()?.json || {};

if (!src.message_id) {
  return [];
}

const analyzedDate =
  String(cfg.processDate || qinfo.processDate || src.analyzed_date || '').slice(0, 10) || null;
const slotIndex =
  cfg.slotIndex !== undefined && cfg.slotIndex !== null
    ? Number(cfg.slotIndex)
    : qinfo.slotIndex !== undefined && qinfo.slotIndex !== null
      ? Number(qinfo.slotIndex)
      : null;

const row = {
  message_id: src.message_id,
  thread_id: src.thread_id || src.message_id,
  from_address: src.from_address || null,
  to_addresses: src.to_addresses || null,
  cc_addresses: src.cc_addresses || null,
  subject: src.subject || null,
  email_date: src.email_date || null,
  body_text: src.body_text || null,
  snippet: src.snippet || null,
  has_attachments: Boolean(src.has_attachments),
  gmail_link: src.gmail_link || null,
  search_query: src.search_query || qinfo.gmailQuery || null,
  search_after: src.search_after || qinfo.afterIso || null,
  search_before: src.search_before || qinfo.beforeIso || null,
  review_mode: src.review_mode || qinfo.reviewMode || cfg.mode || null,
  analyzed_date: analyzedDate,
  slot_index: Number.isFinite(slotIndex) ? slotIndex : null,
};

const upsertSql = `
INSERT INTO correos_procesados (
  message_id, thread_id, from_address, to_addresses, cc_addresses,
  subject, email_date, body_text, snippet, has_attachments, gmail_link,
  search_query, search_after, search_before, review_mode,
  analyzed_date, slot_index, processed_at
) VALUES (
  ${pgStr(row.message_id)},
  ${pgStr(row.thread_id)},
  ${pgStr(row.from_address)},
  ${pgStr(row.to_addresses)},
  ${pgStr(row.cc_addresses)},
  ${pgStr(row.subject)},
  ${pgTs(row.email_date)},
  ${pgStr(row.body_text)},
  ${pgStr(row.snippet)},
  ${row.has_attachments ? 'true' : 'false'},
  ${pgStr(row.gmail_link)},
  ${pgStr(row.search_query)},
  ${pgTs(row.search_after)},
  ${pgTs(row.search_before)},
  ${pgStr(row.review_mode)},
  ${pgDate(row.analyzed_date)},
  ${row.slot_index === null ? 'NULL' : row.slot_index},
  now()
)
ON CONFLICT (message_id) DO UPDATE SET
  thread_id = EXCLUDED.thread_id,
  from_address = EXCLUDED.from_address,
  to_addresses = EXCLUDED.to_addresses,
  cc_addresses = EXCLUDED.cc_addresses,
  subject = EXCLUDED.subject,
  email_date = EXCLUDED.email_date,
  body_text = EXCLUDED.body_text,
  snippet = EXCLUDED.snippet,
  has_attachments = EXCLUDED.has_attachments,
  gmail_link = EXCLUDED.gmail_link,
  search_query = EXCLUDED.search_query,
  search_after = EXCLUDED.search_after,
  search_before = EXCLUDED.search_before,
  review_mode = EXCLUDED.review_mode,
  analyzed_date = COALESCE(EXCLUDED.analyzed_date, correos_procesados.analyzed_date),
  slot_index = COALESCE(EXCLUDED.slot_index, correos_procesados.slot_index),
  processed_at = now()
RETURNING message_id;
`.trim();

return [{ json: { ...src, upsertSql } }];
