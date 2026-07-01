// ── Cortar rama si no hay correos nuevos que procesar ───────────────────────
// Evita llamar a Gmail Get / Normalizar cuando Filtrar solo nuevos devolvió
// un marcador _empty.

const out = [];
for (const item of $input.all()) {
  if (item.json && item.json._empty) continue;
  if (!item.json || !item.json.id) continue;
  out.push(item);
}
return out;
