// ── Config histórico desde Webhook (control_correo) ─────────────────────────
// POST /webhook/historico-run
// Body JSON: { "mode": "historical", "startDate": "2026-01-16", "endDate": "2026-01-17" }

const raw = $input.first()?.json || {};
const body =
  raw.body && typeof raw.body === 'object' && !Array.isArray(raw.body)
    ? raw.body
    : raw;

const startDate = String(body.startDate || body.start_date || '').trim();
const endDate = String(body.endDate || body.end_date || '').trim();
const mode = String(body.mode || 'historical').toLowerCase();

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
    _source: 'webhook'
  }
}];
