// ── Construir consulta Gmail ─────────────────────────────────────────────────
// Modos — leer Config histórico o Configuración (compatible runOnceForEachItem)

function nodeJson(nodeName) {
  try {
    const items = $(nodeName).all();
    if (items && items.length && items[0].json) return items[0].json;
  } catch (e) { /* nodo no ejecutado en esta rama */ }
  return null;
}

function getCfg() {
  for (const name of ['Config histórico API', 'Config histórico', 'Configuración']) {
    const j = nodeJson(name);
    if (j && (j.mode || j.startDate !== undefined)) return j;
  }
  throw new Error('Ejecuta Configuración o Config histórico antes de este nodo.');
}

function inputJson() {
  try {
    const item = $input.item;
    if (item && item.json) return item.json;
  } catch (e) { /* runOnceForAllItems */ }
  const all = $input.all();
  return (all[0] && all[0].json) || {};
}

const cfg = getCfg();
const dayItem = inputJson();
const tzOffset = Number(cfg.tzOffsetHours ?? -5);
const mode = String(dayItem.mode || cfg.mode || 'incremental').toLowerCase();

function startOfDayEpoch(y, monthIndex, d) {
  return Math.floor(Date.UTC(y, monthIndex, d, 0, 0, 0) / 1000) - tzOffset * 3600;
}

function localTodayParts() {
  const localMs = Date.now() + tzOffset * 3600 * 1000;
  const ld = new Date(localMs);
  return { y: ld.getUTCFullYear(), m: ld.getUTCMonth(), d: ld.getUTCDate() };
}

function epochFromYmd(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return startOfDayEpoch(y, m - 1, d);
}

let afterEpoch;
let beforeEpoch;
let processDate = null;
let slotIndex = null;

