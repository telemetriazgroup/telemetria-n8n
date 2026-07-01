// ── Construir consulta Gmail ─────────────────────────────────────────────────
// Modos (Configuración.mode) — SIEMPRE leer $('Configuración'), no $input
// (el input puede ser la fila de "Obtener última revisión").
//
//   incremental -> hoy: desde último search_before incremental de HOY hasta ahora
//   today       -> día local completo
//   range       -> startDate..endDate (independiente del checkpoint del 27)

const cfg = $('Configuración').first().json;
const tzOffset = Number(cfg.tzOffsetHours ?? -5);
const mode = String(cfg.mode || 'incremental').toLowerCase();

function startOfDayEpoch(y, monthIndex, d) {
  return Math.floor(Date.UTC(y, monthIndex, d, 0, 0, 0) / 1000) - tzOffset * 3600;
}

function localTodayParts() {
  const localMs = Date.now() + tzOffset * 3600 * 1000;
  const ld = new Date(localMs);
  return { y: ld.getUTCFullYear(), m: ld.getUTCMonth(), d: ld.getUTCDate() };
}

let afterEpoch;
let beforeEpoch;

if (mode === 'range') {
  if (!cfg.startDate || !cfg.endDate) {
    throw new Error('Modo "range": indica startDate y endDate (YYYY-MM-DD) en Configuración.');
  }
  const [sy, sm, sd] = String(cfg.startDate).split('-').map(Number);
  const [ey, em, ed] = String(cfg.endDate).split('-').map(Number);
  afterEpoch = startOfDayEpoch(sy, sm - 1, sd);
  beforeEpoch = startOfDayEpoch(ey, em - 1, ed) + 86400;
} else if (mode === 'today') {
  const { y, m, d } = localTodayParts();
  afterEpoch = startOfDayEpoch(y, m, d);
  beforeEpoch = afterEpoch + 86400;
} else {
  // incremental — solo checkpoint del MISMO día local; ignora revisiones de otros días
  beforeEpoch = Math.floor(Date.now() / 1000);
  const { y, m, d } = localTodayParts();
  afterEpoch = startOfDayEpoch(y, m, d);

  const last = $('Obtener última revisión').first()?.json || {};
  const lastEpoch = Number(last.last_search_before_epoch || 0);
  if (lastEpoch > 0) {
    const lastLocalMs = lastEpoch * 1000 + tzOffset * 3600 * 1000;
    const ld = new Date(lastLocalMs);
    const sameDay =
      ld.getUTCFullYear() === y &&
      ld.getUTCMonth() === m &&
      ld.getUTCDate() === d;
    if (sameDay && lastEpoch < beforeEpoch) {
      afterEpoch = lastEpoch;
    }
  }
}

let q = `after:${afterEpoch} before:${beforeEpoch}`;

if (cfg.receivedOnly !== false) {
  const mailbox = String(cfg.monitorMailbox || 'telemetria@zgroup.com.pe').trim();
  q += ' -in:sent';
  if (mailbox) q += ` -from:${mailbox}`;
}

if (cfg.keywordFilterEnabled !== false) {
  const required = String(cfg.requiredKeyword || 'telemetria').trim();
  const persons = Array.isArray(cfg.keywords) && cfg.keywords.length
    ? cfg.keywords
    : ['Luis', 'Eusebio'];
  const orPart = persons.map(k => `"${String(k).trim()}"`).filter(Boolean).join(' OR ');
  if (required && orPart) q += ` ${required} (${orPart})`;
}

let knownIdsQuery;
if (mode === 'range') {
  const start = String(cfg.startDate).trim();
  const end = String(cfg.endDate).trim();
  knownIdsQuery = `SELECT message_id FROM email_trace WHERE review_mode = 'range' AND email_date >= '${start}'::date AND email_date < ('${end}'::date + INTERVAL '1 day')`;
} else {
  knownIdsQuery = `SELECT message_id FROM email_trace WHERE review_mode = 'incremental' AND search_before::date = CURRENT_DATE`;
}

return [{
  json: {
    gmailQuery: q,
    reviewMode: mode,
    knownIdsQuery,
    afterEpoch,
    beforeEpoch,
    afterIso: new Date(afterEpoch * 1000).toISOString(),
    beforeIso: new Date(beforeEpoch * 1000).toISOString(),
    searchWindow: `${new Date(afterEpoch * 1000).toISOString()} → ${new Date(beforeEpoch * 1000).toISOString()}`,
    rangeStart: mode === 'range' ? String(cfg.startDate) : null,
    rangeEnd: mode === 'range' ? String(cfg.endDate) : null
  }
}];
