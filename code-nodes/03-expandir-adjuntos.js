// ── Expandir adjuntos (una fila por referencia de adjunto) ──────────────────
// Toma la salida del normalizador y emite un item por cada adjunto, con las
// claves = columnas de email_attachment_ref. Si el correo no tiene adjuntos,
// no emite nada para ese correo.

const out = [];

for (const item of $input.all()) {
  const m = item.json;
  const atts = Array.isArray(m.attachments) ? m.attachments : [];
  for (const a of atts) {
    out.push({
      json: {
        message_id:    m.message_id,
        thread_id:     m.thread_id,
        filename:      a.filename || '',
        mime_type:     a.mime_type || '',
        size_bytes:    a.size_bytes || 0,
        attachment_id: a.attachment_id || '',
        gmail_link:    m.gmail_link
      }
    });
  }
}

return out;
