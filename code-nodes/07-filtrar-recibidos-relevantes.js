// ── Filtrar: recibidos + telemetria AND (Luis OR Eusebio) con posiciones ────
// Case-insensitive. Acepta variantes: telemetria, telemtria, telemetrai.
// Añade match_telemetria_pos, match_person_pos, match_person_keyword al item.

const cfg = $('Configuración').first().json;
const monitor = String(cfg.monitorMailbox || 'telemetria@zgroup.com.pe').toLowerCase();
const receivedOnly = cfg.receivedOnly !== false;
const keywordEnabled = cfg.keywordFilterEnabled !== false;
const personKws = (Array.isArray(cfg.keywords) && cfg.keywords.length)
  ? cfg.keywords
  : ['Luis', 'Eusebio'];

const telemetriaVariants = Array.isArray(cfg.telemetriaVariants) && cfg.telemetriaVariants.length
  ? cfg.telemetriaVariants
  : ['telemetria', 'telemtria', 'telemetrai'];

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSentByMonitor(fromAddress, labelIds) {
  const from = String(fromAddress || '').toLowerCase();
  if (from.includes(monitor)) return true;
  if (Array.isArray(labelIds) && labelIds.includes('SENT')) return true;
  return false;
}

function findTelemetria(haystack) {
  for (const variant of telemetriaVariants) {
    const re = new RegExp(escapeRe(variant), 'i');
    const m = re.exec(haystack);
    if (m) return { position: m.index, matched: m[0], keyword: variant };
  }
  return null;
}

function findPerson(haystack, keywords) {
  for (const kw of keywords) {
    const re = new RegExp(`\\b${escapeRe(kw)}\\b`, 'i');
    const m = re.exec(haystack);
    if (m) return { position: m.index, matched: m[0], keyword: kw };
  }
  return null;
}

const out = [];

for (const item of $input.all()) {
  const m = item.json;

  if (receivedOnly && isSentByMonitor(m.from_address, m.label_ids)) {
    continue;
  }

  if (keywordEnabled) {
    const haystack = `${m.subject || ''}\n${m.body_text || ''}\n${m.snippet || ''}`;
    const tel = findTelemetria(haystack);
    if (!tel) continue;
    const person = findPerson(haystack, personKws);
    if (!person) continue;

    m.match_telemetria_pos = tel.position;
    m.match_person_pos = person.position;
    m.match_person_keyword = person.matched;
  }

  out.push({ json: m });
}

return out;
