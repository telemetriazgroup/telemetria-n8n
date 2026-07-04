// ── Preparar upsert email_trace (reactiva filas superseded / rellena match) ─

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

function pgStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function pgTs(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `${pgStr(v)}::timestamptz`;
}

function pgInt(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.trunc(n)) : 'NULL';
}

function pgBool(v) {
  return v ? 'true' : 'false';
}

function buildUpsert(row) {
  return `
INSERT INTO email_trace (
  message_id, thread_id, from_address, to_addresses, cc_addresses,
  subject, email_date, body_text, snippet, has_attachments, gmail_link,
  search_query, search_after, search_before, review_mode,
  match_telemetria_pos, match_person_pos, match_person_keyword,
  match_telemetria_keyword, match_telemetria_excerpt, match_person_excerpt,
  match_in_field, trace_status, reviewed_at
) VALUES (
  ${pgStr(row.message_id)},
  ${pgStr(row.thread_id)},
  ${pgStr(row.from_address)},
  ${pgStr(row.to_addresses)},
  ${pgStr(row.cc_addresses)},
  ${pgStr(row.subject)},
  ${pgTs(row.email_date)},
  ${pgStr(row.body_text)},
  ${pgStr(row.snippet)},
  ${pgBool(row.has_attachments)},
  ${pgStr(row.gmail_link)},
  ${pgStr(row.search_query)},
  ${pgTs(row.search_after)},
  ${pgTs(row.search_before)},
  ${pgStr(row.review_mode)},
  ${pgInt(row.match_telemetria_pos)},
  ${pgInt(row.match_person_pos)},
  ${pgStr(row.match_person_keyword)},
  ${pgStr(row.match_telemetria_keyword)},
  ${pgStr(row.match_telemetria_excerpt)},
  ${pgStr(row.match_person_excerpt)},
  ${pgStr(row.match_in_field)},
  'active',
  now()
)
ON CONFLICT (message_id) DO UPDATE SET
  thread_id = EXCLUDED.thread_id,
  from_address = EXCLUDED.from_address,
  to_addresses = EXCLUDED.to_addresses,
  cc_addresses = EXCLUDED.cc_addresses,
  subject = EXCLUDED.subject,
  email_date = EXCLUDED.email_date,
  body_text = EXCLUDED.body_text,
  snippet = EXCLUDED.snippet,
  has_attachments = EXCLUDED.has_attachments,
  gmail_link = EXCLUDED.gmail_link,
  search_query = EXCLUDED.search_query,
  search_after = EXCLUDED.search_after,
  search_before = EXCLUDED.search_before,
  review_mode = EXCLUDED.review_mode,
  match_telemetria_pos = EXCLUDED.match_telemetria_pos,
  match_person_pos = EXCLUDED.match_person_pos,
  match_person_keyword = EXCLUDED.match_person_keyword,
  match_telemetria_keyword = EXCLUDED.match_telemetria_keyword,
  match_telemetria_excerpt = EXCLUDED.match_telemetria_excerpt,
  match_person_excerpt = EXCLUDED.match_person_excerpt,
  match_in_field = EXCLUDED.match_in_field,
  trace_status = 'active',
  reviewed_at = now()
RETURNING message_id;
`.trim();
}

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
  row.thread_id = row.thread_id || src.message_id;
  row.trace_status = 'active';
  row.review_mode = row.review_mode || 'historical';
  row.has_attachments = Boolean(row.has_attachments);

  out.push({ json: { ...row, upsertSql: buildUpsert(row) } });
}

return out;
