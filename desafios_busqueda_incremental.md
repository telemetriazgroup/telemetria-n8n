# Modos de búsqueda e incremental — telemetria-n8n

Guía de **cuándo** busca Gmail el workflow, **cómo reinicia** la secuencia, adjuntos
PDF vs imágenes, y campos de **posición** de keywords.

Relacionado: [fase_1.md](./fase_1.md) · [fase_2.md](./fase_2.md) ·
[desafios_procesamiento_incremental.md](./desafios_procesamiento_incremental.md)

---

## Dos flujos independientes

| Flujo | `mode` | Checkpoint | IDs ya conocidos |
|-------|--------|------------|------------------|
| **Hoy (cron / normal)** | `incremental` | Solo `review_mode = 'incremental'` del **mismo día** | Solo los guardados hoy en incremental |
| **Días anteriores (manual)** | `range` | **No usa** la última revisión del 27 | Solo los del rango `startDate`–`endDate` con `review_mode = 'range'` |

Buscar el **20–26 de junio** mientras ya corriste el **27** ya no se bloquea: el modo
`range` ignora el checkpoint del día actual.

### Flujo normal del día (automático)

```
mode = incremental
```

Deja el cron cada 30 min. Cada ejecución avanza `search_after → search_before` solo
para **hoy**.

### Flujo histórico (manual)

Antes de ejecutar, cambia **Configuración**:

```
mode = range
startDate = 2026-06-20
endDate = 2026-06-26
```

Ejecuta el workflow **una vez**. Luego vuelve a `mode = incremental` para el cron.

Los correos guardados llevan `review_mode = 'range'` y no interfieren con el
incremental del 27.

### Verificar qué se buscó

```sql
SELECT review_mode, search_after, search_before, COUNT(*)
FROM email_trace
GROUP BY review_mode, search_after, search_before
ORDER BY MAX(reviewed_at) DESC;
```

---

## Bug corregido: range no avanzaba

**Construir consulta Gmail** leía `$input` (salida de Postgres) en lugar de
**Configuración**. Aunque pusieras `mode = range`, seguía en incremental usando el
checkpoint del 27.

Ahora lee siempre `$('Configuración').first().json` y **Obtener última revisión** solo
considera filas `review_mode = 'incremental'`.

---

| Modo | Comportamiento |
|------|----------------|
| **`incremental`** (default) | Primera ejecución del día: desde **00:00 Lima** hasta **ahora**. Siguientes: desde la **`search_before` de la última ejecución** hasta **ahora**. |
| **`today`** | Todo el día local (`after:inicio_día before:fin_día`). |
| **`range`** | Rango fijo: `startDate` + `endDate` (`YYYY-MM-DD`). |

### Ejemplo incremental

| Hora ejecución | Ventana Gmail |
|----------------|---------------|
| Hoy 13:15 (1.ª vez) | 00:00 → 13:15 |
| Hoy 13:45 (2.ª vez) | 13:15 → 13:45 |
| Mañana 09:00 (1.ª del día) | 00:00 → 09:00 |

Cada fila guardada incluye:

- `search_after` — inicio de la ventana
- `search_before` — fin (hora de esa ejecución)
- `search_query` — query Gmail completa

La siguiente ejecución **incremental** lee `MAX(search_before)` solo de filas
`review_mode = 'incremental'` (nodo **Obtener última revisión**). El modo **range**
no usa ese checkpoint.

### Modo rango (histórico)

En **Configuración**:

```
mode = range
startDate = 2026-06-01
endDate = 2026-06-26
```

---

## Adjuntos: solo PDF (no imágenes de firma)

Las firmas HTML traen decenas de `image001.png`, `image003.jpg`, etc. El workflow:

1. **Leer Gmail** → `Download Attachments = OFF` (no carga binarios de firma).
2. **Normalizar** → solo referencias **PDF** (`application/pdf` o `.pdf`).
3. **`has_attachments`** = true solo si hay PDF.

Imágenes embebidas **no** se guardan en `email_attachment_ref`.

---

## Cuerpo del correo: solo texto

**Normalizar** limpia:

- HTML / tags
- Marcadores `[image:…]`, `image001.png`, etc.
- Conserva texto y citas de respuestas (líneas `>` / bloques reenviados)

---

## Criterio apto para guardar (case-insensitive)

Debe cumplir **las dos** condiciones en asunto + cuerpo + snippet:

1. **Telemetría** — coincide `telemetria`, `telemtria` o `telemetrai` (may/min indiferente).
2. **Persona** — palabra completa `Luis` **o** `Eusebio` (may/min indiferente).

Si pasa, se guardan en Postgres:

| Columna | Significado |
|---------|-------------|
| `match_telemetria_pos` | Índice de carácter donde empezó la coincidencia de telemetría |
| `match_person_pos` | Índice donde empezó Luis/Eusebio |
| `match_person_keyword` | Texto exacto encontrado (ej. `Luis`, `EUSEBIO`) |

Consulta de control:

```sql
SELECT subject, search_after, search_before,
       match_telemetria_pos, match_person_pos, match_person_keyword
FROM email_trace
ORDER BY reviewed_at DESC
LIMIT 10;
```

---

## Migración BD (columnas nuevas)

Si la tabla ya existía:

```bash
psql -h postgres-telemetria -U telemetria_app -d telemetria \
  -f infra/postgres/03-email-trace-search-match.sql
```

---

## Reiniciar secuencia desde cero

Para volver a procesar como “primera ejecución del día”:

```sql
-- Opción A: borrar trazas del día
DELETE FROM email_trace WHERE reviewed_at::date = CURRENT_DATE;

-- Opción B: borrar todo (cuidado)
TRUNCATE email_trace, email_attachment_ref RESTART IDENTITY;
```

La próxima ejecución incremental usará inicio del día como `search_after`.

---

## Nodos nuevos / actualizados

```
Configuración
  → Obtener última revisión   (siempre 1 fila desde BD)
  → Construir consulta Gmail
  → … → Normalizar → Filtrar recibidos relevantes → Guardar
```

Archivos: `code-nodes/00-obtener-ultima-revision.sql`, `01-construir-consulta.js`,
`02-normalizar.js`, `07-filtrar-recibidos-relevantes.js`.
