// Helper: Config histórico (trigger manual) o Configuración (cron)
function nodeJson(nodeName) {
  try {
    const items = $(nodeName).all();
    if (items && items.length && items[0].json) return items[0].json;
  } catch (e) { /* nodo no ejecutado en esta rama */ }
  return null;
}

function getCfg() {
  for (const name of ['Config histórico', 'Configuración']) {
    const j = nodeJson(name);
    if (j && (j.mode || j.startDate !== undefined)) return j;
  }
  throw new Error('Ejecuta Configuración o Config histórico antes de este nodo.');
}
