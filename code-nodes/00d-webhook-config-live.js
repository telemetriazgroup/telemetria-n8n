// ── Config live today desde Webhook (control_correo) ────────────────────────
// POST /webhook/live-run
// Body: mode live_today, processDate, slotStartEpoch, slotEndEpoch, slotIndex

const raw = $input.first()?.json || {};
const body =
  raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body)
    ? raw.body
    : raw;

const processDate = String(body.processDate || body.startDate || '').trim();
const slotIndex = Number(body.slotIndex ?? 0);
const slotStartEpoch = Number(body.slotStartEpoch ?? 0);
const slotEndEpoch = Number(body.slotEndEpoch ?? 0);
const slotLabel = String(body.slotLabel || '').trim();

if (!processDate || !/^\d{4}-\d{2}-\d{2}$/.test(processDate)) {
  throw new Error('Webhook live: processDate YYYY-MM-DD requerido.');
}
if (!slotStartEpoch || !slotEndEpoch || slotEndEpoch <= slotStartEpoch) {
  throw new Error('Webhook live: slotStartEpoch y slotEndEpoch requeridos.');
}

return [{
  json: {
    mode: 'live_today',
    processDate,
    startDate: processDate,
    endDate: processDate,
    slotIndex,
    slotStartEpoch,
    slotEndEpoch,
    slotLabel,
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
    reviewMode: 'incremental',
    _source: 'webhook-live'
  }
}];
