// ── Passthrough tras consulta BD (BD vacía = buscar desde cero) ─────────────
// NOTA: No usar en cadena DESPUÉS de Postgres si la query devuelve 0 filas:
// n8n no ejecuta el siguiente nodo sin items de entrada.
//
// Solución en workflow: ramas paralelas desde Construir consulta Gmail:
//   • Construir → Obtener IDs en BD (rama lateral, puede devolver 0 items)
//   • Construir → Listar IDs Gmail → … (flujo principal)
// Filtrar solo nuevos lee $('Obtener IDs en BD').all() → [] si BD vacía = todos nuevos.

const qinfo = $('Construir consulta Gmail').first().json;
const rows = $input.all();

const knownIds = rows
  .map(i => i.json && i.json.message_id)
  .filter(Boolean);

return [{
  json: {
    ...qinfo,
    knownIds,
    knownCount: knownIds.length,
    bdEmpty: knownIds.length === 0
  }
}];
