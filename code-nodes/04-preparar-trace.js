// ── Preparar insert email_trace (sin campos auxiliares) ─────────────────────
const out = [];
for (const item of $input.all()) {
  const { attachments, label_ids, ...row } = item.json;
  out.push({
    json: {
      ...row,
      trace_status: row.trace_status || 'active'
    }
  });
}
return out;
