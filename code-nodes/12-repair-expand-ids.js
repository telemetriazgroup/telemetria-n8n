// ── Modo repair: expandir messageIds → items { id } para Leer Gmail ─────────
function getCfg() {
  for (const name of ['Config histórico API', 'Config histórico', 'Configuración']) {
    try {
      const j = $(name).first()?.json;
      if (j && (j.mode || j.processDate)) return j;
    } catch (e) {}
  }
  throw new Error('Falta Config histórico API con mode=repair.');
}

const cfg = getCfg();
const mode = String(cfg.mode || '').toLowerCase();
if (mode !== 'repair') {
  throw new Error('Reparar IDs: se esperaba mode=repair.');
}

const processDate = String(cfg.processDate || '').trim();
const ids = Array.isArray(cfg.messageIds) ? cfg.messageIds : [];
if (!processDate || !ids.length) {
  throw new Error('Repair: processDate y messageIds[] requeridos.');
}

return ids.map((raw) => ({
  json: {
    id: String(raw).trim(),
    processDate,
    mode: 'repair',
    reviewMode: 'historical',
  },
})).filter((item) => item.json.id);
