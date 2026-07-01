// ── Planificar días pendientes (modo historical) ────────────────────────────
// Devuelve solo el primer día pendiente; el loop continúa desde Guardar resumen día.

function getCfg() {
  const tryNames = [
    'Config histórico', 'config histórico', 'Config Histórico',
    'Configuración', 'configuración', 'Configuracion'
  ];
  for (const name of tryNames) {
    try {
      const j = $(name).first()?.json;
      if (j && (j.mode || j.startDate !== undefined)) return j;
    } catch (e) {}
  }
  throw new Error('Ejecuta Config histórico o Configuración antes de planificar.');
}

function collectAnalyzedSet() {
  const set = new Set();
  const buckets = [];

  buckets.push($input.all());
  try { buckets.push($('Impulsar planificación').all() || []); } catch (e) {}
  try { buckets.push($('Obtener días analizados').all() || []); } catch (e) {}

  for (const items of buckets) {
    for (const item of items) {
      const j = item.json || {};
      if (Array.isArray(j.analyzedDates)) {
        for (const d of j.analyzedDates) {
          const ds = String(d || '').slice(0, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) set.add(ds);
        }
      }
      const d = String(j.analyzed_date || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
    }
  }
  return set;
}

const cfg = getCfg();
const mode = String(cfg.mode || '').toLowerCase();

if (mode !== 'historical') {
  return [{ json: { _skipHistorical: true, mode } }];
}

const startDate = String(cfg.startDate || '').trim();
const endDate = String(cfg.endDate || '').trim();

if (!startDate || !endDate) {
  throw new Error('Modo historical: indica startDate y endDate (YYYY-MM-DD).');
}

const analyzedSet = collectAnalyzedSet();

function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function addDays(ymd, n) {
  const dt = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + n, 12, 0, 0));
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate()
  };
}

function fmt(ymd) {
  return `${ymd.y}-${String(ymd.m).padStart(2, '0')}-${String(ymd.d).padStart(2, '0')}`;
}

const pending = [];
let cur = parseYmd(startDate);

while (true) {
  const ds = fmt(cur);
  if (ds > endDate) break;
  if (!analyzedSet.has(ds)) pending.push(ds);
  if (ds === endDate) break;
  cur = addDays(cur, 1);
}

if (!pending.length) {
  return [{
    json: {
      _noPendingDays: true,
      rangeStart: startDate,
      rangeEnd: endDate,
      analyzedDaysKnown: analyzedSet.size,
      message: `Todos los días entre ${startDate} y ${endDate} ya están analizados.`
    }
  }];
}

// Un día por ejecución del loop (Guardar resumen día → Obtener días analizados).
const processDate = pending[0];

return [{
  json: {
    processDate,
    rangeStart: startDate,
    rangeEnd: endDate,
    mode: 'historical',
    dayIndex: 1,
    daysPending: pending.length,
    analyzedDaysKnown: analyzedSet.size
  }
}];
