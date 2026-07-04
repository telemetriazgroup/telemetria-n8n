// ── Preparar insert email_trace (solo columnas válidas de la tabla) ─────────

const TRACE_COLUMNS = [
  'message_id',
  'thread_id',
  'from_address',
  'to_addresses',
  'cc_addresses',
  'subject',
  'email_date',
  'body_text',
  'snippet',
  'has_attachments',
  'gmail_link',
  'search_query',
  'search_after',
  'search_before',
  'review_mode',
  'match_telemetria_pos',
  'match_person_pos',
  'match_person_keyword',
  'match_telemetria_keyword',
  'match_telemetria_excerpt',
  'match_person_excerpt',
  'match_in_field',
  'trace_status',
];

const out = [];
for (const item of $input.all()) {
  const src = item.json || {};
  if (!src.message_id) continue;

  const row = {};
  for (const col of TRACE_COLUMNS) {
    if (src[col] !== undefined && src[col] !== null) {
      row[col] = src[col];
    }
  }
  row.message_id = src.message_id;
  row.thread_id = src.thread_id || src.message_id;
  row.trace_status = row.trace_status || 'active';
  row.review_mode = row.review_mode || 'historical';
  row.has_attachments = Boolean(row.has_attachments);

  out.push({ json: row });
}

return out;
