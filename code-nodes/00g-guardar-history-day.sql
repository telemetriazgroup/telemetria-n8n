-- Upsert resumen diario (modo historical)
-- Entrada: salida del nodo "Registrar día histórico"

INSERT INTO email_history_day (
    analyzed_date,
    range_start,
    range_end,
    gmail_query,
    emails_listed_count,
    emails_processed_count,
    emails_match_count,
    message_ids_listed,
    message_ids_processed,
    message_ids_match,
    status,
    analyzed_at
) VALUES (
    '{{ $json.analyzed_date }}'::date,
    '{{ $json.range_start }}'::date,
    '{{ $json.range_end }}'::date,
    '{{ $json.gmail_query }}',
    {{ $json.emails_listed_count }},
    {{ $json.emails_processed_count }},
    {{ $json.emails_match_count }},
    '{{ JSON.stringify($json.message_ids_listed || []) }}'::jsonb,
    '{{ JSON.stringify($json.message_ids_processed || []) }}'::jsonb,
    '{{ JSON.stringify($json.message_ids_match || []) }}'::jsonb,
    '{{ $json.status }}',
    now()
)
ON CONFLICT (analyzed_date) DO UPDATE SET
    range_start = EXCLUDED.range_start,
    range_end = EXCLUDED.range_end,
    gmail_query = EXCLUDED.gmail_query,
    emails_listed_count = EXCLUDED.emails_listed_count,
    emails_processed_count = EXCLUDED.emails_processed_count,
    emails_match_count = EXCLUDED.emails_match_count,
    message_ids_listed = EXCLUDED.message_ids_listed,
    message_ids_processed = EXCLUDED.message_ids_processed,
    message_ids_match = EXCLUDED.message_ids_match,
    status = EXCLUDED.status,
    analyzed_at = now()
RETURNING analyzed_date::text, emails_listed_count, emails_processed_count, emails_match_count;
