// ── Filtrar solo correos no registrados en email_trace ─────────────────────
// Entrada: respuesta de Gmail messages.list → { messages: [{ id, threadId }] }
// Consulta IDs ya guardados en el nodo "Obtener IDs en BD".
//
// Si Configuración.skipKnownInDb = false, deja pasar todos (modo reproceso total).

const cfg = $('Configuración').first().json;
const skipKnown = cfg.skipKnownInDb !== false;
const qinfo = $('Construir consulta Gmail').first().json;

const known = new Set(
  ($('Obtener IDs en BD').all() || []).map(i => i.json.message_id).filter(Boolean)
);

const listResp = $input.first().json;
const messages = Array.isArray(listResp.messages) ? listResp.messages : [];

if (!messages.length) {
  return [{ json: { _empty: true, reason: 'sin_correos_en_gmail', totalListed: 0, totalNew: 0 } }];
}

const nuevos = messages.filter(m => m && m.id && (!skipKnown || !known.has(m.id)));

if (!nuevos.length) {
  return [{
    json: {
      _empty: true,
      reason: 'todos_ya_en_bd',
      totalListed: messages.length,
      totalKnown: known.size,
      totalNew: 0,
      gmailQuery: qinfo.gmailQuery
    }
  }];
}

return nuevos.map(m => ({
  json: {
    id: m.id,
    threadId: m.threadId,
    gmailQuery: qinfo.gmailQuery,
    reviewMode: qinfo.reviewMode,
    _meta: {
      totalListed: messages.length,
      totalKnown: known.size,
      totalNew: nuevos.length
    }
  }
}));
