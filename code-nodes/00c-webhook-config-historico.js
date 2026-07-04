// ── Config histórico desde Webhook (control_correo) ─────────────────────────
// POST /webhook/historico-run
// Body histórico: { "mode": "historical", "startDate": "...", "endDate": "..." }
// Body repair:    { "mode": "repair", "processDate": "2026-07-01", "messageIds": ["abc", ...] }

const raw = $input.first()?.json || {};
const body =
  raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body)
    ? raw.body
    : raw;

const mode = String(body.mode || 'historical').toLowerCase();
const startDate = String(body.startDate || body.start_date || '').trim();
const endDate = String(body.endDate || body.end_date || '').trim();
const processDate = String(body.processDate || body.process_date || startDate || '').trim();
const messageIds = Array.isArray(body.messageIds)
  ? body.messageIds.map(String).filter(Boolean)
  : Array.isArray(body.message_ids)
    ? body.message_ids.map(String).filter(Boolean)
    : [];

if (mode === 'repair') {
  if (!processDate || !/^\d{4}-\d{2}-\d{2}$/.test(processDate)) {
    throw new Error('Webhook repair: processDate YYYY-MM-DD requerido.');
  }
  if (!messageIds.length) {
    throw new Error('Webhook repair: messageIds[] no vacío.');
  }
  return [{
    json: {
      mode: 'repair',
      processDate,
      startDate: processDate,
      endDate: processDate,
      messageIds,
      tzOffsetHours: Number(body.tzOffsetHours ?? -5),
      receivedOnly: body.receivedOnly !== false,
      monitorMailbox: String(body.monitorMailbox || 'telemetria@zgroup.com.pe').trim(),
      keywordFilterEnabled: body.keywordFilterEnabled !== false,
      skipKnownInDb: false,
      keywords: Array.isArray(body.keywords) && body.keywords.length
        ? body.keywords
        : ['Luis', 'Eusebio'],
      telemetriaVariants: Array.isArray(body.telemetriaVariants) && body.telemetriaVariants.length
        ? body.telemetriaVariants
        : ['telemetria', 'telemtria', 'telemetrai', 'ztrack', 'api', 'software', 'plataforma'],
      matchExcerptRadius: Number(body.matchExcerptRadius ?? 120),
      batchSize: Math.max(1, Math.min(50, Number(body.batchSize ?? 5))),
      _source: 'webhook-repair',
    },
  }];
}

if (!startDate || !endDate) {
  throw new Error(
    'Webhook histórico: indica startDate y endDate (YYYY-MM-DD). ' +
    'Ejemplo: {"mode":"historical","startDate":"2026-01-16","endDate":"2026-01-17"}'
  );
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
  throw new Error('Webhook histórico: fechas deben ser YYYY-MM-DD.');
}

return [{
  json: {
    mode,
    startDate,
    endDate,
    tzOffsetHours: Number(body.tzOffsetHours ?? -5),
    receivedOnly: body.receivedOnly !== false,
    monitorMailbox: String(body.monitorMailbox || 'telemetria@zgroup.com.pe').trim(),
    keywordFilterEnabled: body.keywordFilterEnabled !== false,
    skipKnownInDb: body.skipKnownInDb !== false,
    keywords: Array.isArray(body.keywords) && body.keywords.length
      ? body.keywords
      : ['Luis', 'Eusebio'],
    telemetriaVariants: Array.isArray(body.telemetriaVariants) && body.telemetriaVariants.length
      ? body.telemetriaVariants
      : ['telemetria', 'telemtria', 'telemetrai', 'ztrack', 'api', 'software', 'plataforma'],
    matchExcerptRadius: Number(body.matchExcerptRadius ?? 120),
    batchSize: Math.max(1, Math.min(50, Number(body.batchSize ?? 5))),
    _source: 'webhook'
  }
}];
