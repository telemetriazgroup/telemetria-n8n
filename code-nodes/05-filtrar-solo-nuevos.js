// ── Filtrar solo correos no registrados en email_trace ─────────────────────
// Entrada: respuesta de Gmail messages.list → { messages: [{ id, threadId }] }
//
// Requiere que en el MISMO run hayan ejecutado antes:
//   Construir consulta Gmail → Listar IDs Gmail → (este nodo)
//   Construir consulta Gmail → Obtener IDs en BD (rama paralela, puede 0 filas)
//
// Si Configuración.skipKnownInDb = false, deja pasar todos.

function safeAll(nodeName) {
  try {
    return $(nodeName).all() || [];
  } catch (e) {
    return [];
  }
}

function safeFirstJson(nodeName) {
  try {
    return $(nodeName).first()?.json || null;
  } catch (e) {
    return null;
  }
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
const skipKnown = cfg.skipKnownInDb !== false;

function qinfoForDay() {
  try {
    const j = $('Construir consulta Gmail').item?.json;
    if (j && j.gmailQuery) return j;
  } catch (e) { /* optional */ }
  return safeFirstJson('Construir consulta Gmail');
}

const qinfo = qinfoForDay();
if (!qinfo || !qinfo.gmailQuery) {
  throw new Error(
    'Falta ejecutar "Construir consulta Gmail" antes de "Filtrar solo nuevos".'
  );
}

function knownIdsForCurrentDay() {
  const ids = new Set();
  try {
    const paired = $('Obtener IDs en BD').item;
    if (paired && paired.json && paired.json.message_id) {
      ids.add(paired.json.message_id);
      return ids;
    }
  } catch (e) { /* optional */ }
  for (const item of safeAll('Obtener IDs en BD')) {
    const id = item.json && item.json.message_id;
    if (id) ids.add(id);
  }
  return ids;
}

const known = knownIdsForCurrentDay();

const listResp = $input.first().json;
const messages = Array.isArray(listResp.messages) ? listResp.messages : [];

if (!messages.length) {
  return [{
    json: {
      _empty: true,
      reason: 'sin_correos_en_gmail',
      totalListed: 0,
      totalNew: 0,
      _qinfo: qinfo,
      _dayCtx: {
        processDate: qinfo.processDate,
        rangeStart: qinfo.rangeStart,
        rangeEnd: qinfo.rangeEnd
      }
    }
  }];
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
      gmailQuery: qinfo.gmailQuery,
      _qinfo: qinfo,
      _dayCtx: {
        processDate: qinfo.processDate,
        rangeStart: qinfo.rangeStart,
        rangeEnd: qinfo.rangeEnd
      }
    }
  }];
}

return nuevos.map(m => ({
  json: {
    id: m.id,
    threadId: m.threadId,
    gmailQuery: qinfo.gmailQuery,
    reviewMode: qinfo.reviewMode,
    _qinfo: qinfo,
    _dayCtx: {
      processDate: qinfo.processDate,
      rangeStart: qinfo.rangeStart,
      rangeEnd: qinfo.rangeEnd
    },
    _meta: {
      totalListed: messages.length,
      totalKnown: known.size,
      totalNew: nuevos.length
    }
  }
}));
