// ── Normalizar correo (SOLO texto + REFERENCIAS de adjuntos) ────────────────
// Requiere que el nodo Gmail use "Simplify = OFF" para recibir el payload
// completo (con payload.headers y payload.parts).
//
// Produce, por cada correo, un item con:
//   • claves = columnas de email_trace (solo texto)
//   • attachments[] = referencias de adjuntos (sin binarios) para el siguiente nodo
//
// Los binarios NUNCA se descargan ni almacenan. De cada adjunto se guarda
// filename + attachmentId + enlace al correo, para ubicarlo luego en Gmail.

const qinfo = $('Construir consulta Gmail').first().json;
const out = [];

function headerVal(payload, name) {
  if (!payload || !Array.isArray(payload.headers)) return '';
  const h = payload.headers.find(x => (x.name || '').toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
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
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

for (const item of $input.all()) {
  const m = item.json;
  const payload = m.payload || {};

  let textPlain = '';
  let textHtml = '';
  const attachments = [];

  function walk(part) {
    if (!part) return;
    const mime = part.mimeType || '';
    const filename = part.filename || '';

    if (filename && filename.length > 0) {
      // Adjunto -> SOLO referencia (sin binario)
      attachments.push({
        filename,
        mime_type: mime,
        size_bytes: (part.body && part.body.size) || 0,
        attachment_id: (part.body && part.body.attachmentId) || ''
      });
    } else if (mime === 'text/plain' && part.body && part.body.data) {
      textPlain += decodeB64Url(part.body.data);
    } else if (mime === 'text/html' && part.body && part.body.data) {
      textHtml += decodeB64Url(part.body.data);
    }
    if (Array.isArray(part.parts)) part.parts.forEach(walk);
  }
  walk(payload);

  let bodyText = textPlain.trim();
  if (!bodyText && textHtml) bodyText = stripHtml(textHtml);
  if (!bodyText) bodyText = m.snippet || '';

  // Fecha: preferir internalDate (epoch ms); si no, header Date
  let emailDateIso = null;
  if (m.internalDate) {
    const d = new Date(Number(m.internalDate));
    if (!isNaN(d.getTime())) emailDateIso = d.toISOString();
  }
  if (!emailDateIso) {
    const d = new Date(headerVal(payload, 'Date'));
    if (!isNaN(d.getTime())) emailDateIso = d.toISOString();
  }

  const messageId = m.id;
  const gmailLink = `https://mail.google.com/mail/u/0/#all/${messageId}`;

  out.push({
    json: {
      // ── columnas de email_trace ──
      message_id:      messageId,
      thread_id:       m.threadId,
      from_address:    headerVal(payload, 'From'),
      to_addresses:    headerVal(payload, 'To'),
      cc_addresses:    headerVal(payload, 'Cc'),
      subject:         headerVal(payload, 'Subject'),
      email_date:      emailDateIso,
      body_text:       bodyText,
      snippet:         m.snippet || '',
      has_attachments: attachments.length > 0,
      gmail_link:      gmailLink,
      search_query:    qinfo.gmailQuery,
      review_mode:     qinfo.reviewMode,
      // ── auxiliar para "Expandir adjuntos" (lo ignora el insert de trazabilidad) ──
      attachments
    }
  });
}

return out;
