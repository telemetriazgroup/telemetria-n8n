// ── Normalizar correo (SOLO texto + REFERENCIAS de adjuntos) ────────────────
// Entrada típica del nodo Gmail v2 con **Simplify = OFF** (simple: false):
//   parseRawEmail → from/to/cc/subject/date/text/html + headers (objeto)
// Entrada alternativa con **Simplify = ON** (simple: true):
//   simplifyOutput → payload.parts + campos planos From/To/Subject
//
// Produce, por cada correo, un item con:
//   • claves = columnas de email_trace (solo texto)
//   • attachments[] = referencias de adjuntos (sin binarios) para el siguiente nodo
//
// Adjuntos: si Gmail tiene "Download Attachments = ON", lee metadatos de $binary
// (filename, mimeType, size) sin persistir el binario. Si no hay binary, recorre
// payload.parts cuando exista (formato API).

const qinfo = $('Construir consulta Gmail').first().json;
const out = [];

function headerVal(m, name) {
  const payload = m.payload || {};
  if (Array.isArray(payload.headers)) {
    const h = payload.headers.find(x => (x.name || '').toLowerCase() === name.toLowerCase());
    if (h && h.value) return h.value;
  }
  const flat = m[name] || m[name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()];
  if (typeof flat === 'string' && flat.trim()) return flat;

  const hdrs = m.headers;
  if (hdrs && typeof hdrs === 'object' && !Array.isArray(hdrs)) {
    const key = name.toLowerCase();
    const line = hdrs[key];
    if (typeof line === 'string' && line.trim()) {
      const idx = line.indexOf(':');
      return idx >= 0 ? line.slice(idx + 1).trim() : line.trim();
    }
  }
  return '';
}

function addressText(field) {
  if (!field) return '';
  if (typeof field === 'string') return field.trim();
  if (typeof field.text === 'string' && field.text.trim()) return field.text.trim();
  if (Array.isArray(field.value)) {
    return field.value
      .map(v => {
        const addr = (v && v.address) || '';
        const nm = (v && v.name) || '';
        if (nm && addr) return `"${nm}" <${addr}>`;
        return addr || nm;
      })
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

function decodeB64Url(data) {
  if (!data) return '';
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try { return Buffer.from(b64, 'base64').toString('utf-8'); } catch (e) { return ''; }
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<img[\s\S]*?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanBodyText(text) {
  return String(text || '')
    .replace(/\[image:[^\]]*\]/gi, ' ')
    .replace(/\[cid:[^\]]*\]/gi, ' ')
    .replace(/<\s*mailto:[^>]+>/gi, ' ')
    .replace(/\bimage\d{3}\.(png|jpe?g|gif|webp)\b/gi, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPdfAttachment(filename, mime) {
  const fn = String(filename || '').toLowerCase();
  const mt = String(mime || '').toLowerCase();
  return fn.endsWith('.pdf') || mt === 'application/pdf' || mt.includes('pdf');
}

function parseEmailDate(m) {
  const candidates = [m.date, m.internalDate, headerVal(m, 'Date')];
  for (const raw of candidates) {
    if (raw == null || raw === '') continue;
    const d = typeof raw === 'number' || /^\d+$/.test(String(raw))
      ? new Date(Number(raw))
      : new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function attachmentsFromParts(payload) {
  const attachments = [];
  function walk(part) {
    if (!part) return;
    const mime = part.mimeType || '';
    const filename = part.filename || '';
    if (filename && isPdfAttachment(filename, mime)) {
      attachments.push({
        filename,
        mime_type: mime,
        size_bytes: (part.body && part.body.size) || 0,
        attachment_id: (part.body && part.body.attachmentId) || ''
      });
    } else if (mime === 'text/plain' && part.body && part.body.data) {
      // body parts — no attachment
    } else if (mime === 'text/html' && part.body && part.body.data) {
      // body parts — no attachment
    }
    if (Array.isArray(part.parts)) part.parts.forEach(walk);
  }
  walk(payload);
  return attachments;
}

function attachmentsFromBinary(binary) {
  if (!binary || typeof binary !== 'object') return [];
  const attachments = [];
  for (const [key, meta] of Object.entries(binary)) {
    if (!meta || typeof meta !== 'object') continue;
    const filename = meta.fileName || meta.filename || key;
    const mime = meta.mimeType || meta.mime_type || '';
    if (!isPdfAttachment(filename, mime)) continue;
    let sizeBytes = 0;
    if (typeof meta.fileSize === 'string') {
      const n = parseFloat(meta.fileSize.split(/\s+/)[0]);
      if (!isNaN(n)) {
        const unit = (meta.fileSize.split(/\s+/)[1] || '').toUpperCase();
        sizeBytes = unit.startsWith('M') ? Math.round(n * 1024 * 1024)
          : unit.startsWith('G') ? Math.round(n * 1024 * 1024 * 1024)
          : unit.startsWith('K') ? Math.round(n * 1024)
          : Math.round(n);
      }
    }
    attachments.push({
      filename,
      mime_type: meta.mimeType || meta.mime_type || '',
      size_bytes: sizeBytes,
      attachment_id: ''
    });
  }
  return attachments;
}

function bodyTextFromMessage(m) {
  if (typeof m.text === 'string' && m.text.trim()) return m.text.trim();
  if (typeof m.html === 'string' && m.html.trim()) return stripHtml(m.html);

  const payload = m.payload || {};
  let textPlain = '';
  let textHtml = '';
  function walk(part) {
    if (!part) return;
    const mime = part.mimeType || '';
    if (mime === 'text/plain' && part.body && part.body.data) {
      textPlain += decodeB64Url(part.body.data);
    } else if (mime === 'text/html' && part.body && part.body.data) {
      textHtml += decodeB64Url(part.body.data);
    }
    if (Array.isArray(part.parts)) part.parts.forEach(walk);
  }
  walk(payload);
  if (textPlain.trim()) return textPlain.trim();
  if (textHtml.trim()) return stripHtml(textHtml);
  if (typeof m.snippet === 'string' && m.snippet.trim()) return m.snippet.trim();
  return '';
}

for (const item of $input.all()) {
  const m = item.json;
  const payload = m.payload || {};

  let attachments = attachmentsFromParts(payload);
  if (!attachments.length) attachments = attachmentsFromBinary(item.binary);

  let bodyText = cleanBodyText(bodyTextFromMessage(m));
  const snippet = (typeof m.snippet === 'string' && m.snippet.trim())
    ? m.snippet.trim()
    : bodyText.slice(0, 200);

  const messageId = m.id;
  const gmailLink = `https://mail.google.com/mail/u/0/#all/${messageId}`;

  out.push({
    json: {
      message_id:      messageId,
      thread_id:       m.threadId,
      from_address:    addressText(m.from) || headerVal(m, 'From'),
      to_addresses:    addressText(m.to) || headerVal(m, 'To'),
      cc_addresses:    addressText(m.cc) || headerVal(m, 'Cc'),
      subject:         (typeof m.subject === 'string' ? m.subject : '') || headerVal(m, 'Subject'),
      email_date:      parseEmailDate(m),
      body_text:       bodyText,
      snippet,
      has_attachments: attachments.length > 0,
      gmail_link:      gmailLink,
      search_query:    qinfo.gmailQuery,
      search_after:    qinfo.afterIso,
      search_before:   qinfo.beforeIso,
      review_mode:     qinfo.reviewMode,
      label_ids:       Array.isArray(m.labelIds) ? m.labelIds : [],
      attachments
    }
  });
}

return out;
