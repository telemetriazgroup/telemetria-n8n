// ── Sector / lote: procesa como máximo N correos por ejecución ───────────────
// Entrada: salida de "Filtrar solo nuevos" (items con id o marcador _empty).
// Config: batchSize (default 5) en Config histórico / API / webhook.

function getCfg() {
  for (const name of ['Config histórico API', 'Config histórico', 'Configuración']) {
    try {
      const j = $(name).first()?.json;
      if (j && (j.mode || j.startDate !== undefined)) return j;
    } catch (e) {}
  }
  throw new Error('Ejecuta Config histórico antes del sector lote.');
}

const cfg = getCfg();
const batchSize = Math.max(1, Math.min(50, Number(cfg.batchSize ?? 5)));

const items = $input.all();

// Pasar vacíos sin tocar (sin correos / todos ya en BD)
if (items.length === 1 && items[0].json && items[0].json._empty) {
  return items.map(i => ({ json: { ...i.json, _sector: { batchSize, skipped: true } } }));
}

const withId = items.filter(i => i.json && i.json.id);
if (!withId.length) {
  return items;
}

const totalPending = withId.length;
const sector = withId.slice(0, batchSize);
const remainingAfter = Math.max(0, totalPending - sector.length);

const sectorMeta = {
  batchSize,
  sectorCount: sector.length,
  totalPending,
  remainingAfter,
  sectorComplete: remainingAfter === 0,
  sectorIndex: 1
};

return sector.map((item, idx) => ({
  json: {
    ...item.json,
    _sector: idx === 0 ? sectorMeta : { ...sectorMeta, sectorIndex: idx + 1 }
  }
}));
