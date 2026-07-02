// ── Filtrar: recibidos + keyword telemetría AND (Luis OR Eusebio) ───────────
// Reglas:
//   • Palabra suelta (límite \b): telemetria, ztrack, api, software, plataforma…
//   • NO cuenta dentro de correos: telemetria@…, @telemetria@…
//   • NO cuenta en encabezados CC/Para: 'ZTRACK TELEMETRY' <ztrack@…>,
//     'telemetria zgroup' <telemetria@…>, listas con ; y <...@…>
//   • Luis / Eusebio: palabra suelta, fuera de correos y encabezados
//   • Dos fragmentos independientes (telemetría + persona)

function getCfg() {
  for (const name of ['Config histórico API', 'Config histórico', 'Configuración']) {
    try {
      const j = $(name).first()?.json;
      if (j && (j.mode || j.startDate !== undefined)) return j;
    } catch (e) {}
  }
  throw new Error('Ejecuta Configuración o Config histórico.');
}

const cfg = getCfg();
const monitor = String(cfg.monitorMailbox || 'telemetria@zgroup.com.pe').toLowerCase();
const receivedOnly = cfg.receivedOnly !== false;
const keywordEnabled = cfg.keywordFilterEnabled !== false;
const excerptRadius = Number(cfg.matchExcerptRadius ?? 120);
const personKws = (Array.isArray(cfg.keywords) && cfg.keywords.length)
  ? cfg.keywords
  : ['Luis', 'Eusebio'];

const telemetriaVariants = Array.isArray(cfg.telemetriaVariants) && cfg.telemetriaVariants.length
  ? cfg.telemetriaVariants
  : ['telemetria', 'telemtria', 'telemetrai', 'ztrack', 'api', 'software', 'plataforma'];

const HEADER_LABEL_BLOCKLIST = [
  /ztrack\s+telemetry/i,
  /telemetria\s+zgroup/i,
];

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function excerptAround(text, pos, radius) {
  if (text == null || pos == null || pos < 0) return '';
  const s = String(text);
  const start = Math.max(0, pos - radius);
  const end = Math.min(s.length, pos + radius);
  let chunk = s.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) chunk = '…' + chunk;
  if (end < s.length) chunk = chunk + '…';
  return chunk;
}

function fieldAtPosition(subject, body, snippet, pos) {
  const sub = String(subject || '');
  const bod = String(body || '');
  const subEnd = sub.length;
  const bodyEnd = subEnd + 1 + bod.length;
  if (pos < subEnd) return 'subject';
  if (pos < bodyEnd) return 'body';
  return 'snippet';
}

function buildHaystack(subject, body, snippet) {
  return `${subject || ''}\n${body || ''}\n${snippet || ''}`;
}

function isInsideAngleEmail(text, start, end) {
  const lt = text.lastIndexOf('<', start);
  if (lt < 0 || lt < start - 120) return false;
  const gt = text.indexOf('>', end);
  if (gt < 0 || gt > end + 120) return false;
  const inner = text.slice(lt + 1, gt);
  return inner.includes('@');
}

function isInsideEmail(text, start, end) {
  const charBefore = start > 0 ? text[start - 1] : '';
  const charAfter = end < text.length ? text[end] : '';

  if (charBefore === '@' || charAfter === '@') return true;
  if (isInsideAngleEmail(text, start, end)) return true;

  let left = start;
  while (left > 0 && /[\w.+-]/.test(text[left - 1])) left--;
  if (left > 0 && text[left - 1] === '@') {
    left--;
    while (left > 0 && /[\w.+-]/.test(text[left - 1])) left--;
  }

  let right = end;
  while (right < text.length && /[\w.+-]/.test(text[right])) right++;
  if (right < text.length && text[right] === '@') {
    right++;
    while (right < text.length && /[\w.+-]/.test(text[right])) right++;
  }

  const token = text.slice(left, right);
  if (!token.includes('@')) return false;

  if (/^@[\w.+-]+@[\w.-]+\.[\w.-]+/.test(token)) return true;
  if (/^[\w.+-]+@[\w.-]+\.[\w.-]+/.test(token)) return true;

  return false;
}

