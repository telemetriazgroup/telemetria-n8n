// ── Construir consulta Gmail (modo "today" / "range") ───────────────────────
// Lee la configuración del nodo "Configuración" y arma el parámetro de búsqueda
// `q` de Gmail usando timestamps epoch en segundos, para evitar ambigüedad de
// zona horaria (el contenedor de n8n suele estar en UTC; Lima es UTC-5).
//
//   mode = "today" -> correos del día de hoy (en la zona horaria configurada)
//   mode = "range" -> correos entre startDate y endDate (ambos inclusive)

const cfg = $input.first().json;

const tzOffset = Number(cfg.tzOffsetHours ?? -5);          // Lima = -5
const mode = String(cfg.mode || 'today').toLowerCase();

// epoch (segundos) del inicio del día local para una fecha "wall clock" local
function startOfDayEpoch(y, monthIndex, d) {
  return Math.floor(Date.UTC(y, monthIndex, d, 0, 0, 0) / 1000) - tzOffset * 3600;
}

let afterEpoch, beforeEpoch;

if (mode === 'range') {
  if (!cfg.startDate || !cfg.endDate) {
    throw new Error('El modo "range" requiere startDate y endDate en formato YYYY-MM-DD.');
  }
  const [sy, sm, sd] = String(cfg.startDate).split('-').map(Number);
  const [ey, em, ed] = String(cfg.endDate).split('-').map(Number);
  afterEpoch  = startOfDayEpoch(sy, sm - 1, sd);
  beforeEpoch = startOfDayEpoch(ey, em - 1, ed) + 86400;  // incluye el endDate completo
} else {
  // today, en la zona horaria configurada
  const localMs = Date.now() + tzOffset * 3600 * 1000;
  const ld = new Date(localMs);
  afterEpoch  = startOfDayEpoch(ld.getUTCFullYear(), ld.getUTCMonth(), ld.getUTCDate());
  beforeEpoch = afterEpoch + 86400;
}

let q = `after:${afterEpoch} before:${beforeEpoch}`;

// Filtro opcional por palabras clave (configurable y ampliable)
if (cfg.keywordFilterEnabled && Array.isArray(cfg.keywords) && cfg.keywords.length) {
  const kw = cfg.keywords.map(k => `"${k}"`).join(' OR ');
  q += ` (${kw})`;
}

return [{
  json: {
    gmailQuery: q,
    reviewMode: mode,
    afterEpoch,
    beforeEpoch,
    afterIso:  new Date(afterEpoch  * 1000).toISOString(),
    beforeIso: new Date(beforeEpoch * 1000).toISOString()
  }
}];
