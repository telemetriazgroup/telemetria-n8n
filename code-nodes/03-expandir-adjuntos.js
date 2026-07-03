// ── Expandir adjuntos (una fila por referencia de adjunto) ──────────────────
// Lee Normalizar + IDs con match en este lote (no depende del $input de Postgres).

function safeAll(nodeName) {
  try { return $(nodeName).all() || []; } catch (e) { return []; }
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

const sectorIds = sectorMessageIds();
const matchIds = new Set(
  safeAll('Filtrar recibidos relevantes')
    .map(i => i.json && i.json.message_id)
    .filter(id => id && !String(id).startsWith('_'))
);

const out = [];

for (const item of safeAll('Normalizar correo')) {
  const m = item.json;
  if (!m || !m.message_id) continue;
  if (sectorIds.size && !sectorIds.has(m.message_id)) continue;
  if (matchIds.size && !matchIds.has(m.message_id)) continue;

  const atts = Array.isArray(m.attachments) ? m.attachments : [];
  for (const a of atts) {
    out.push({
      json: {
        message_id: m.message_id,
        thread_id: m.thread_id,
        filename: a.filename || '',
        mime_type: a.mime_type || '',
        size_bytes: a.size_bytes || 0,
        attachment_id: a.attachment_id || '',
        gmail_link: m.gmail_link
      }
    });
  }
}

if (!out.length) {
  return [{ json: { _noAttachmentsInBatch: true } }];
}

return out;
