# Fase 1 — Lectura de Gmail y anti-duplicados

**Objetivo:** que n8n lea correos de Gmail (nuevos y respuestas en hilos), extraiga
campos base en texto plano, y los persista en PostgreSQL **sin duplicar** al
reejecutar el flujo.

**Prerrequisitos:** [fase_0.md](./fase_0.md) completada (n8n, Postgres, Gmail OAuth2).

**Entregables de esta fase:** tablas `email_trace` y `email_attachment_ref`,
workflow importado y operativo, trazabilidad verificable en BD.

**Siguiente fase:** [fase_2.md](./fase_2.md)

---

## Paso 1 — Crear el esquema en PostgreSQL

Desde el servidor o tu máquina con acceso a Postgres:

```bash
psql -h <host> -U telemetria_app -d telemetria -f schema.sql
```

El archivo `schema.sql` define:

- **`email_trace`** — un registro por correo (solo texto).
- **`email_attachment_ref`** — referencias de adjuntos (sin binarios).

### Verificación

```sql
\dt
-- Deben aparecer email_trace y email_attachment_ref

SELECT indexname FROM pg_indexes WHERE tablename = 'email_trace';
-- Debe existir restricción UNIQUE en message_id
```

---

## Paso 2 — Importar el workflow

1. En n8n: **Workflows → Import from File**
2. Selecciona `workflow.json` del repositorio.
3. El workflow se llama **Telemetria - Trazabilidad de correos (base)**.

Si algún parámetro no se importa bien en tu versión de n8n, recrea los nodos
manualmente usando el código de `code-nodes/` como fuente de verdad.

---

## Paso 3 — Asignar credenciales

Los nodos vienen con placeholder `REEMPLAZAR`. Asigna:

| Nodo | Credencial |
|------|------------|
| **Leer Gmail** | Gmail OAuth2 (de F0) |
| **Guardar trazabilidad** | Postgres `telemetria` |
| **Guardar referencia adjuntos** | Postgres `telemetria` |

---

## Paso 4 — Configurar el nodo Gmail

En **Leer Gmail** confirma:

| Parámetro | Valor | Motivo |
|-----------|-------|--------|
| **Simplify** | **OFF** | Necesita `payload.headers` y `payload.parts` |
| **Download Attachments** | **OFF** | No almacenamos binarios |
| **Return All** | ON (si disponible) | Traer todos los del rango |
| **Query** | `={{ $json.gmailQuery }}` | Viene del nodo anterior |

---

## Paso 5 — Configurar nodos Postgres

En **Guardar trazabilidad** y **Guardar referencia adjuntos**:

| Parámetro | Valor |
|-----------|-------|
| Operation | **Insert** |
| Mapping | **Auto-map Input Data to Columns** |
| On conflict | **Skip** (Skip on conflict) |

El anti-duplicados lo garantizan:

- `email_trace.message_id` → `UNIQUE`
- `email_attachment_ref` → `UNIQUE (message_id, attachment_id, filename)`

---

## Paso 6 — Configurar revisión (hoy vs rango)

En el nodo **Configuración**:

**Modo hoy (por defecto):**

```
mode = today
tzOffsetHours = -5
keywordFilterEnabled = false
```

**Modo rango (carga histórica o recuperación):**

```
mode = range
startDate = 2026-06-01
endDate = 2026-06-26
tzOffsetHours = -5
```

El nodo **Construir consulta Gmail** traduce fechas a `after:<epoch> before:<epoch>`
en segundos, evitando desfases por UTC del contenedor.

---

## Paso 7 — Flujo de datos (referencia)

```
Programar revisión (cron 30 min)
      → Configuración
      → Construir consulta Gmail
      → Leer Gmail (Get Many)
      → Normalizar correo
           ├─► Guardar trazabilidad (email_trace)
           └─► Expandir adjuntos → Guardar referencia adjuntos
```

### Qué produce **Normalizar correo**

Por cada correo, campos alineados con `email_trace`:

- `message_id`, `thread_id`, `from_address`, `to_addresses`, `cc_addresses`
- `subject`, `email_date`, `body_text` (texto plano, sin HTML)
- `snippet`, `has_attachments`, `gmail_link`
- `search_query`, `review_mode`
- `attachments[]` (auxiliar, no se inserta en `email_trace`)

---

## Paso 8 — Pruebas de validación

### 8.1 Correo nuevo

1. Envía un correo de prueba a la cuenta monitoreada.
2. Ejecuta el workflow manualmente (o espera el cron).
3. Consulta:

```sql
SELECT message_id, thread_id, subject, from_address, reviewed_at
FROM email_trace
ORDER BY reviewed_at DESC
LIMIT 5;
```

### 8.2 Respuesta en un hilo

1. Responde al correo de prueba (mismo hilo).
2. Reejecuta el workflow.
3. Verifica que el nuevo mensaje tiene el **mismo `thread_id`** pero distinto
   `message_id`:

```sql
SELECT message_id, thread_id, subject, email_date
FROM email_trace
WHERE thread_id = '<thread_id>'
ORDER BY email_date;
```

### 8.3 Anti-duplicados

1. Ejecuta el workflow **dos veces seguidas** sin correos nuevos.
2. El conteo de filas no debe aumentar:

```sql
SELECT COUNT(*) FROM email_trace;
```

### 8.4 Adjuntos (solo referencia)

1. Envía un correo con un PDF adjunto.
2. Verifica:

```sql
SELECT filename, mime_type, attachment_id, gmail_link
FROM email_attachment_ref
ORDER BY created_at DESC
LIMIT 5;
```

Abre `gmail_link` en el navegador: debe llevarte al correo con el adjunto visible.

---

## Paso 9 — Consultas útiles

```sql
-- Correos revisados recientemente
SELECT subject, from_address, email_date, gmail_link
FROM email_trace
ORDER BY reviewed_at DESC;

-- Adjuntos de un hilo
SELECT filename, mime_type, gmail_link
FROM email_attachment_ref
WHERE thread_id = '<thread_id>';

-- Buscar adjunto por nombre
SELECT filename, gmail_link
FROM email_attachment_ref
WHERE filename ILIKE '%reporte%';
```

---

## Diferencias respecto al plan completo

| Aspecto | Esta implementación (F1) | Evolución posterior |
|---------|--------------------------|---------------------|
| Disparo | Cron + búsqueda por fecha | Gmail Trigger en tiempo real (opcional, F8) |
| Esquema | `email_trace` simplificado | Tablas `threads` / `messages` en F4 |
| Enlace Gmail | `#all/<messageId>` | Puede unificarse a `#inbox/<threadId>` en F3 |

Estas diferencias no bloquean las fases siguientes.

---

## Checklist de cierre F1

- [ ] `schema.sql` aplicado sin errores
- [ ] Workflow importado y credenciales asignadas
- [ ] Correo nuevo aparece en `email_trace`
- [ ] Respuesta en hilo comparte `thread_id`
- [ ] Reejecutar no duplica registros
- [ ] Adjuntos solo como referencia en `email_attachment_ref`

**Siguiente:** [fase_2.md](./fase_2.md) — activar y afinar filtro por keywords.
