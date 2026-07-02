// Nombres de nodos Set/Code con configuración histórica o incremental (orden de prioridad).
const HIST_CFG_NODE_NAMES = [
  'Config histórico API',
  'Config histórico',
  'config histórico',
  'Config Histórico',
  'Configuración',
  'configuración',
  'Configuracion'
];

function nodeJson(nodeName) {
  try {
    const items = $(nodeName).all();
    if (items && items.length && items[0].json) return items[0].json;
  } catch (e) { /* nodo no ejecutado */ }
  return null;
}

function getHistCfg() {
  for (const name of HIST_CFG_NODE_NAMES) {
    try {
      const j = $(name).first()?.json;
      if (j && (j.mode || j.startDate !== undefined)) return j;
    } catch (e) { /* optional */ }
    const j = nodeJson(name);
    if (j && (j.mode || j.startDate !== undefined)) return j;
  }
  throw new Error('Ejecuta Config histórico API, Config histórico o Configuración.');
}

function histCfgForSql() {
  for (const name of ['Config histórico API', 'Config histórico', 'Configuración']) {
    try {
      if ($(name).isExecuted) return $(name).first().json;
    } catch (e) { /* optional */ }
  }
  return $('Configuración').first().json;
}
