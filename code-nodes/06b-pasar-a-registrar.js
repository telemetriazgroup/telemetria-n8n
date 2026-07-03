// ── Pasar a registrar (tras guardar trazas/adjuntos o sin matches) ───────────
// Emite 1 item para disparar Registrar + Guardar resumen una sola vez por lote.

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

const sectorIds = [...sectorMessageIds()];
const filtrarRow = safeAll('Filtrar solo nuevos')[0]?.json || {};
const dayCtx = filtrarRow._dayCtx || safeAll('Sector lote')[0]?.json?._dayCtx || {};

return [{
  json: {
    _loteListo: true,
    sectorCount: sectorIds.length,
    _dayCtx: dayCtx
  }
}];
