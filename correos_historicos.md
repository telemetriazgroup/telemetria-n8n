# Correos históricos — procesamiento día a día

Procedimiento para cargar correos de un **rango de fechas pasadas** en PostgreSQL,
registrando qué días ya se analizaron para **no repetir** trabajo en ejecuciones
posteriores.

---

## Objetivo

| Problema | Solución |
|----------|----------|
| Búsqueda por rango no trae todos los correos | Procesar **un día calendario a la vez** |
| Re-ejecutar el mismo rango reprocesa todo | Tabla `email_history_day` marca días completados |
| No hay trazabilidad del barrido | Por día: conteos + IDs listados, procesados y con match |

---

## Modos del workflow

| Modo | Uso |
|------|-----|
| `incremental` | Cron: solo **hoy**, avanza cada 30 min |
| `range` | Legacy: todo el rango en **una** consulta Gmail (no recomendado) |
| **`historical`** | Rango día a día con registro en `email_history_day` |

---

## Tabla `email_history_day`

Una fila por **día calendario analizado** (`analyzed_date` UNIQUE).

| Columna | Descripción |
|---------|-------------|
| `analyzed_date` | Día procesado (ej. `2025-12-01`) |
| `range_start` / `range_end` | Rango solicitado en esa ejecución |
| `gmail_query` | Consulta Gmail usada ese día |
| `emails_listed_count` | IDs devueltos por Gmail `messages.list` |
| `emails_processed_count` | Correos leídos y normalizados |
| `emails_match_count` | Correos que pasaron filtro telemetría + Luis/Eusebio |
| `message_ids_listed` | JSON array de IDs listados |
| `message_ids_processed` | JSON array de IDs leídos |
| `message_ids_match` | JSON array de IDs con match (van a `email_trace`) |
| `status` | `completed` \| `partial` \| `failed` |
| `analyzed_at` | Timestamp del cierre del día |

Migración:

```bash
docker exec -i postgres-telemetria psql -U telemetria_app -d telemetria \
  < infra/postgres/05-email-history-day.sql
```

---

## Flujo (modo `historical`)

```
Histórico manual → Config histórico (startDate, endDate, mode=historical)
  → Obtener días analizados (email_history_day; si vacío → 1 fila null)
  → Impulsar planificación (siempre 1 item → continúa el flujo)
  → Planificar días pendientes (1 día pendiente por vuelta; 0 previos = empieza en startDate)
  → ¿Hay días pendientes?
       → Construir consulta Gmail (solo ESE día, sin filtro keywords en API)
       → Listar IDs Gmail → Filtrar solo nuevos
       → Leer → Normalizar → Filtrar recibidos relevantes
       → Guardar email_trace (solo matches) + adjuntos PDF
       → Registrar día histórico → Guardar resumen día
       → Obtener días analizados (siguiente día del rango)
```

### Diferencia clave vs `range`

- **`historical`**: Gmail lista **todos** los recibidos del día (`after:`/`before:` + `-in:sent`).
  El filtro telemetría + Luis/Eusebio se aplica **después**, en el nodo Code.
- **`range`**: una sola ventana grande; Gmail pre-filtra por keywords y puede omitir correos.

---

## Ejemplo: 2025-12-01 → 2025-12-26

### Primera ejecución

1. Edita **Config histórico**:
   ```
   mode      = historical
   startDate = 2025-12-01
   endDate   = 2025-12-26
   ```
2. Ejecuta desde **Histórico manual**.
3. El workflow procesa secuencialmente:
   - `2025-12-01` → guarda resumen + matches en `email_trace`
   - `2025-12-02` → …
   - hasta `2025-12-26`

Consulta de progreso:

```sql
SELECT analyzed_date,
       emails_listed_count,
       emails_processed_count,
       emails_match_count,
       analyzed_at
FROM email_history_day
WHERE range_start = '2025-12-01' AND range_end = '2025-12-26'
ORDER BY analyzed_date;
```

Ver IDs con match de un día:

```sql
SELECT analyzed_date,
       jsonb_array_length(message_ids_match) AS n_match,
       message_ids_match
FROM email_history_day
WHERE analyzed_date = '2025-12-15';
```

### Segunda ejecución: 2025-12-20 → 2025-12-30

1. Cambia **Config histórico**:
   ```
   startDate = 2025-12-20
   endDate   = 2025-12-30
   ```
2. **Planificar días pendientes** consulta `email_history_day` y **omite** días ya
   `completed`:
   - Salta `2025-12-20` … `2025-12-26` (ya analizados)
   - Solo procesa `2025-12-27`, `2025-12-28`, `2025-12-29`, `2025-12-30`

