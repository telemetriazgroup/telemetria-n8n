// ── Impulsar planificación (tras Obtener días analizados) ───────────────────
// Postgres puede devolver analyzed_date = null (sin días previos).
// Este nodo SIEMPRE emite 1 item para que Planificar se ejecute.

const analyzedDates = [];

for (const item of $input.all()) {
  const raw = item.json?.analyzed_date;
  if (raw == null || raw === 'null' || raw === '') continue;
  const d = String(raw).slice(0, 10);
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) analyzedDates.push(d);
}

return [{
  json: {
    _impulsarPlanificacion: true,
    analyzedDates,
    analyzedCount: analyzedDates.length,
    sinDiasPrevios: analyzedDates.length === 0
  }
}];