if (mode === 'repair') {
  processDate = String(cfg.processDate || dayItem.processDate || '').trim();
  afterEpoch = epochFromYmd(processDate);
  beforeEpoch = afterEpoch + 86400;
} else if (mode === 'live_today') {
  processDate = String(cfg.processDate || dayItem.processDate || '').trim();
  slotIndex = Number(cfg.slotIndex ?? dayItem.slotIndex ?? 0);
  afterEpoch = Number(cfg.slotStartEpoch ?? dayItem.slotStartEpoch ?? 0);
  beforeEpoch = Number(cfg.slotEndEpoch ?? dayItem.slotEndEpoch ?? 0);
  if (!processDate || !afterEpoch || !beforeEpoch) {
    throw new Error('Modo live_today: processDate y franja horaria (epoch) requeridos.');
  }
} else if (mode === 'historical') {
  processDate = String(dayItem.processDate || '').trim();
  if (!processDate) {
    throw new Error('Modo historical: falta processDate (Planificar días pendientes).');
  }
  const slotStart = Number(cfg.slotStartEpoch ?? dayItem.slotStartEpoch ?? 0);
  const slotEnd = Number(cfg.slotEndEpoch ?? dayItem.slotEndEpoch ?? 0);
  if (slotStart > 0 && slotEnd > slotStart) {
    afterEpoch = slotStart;
    beforeEpoch = slotEnd;
  } else {
    afterEpoch = epochFromYmd(processDate);
    beforeEpoch = afterEpoch + 86400;
  }
} else if (mode === 'range') {
  if (!cfg.startDate || !cfg.endDate) {
    throw new Error('Modo "range": indica startDate y endDate (YYYY-MM-DD) en Configuración.');
  }
  afterEpoch = epochFromYmd(cfg.startDate);
  beforeEpoch = epochFromYmd(cfg.endDate) + 86400;
} else if (mode === 'today') {
  const { y, m, d } = localTodayParts();
  afterEpoch = startOfDayEpoch(y, m, d);
  beforeEpoch = afterEpoch + 86400;
} else {
  beforeEpoch = Math.floor(Date.now() / 1000);
  const { y, m, d } = localTodayParts();
  afterEpoch = startOfDayEpoch(y, m, d);

  const last = nodeJson('Obtener última revisión') || {};
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

// En historical/live_today: NO filtrar en Gmail — se listan recibidos de la franja
if (cfg.keywordFilterEnabled !== false && mode !== 'historical' && mode !== 'live_today') {
  const telemetriaKws = Array.isArray(cfg.telemetriaVariants) && cfg.telemetriaVariants.length
    ? cfg.telemetriaVariants
    : ['telemetria', 'telemtria', 'telemetrai', 'ztrack', 'api', 'software', 'plataforma'];
  const persons = Array.isArray(cfg.keywords) && cfg.keywords.length
    ? cfg.keywords
    : ['Luis', 'Eusebio'];
  const telPart = telemetriaKws.map(k => `"${String(k).trim()}"`).filter(Boolean).join(' OR ');
  const personPart = persons.map(k => `"${String(k).trim()}"`).filter(Boolean).join(' OR ');
  if (telPart && personPart) q += ` (${telPart}) (${personPart})`;
}

let knownIdsQuery;
if (mode === 'live_today') {
  const d = processDate.replace(/'/g, '');
  const idx = Number(slotIndex ?? 0);
  knownIdsQuery = `
SELECT message_id FROM email_trace
WHERE trace_status = 'active'
  AND review_mode = 'incremental'
  AND email_date >= to_timestamp(${afterEpoch}) AT TIME ZONE 'America/Lima'
  AND email_date < to_timestamp(${beforeEpoch}) AT TIME ZONE 'America/Lima'
UNION
SELECT proc.elem
FROM email_history_slot slot,
     jsonb_array_elements_text(COALESCE(slot.message_ids_processed, '[]'::jsonb)) proc(elem)
WHERE slot.analyzed_date = '${d}'::date AND slot.slot_index = ${idx}
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(slot.message_ids_match, '[]'::jsonb)) m(elem)
    WHERE m.elem = proc.elem
  )
`.trim();
} else if (mode === 'historical') {
  const d = processDate.replace(/'/g, '');
  knownIdsQuery = `
SELECT message_id FROM email_trace
WHERE trace_status = 'active'
  AND review_mode = 'historical'
  AND (search_after::date = '${d}'::date OR email_date::date = '${d}'::date)
UNION
SELECT proc.elem
FROM email_history_day ehd,
     jsonb_array_elements_text(COALESCE(ehd.message_ids_processed, '[]'::jsonb)) proc(elem)
WHERE ehd.analyzed_date = '${d}'::date
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(ehd.message_ids_match, '[]'::jsonb)) m(elem)
    WHERE m.elem = proc.elem
  )
`.trim();
} else if (mode === 'repair') {
  knownIdsQuery = `SELECT NULL::text AS message_id WHERE false`;
} else if (mode === 'range') {
  const start = String(cfg.startDate).trim();
  const end = String(cfg.endDate).trim();
  knownIdsQuery = `SELECT message_id FROM email_trace WHERE trace_status = 'active' AND review_mode = 'range' AND email_date >= '${start}'::date AND email_date < ('${end}'::date + INTERVAL '1 day')`;
} else {
  knownIdsQuery = `SELECT message_id FROM email_trace WHERE trace_status = 'active' AND review_mode = 'incremental' AND search_before::date = CURRENT_DATE`;
}

return [{
  json: {
    gmailQuery: q,
    reviewMode: mode === 'live_today' ? 'incremental' : (mode === 'repair' ? 'historical' : mode),
    processDate,
    slotIndex,
    knownIdsQuery,
    afterEpoch,
    beforeEpoch,
    afterIso: new Date(afterEpoch * 1000).toISOString(),
    beforeIso: new Date(beforeEpoch * 1000).toISOString(),
    searchWindow: `${new Date(afterEpoch * 1000).toISOString()} → ${new Date(beforeEpoch * 1000).toISOString()}`,
    rangeStart: mode === 'historical' ? (dayItem.rangeStart || cfg.startDate) : (mode === 'range' ? String(cfg.startDate) : null),
    rangeEnd: mode === 'historical' ? (dayItem.rangeEnd || cfg.endDate) : (mode === 'range' ? String(cfg.endDate) : null)
  }
}];