Los correos de días pasados **no incrementan** en Gmail; no hace falta volver a
buscarlos.

---

## Configuración en n8n

### Opción A — Trigger dedicado (recomendado)

1. Reimporta `workflow_ok.json`.
2. Nodo **Config histórico**: ajusta `startDate` y `endDate`.
3. Ejecuta **Histórico manual**.

### Opción B — Mismo nodo Configuración

1. En **Configuración** pon `mode = historical` y las fechas.
2. Ejecuta manualmente (no uses el cron con `historical`).

---

## Día sin correos

Si un día no tiene mensajes en Gmail:

- Se registra igual en `email_history_day` con conteos en **0**.
- El día queda marcado `completed` y no se reintenta.

### El flujo no avanza al siguiente día / no vuelve a Construir consulta Gmail

**Causa anterior:** Split In Batches exigía cerrar el loop manualmente y fallaba si
no llegaba a **Registrar día histórico**.

**Solución actual:** sin Split. Tras **Guardar resumen día** el flujo vuelve a
**Obtener días analizados** → **Planificar días pendientes** (solo el primer día
que falta) → **Construir consulta Gmail** con el nuevo `processDate`.

Ciclo esperado:

```
Planificar → Construir consulta → … → Registrar día histórico → Guardar resumen día
  → Obtener días analizados → Planificar (siguiente día) → Construir consulta → …
```

Casos que deben cerrar el día igual (para que el loop continúe):

| Caso | Comportamiento |
|------|----------------|
| Día con correos pero **sin match** | Item `_cerrarDiaHistorico` → Registrar |
| Match **sin PDF** | Guardar trazabilidad → Registrar |
| Día sin correos | ¿Día vacío histórico? → Registrar |

---

Si `email_history_day` está vacía, **Obtener días analizados** devuelve una fila
con `analyzed_date = null` (no corta el flujo). **Planificar días pendientes**
interpreta eso como *ningún día previo* y encola **todo el rango**.

En n8n, activa también **Settings → Always Output Data** en **Obtener días analizados**
por si la tabla no existe aún (error SQL).

---

## Límites

| Límite | Valor | Nota |
|--------|-------|------|
| `maxResults` Gmail list | 500 / día | Si un día supera 500, ampliar paginación (futuro) |
| Tiempo de ejecución | Variable | Rango largo = muchos días; ejecutar en horario valle |
| `email_trace` | Solo matches | Correos sin match solo aparecen en `message_ids_processed` |

---

## Consultas útiles

```sql
-- Días pendientes en un rango (manual)
SELECT d::date AS dia
FROM generate_series('2025-12-20'::date, '2025-12-30'::date, '1 day') AS d
WHERE d::date NOT IN (
  SELECT analyzed_date FROM email_history_day WHERE status = 'completed'
);

-- Resumen global
SELECT COUNT(*) AS dias_analizados,
       SUM(emails_match_count) AS total_matches
FROM email_history_day
WHERE status = 'completed';

-- Matches guardados de un rango histórico
SELECT et.subject, et.email_date, et.match_telemetria_excerpt, et.match_person_excerpt
FROM email_trace et
WHERE et.review_mode = 'historical'
  AND et.search_after::date >= '2025-12-01'
  AND et.search_after::date <= '2025-12-26'
ORDER BY et.email_date;
```

---

## Reinicio / reprocesar un día

Para **forzar** re-análisis de un día:

```sql
DELETE FROM email_history_day WHERE analyzed_date = '2025-12-15';
DELETE FROM email_trace
WHERE review_mode = 'historical'
  AND search_after::date = '2025-12-15';
```

Luego vuelve a ejecutar el workflow con un rango que incluya ese día.

Reinicio total: `infra/postgres/00-reset-telemetria-schema.sql`

---

## Archivos relacionados

| Archivo | Rol |
|---------|-----|
| `code-nodes/09-planificar-dias-historicos.js` | Calcula días pendientes |
| `code-nodes/01-construir-consulta.js` | Query Gmail por día |
| `code-nodes/10-registrar-dia-historico.js` | Consolida conteos e IDs |
| `infra/postgres/05-email-history-day.sql` | Migración tabla resumen |
| `workflow_ok.json` | Workflow con rama historical |

---

## Checklist

- [ ] Migración `05-email-history-day.sql` aplicada
- [ ] `workflow_ok.json` reimportado y credenciales asignadas
- [ ] `Config histórico` con fechas correctas
- [ ] Primera ejecución: filas en `email_history_day` por cada día
- [ ] Segunda ejecución solapada: solo días nuevos se procesan