/** 'Nombre visible' <correo@dominio> — encabezado Para/CC, no referencia real */
function isInsideQuotedDisplayName(text, start, end) {
  const scanStart = Math.max(0, start - 140);
  const scanEnd = Math.min(text.length, end + 100);
  const chunk = text.slice(scanStart, scanEnd);
  const re = /(['"])([^'"]*)\1\s*<[^>]*@[^>]+>/g;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    const nameStart = scanStart + m.index + m[1].length;
    const nameEnd = nameStart + m[2].length;
    if (start >= nameStart && end <= nameEnd) return true;
  }
  return false;
}

/** Etiquetas conocidas de buzón en encabezados (ZTRACK TELEMETRY, telemetria zgroup) */
function isKnownHeaderLabel(text, start, end) {
  const winStart = Math.max(0, start - 30);
  const winEnd = Math.min(text.length, end + 50);
  const window = text.slice(winStart, winEnd);
  for (const pat of HEADER_LABEL_BLOCKLIST) {
    const m = pat.exec(window);
    if (!m) continue;
    const absStart = winStart + m.index;
    const absEnd = absStart + m[0].length;
    if (start >= absStart && end <= absEnd) return true;
  }
  return false;
}

/** Bloque tipo lista de destinatarios: varios @ y <…>; en la misma ventana */
function isInRecipientListBlock(text, start, end) {
  const winStart = Math.max(0, start - 180);
  const winEnd = Math.min(text.length, end + 180);
  const window = text.slice(winStart, winEnd);

  const hasAngleEmail = /<[^>]*@[^>]+>/.test(window);
  const hasBareEmail = /[\w.+-]+@[\w.-]+\.\w+/.test(window);
  if (!hasAngleEmail && !hasBareEmail) return false;

  const atCount = (window.match(/@/g) || []).length;
  const semiCount = (window.match(/;/g) || []).length;
  const gtSemi = (window.match(/>\s*;/g) || []).length;

  if (atCount >= 2 && (semiCount >= 1 || gtSemi >= 1)) {
    if (isInsideQuotedDisplayName(text, start, end)) return true;
    if (isKnownHeaderLabel(text, start, end)) return true;
    if (isInsideEmail(text, start, end)) return true;
    if (hasAngleEmail && (semiCount >= 1 || window.includes("'") || window.includes('"'))) {
      return true;
    }
  }
  return false;
}

function isInvalidMatchContext(text, start, end) {
  return isInsideEmail(text, start, end)
    || isInsideQuotedDisplayName(text, start, end)
    || isKnownHeaderLabel(text, start, end)
    || isInRecipientListBlock(text, start, end);
}

function isSentByMonitor(fromAddress, labelIds) {
  const from = String(fromAddress || '').toLowerCase();
  if (from.includes(monitor)) return true;
  if (Array.isArray(labelIds) && labelIds.includes('SENT')) return true;
  return false;
}

function findStandaloneKeyword(haystack, keywords) {
  const candidates = [];

  for (const kw of keywords) {
    const re = new RegExp(`\\b${escapeRe(kw)}\\b`, 'gi');
    let m;
    while ((m = re.exec(haystack)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (isInvalidMatchContext(haystack, start, end)) continue;
      candidates.push({
        position: start,
        matched: m[0],
        keyword: kw
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.position - b.position);
  return candidates[0];
}

const out = [];

for (const item of $input.all()) {
  const m = item.json;

  if (receivedOnly && isSentByMonitor(m.from_address, m.label_ids)) {
    continue;
  }

  if (keywordEnabled) {
    const haystack = buildHaystack(m.subject, m.body_text, m.snippet);
    const tel = findStandaloneKeyword(haystack, telemetriaVariants);
    if (!tel) continue;
    const person = findStandaloneKeyword(haystack, personKws);
    if (!person) continue;

    m.match_telemetria_pos = tel.position;
    m.match_telemetria_keyword = tel.matched;
    m.match_telemetria_excerpt = excerptAround(haystack, tel.position, excerptRadius);
    m.match_person_pos = person.position;
    m.match_person_keyword = person.matched;
    m.match_person_excerpt = excerptAround(haystack, person.position, excerptRadius);
    m.match_in_field = fieldAtPosition(m.subject, m.body_text, m.snippet, tel.position);
  }

  out.push({ json: m });
}

const mode = String(cfg.mode || '').toLowerCase();
const inputCount = $input.all().length;

// Histórico: correos leídos pero ningún match → cerrar día igual (cierra loop Split)
if (!out.length && mode === 'historical' && inputCount > 0) {
  return [{
    json: {
      _cerrarDiaHistorico: true,
      emailsProcessed: inputCount
    }
  }];
}

return out;
