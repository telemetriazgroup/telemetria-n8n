// ── Pasar a registrar (UNA sola vez por lote de Sector lote) ────────────────

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
const sectorMeta = safeAll('Sector lote').find((i) => i.json?._sector)?.json?._sector || {};
const sectorCount = Number(sectorMeta.sectorCount || sectorIds.size || 0);

const filtrarRow = safeAll('Filtrar solo nuevos')[0]?.json || {};
const dayCtx = filtrarRow._dayCtx || safeAll('Sector lote')[0]?.json?._dayCtx || {};

if (!sectorCount) {
  return [{
    json: {
      _loteListo: true,
      sectorCount: 0,
      _dayCtx: dayCtx,
    },
  }];
}

const normalizedInSector = safeAll('Normalizar correo').filter(
  (i) => i.json?.message_id && sectorIds.has(i.json.message_id)
);

if (normalizedInSector.length < sectorCount) {
  return [];
}

const staticData = $getWorkflowStaticData('global');
const batchKey = `${dayCtx.processDate || '?'}:${[...sectorIds].sort().join('|')}`;
if (staticData.lastRegisteredBatch === batchKey) {
  return [];
}
staticData.lastRegisteredBatch = batchKey;

return [{
  json: {
    _loteListo: true,
    sectorCount,
    normalizedCount: normalizedInSector.length,
    _dayCtx: dayCtx,
    batchKey,
  },
}];
