# Fase 1 — Lectura de Gmail y anti-duplicados

**Objetivo:** que n8n lea correos de Gmail (nuevos y respuestas en hilos), extraiga
campos base en texto plano, y los persista en PostgreSQL **sin duplicar** al
reejecutar el flujo.

**Prerrequisitos:** [fase_0.md](./fase_0.md) completada (n8n, Postgres, Gmail OAuth2).

**Entregables de esta fase:** tablas `email_trace` y `email_attachment_ref`,
workflow importado y operativo, trazabilidad verificable en BD.

**Siguiente fase:** [fase_2.md](./fase_2.md)

---

## Paso 1 — Verificar esquema PostgreSQL

Con **Docker Compose** (F0), `schema.sql` ya se aplicó al primer `docker compose up`.
Comprueba en Adminer (`http://161.132.53.51:7901`) o:

```bash
docker exec -it postgres-telemetria psql -U telemetria_app -d telemetria -c '\dt'
```

Deben existir `email_trace` y `email_attachment_ref`.

**Solo si instalaste Postgres manualmente** (sin Docker):

```bash
psql -h <host> -U telemetria_app -d telemetria -f schema.sql
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
| **Leer Gmail** | **Gmail OAuth2 API** (no confundir con Google OAuth2 API) |
| **Guardar trazabilidad** | Postgres `telemetria` |
| **Guardar referencia adjuntos** | Postgres `telemetria` |

### Gmail: tipo correcto de credencial

En n8n existen **dos tipos distintos**:

| Tipo en n8n | ¿Sirve para el nodo Gmail? |
|-------------|---------------------------|
| **Gmail OAuth2 API** | **Sí** — es el que pide **Leer Gmail** |
| Google OAuth2 API | **No** — no aparece en el desplegable del nodo |

Si creaste **Google OAuth2 API** y ves *Account connected* pero el nodo sigue en
*No credentials yet*, crea una credencial nueva:

1. **Credentials → Add credential**
2. Busca **Gmail OAuth2 API** (no "Google OAuth2 API")
3. Mismo Client ID, Client Secret y scope `gmail.readonly`
4. **Connect my account** → Save
5. En **Leer Gmail** → Credential → elige la credencial **Gmail OAuth2**

Puedes reutilizar el mismo Client ID/Secret de Google Cloud; solo cambia el
**tipo** de credencial en n8n.

> Más problemas (ID huérfano, redirect_uri, WebSocket): [desafios_gmail.md](./desafios_gmail.md)  
> Campos vacíos en Normalizar: [desafios_normalizar_correo.md](./desafios_normalizar_correo.md)

---

## Paso 4 — Configurar el nodo Gmail

En **Leer Gmail** confirma:

| Parámetro | Valor | Motivo |
|-----------|-------|--------|
| **Simplify** | **OFF** | n8n devuelve `from`, `to`, `subject`, `text`, `date` (formato parseado). Ver [desafios_normalizar_correo.md](./desafios_normalizar_correo.md) |
| **Leer Gmail** | **Download Attachments = OFF** | Evita cargar imágenes de firma; solo referencias PDF vía metadatos |
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

**Modo incremental (por defecto):**

```
mode = incremental
tzOffsetHours = -5
receivedOnly = true
monitorMailbox = telemetria@zgroup.com.pe
keywordFilterEnabled = true
keywords = ["Luis", "Eusebio"]
telemetriaVariants = ["telemetria", "telemtria", "telemetrai"]
```

- **1.ª ejecución del día (ej. 13:15):** busca correos de **00:00 → 13:15**.
- **Siguiente ciclo (ej. 13:45):** busca **13:15 → 13:45** (lee `search_before` de la última fila en BD).

**Modo rango (histórico manual — días anteriores):**

```
mode = range
startDate = 2026-06-20
endDate = 2026-06-26
tzOffsetHours = -5
```

Tras ejecutar, **vuelve a `mode = incremental`** para el cron del día. Ver
[desafios_busqueda_incremental.md](./desafios_busqueda_incremental.md).

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
      → Obtener última revisión
      → Construir consulta Gmail
           ├─► Obtener IDs en BD (rama lateral; 0 filas = OK)
           └─► Listar IDs Gmail → Filtrar solo nuevos → Omitir si vacío
      → Leer Gmail
      → Normalizar correo
      → Filtrar recibidos relevantes
           ├─► Preparar trazabilidad → Guardar trazabilidad (email_trace)
           └─► Expandir adjuntos → Guardar referencia adjuntos
```

Por qué el volumen crece y cómo evitar reprocesar: [desafios_procesamiento_incremental.md](./desafios_procesamiento_incremental.md).

En **Configuración**, `skipKnownInDb = true` (default) omite correos cuyo
`message_id` ya está en `email_trace` para la misma `search_query`.

El nodo **Preparar trazabilidad** quita el campo auxiliar `attachments[]` antes
del insert (no es columna de `email_trace`). Ver `code-nodes/04-preparar-trace.js`.

### Qué produce **Normalizar correo**

Entrada esperada: salida de **Leer Gmail** con **Simplify OFF** (`from`, `to`,
`subject`, `text`, `date`). Detalle del formato y troubleshooting en
[desafios_normalizar_correo.md](./desafios_normalizar_correo.md).

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

## Solución de problemas — credencial Gmail

| Error | Guía |
|-------|------|
| `Credential with ID "…" does not exist for type "gmailOAuth2"` | [desafios_gmail.md](./desafios_gmail.md) |
| Google OAuth2 vs Gmail OAuth2 API | [desafios_gmail.md](./desafios_gmail.md) |

---

## Solución de problemas — "Lost connection to the server" al ejecutar

Ese mensaje casi siempre indica que **se cortó el WebSocket** entre el navegador y
n8n (`/automatico/rest/push`) o que el **contenedor reinició** durante la ejecución.

### 1. Comprobar WebSocket (ztrack.app)

En el navegador: **F12 → Network → WS**. Debe existir una conexión a:

```
wss://ztrack.app/automatico/rest/push
```

Estado esperado: **101** (conectado). Si ves **404** o se cierra al pulsar Play →
Apache no proxya bien el WebSocket.

**Corrección en ztrack.app** — rutas **en este orden** (ver
`infra/apache-ztrack-automatico.conf`):

```apache
ProxyPass        /automatico/rest/push ws://161.132.53.51:7001/rest/push
ProxyPassReverse /automatico/rest/push ws://161.132.53.51:7001/rest/push

ProxyPass        /automatico/ http://161.132.53.51:7001/
ProxyPassReverse /automatico/ http://161.132.53.51:7001/
```

```bash
sudo apache2ctl configtest && sudo systemctl reload apache2
```

### 2. Comprobar si n8n crashea al ejecutar

En **161.132.53.51**, mientras das Play:

```bash
cd infra
docker compose logs -f n8n-telemetria
```

Si aparece error de memoria, Gmail API o reinicio del contenedor, el fallo no es
solo del proxy.

### 3. Probar un nodo aislado

En el canvas: nodo **Configuración** → **Execute step** (debe OK).  
Luego **Construir consulta Gmail** → Execute step.  
Después **Leer Gmail** → Execute step.

Así ves en qué nodo falla (Gmail, Postgres, etc.).

### 4. Errores frecuentes por nodo

| Síntoma | Causa probable |
|---------|----------------|
| Lost connection + WS OK | Gmail/Postgres tarda mucho; subir `ProxyTimeout 600` |
| WS 404 en `/automatico/rest/push` | Falta `ProxyPass` WebSocket (paso 1) |
| Postgres "connection refused" | Host debe ser `postgres-telemetria`, no `localhost` |
| Gmail "unauthorized" | Credencial **Gmail OAuth2 API**, reconectar cuenta |
| Campos vacíos en Normalizar (`from_address`, `subject`, …) | Normalizador desactualizado; ver [desafios_normalizar_correo.md](./desafios_normalizar_correo.md) |
| **Obtener IDs en BD** “Success” pero **0 items** y flujo parado | Desconectar Postgres → Listar; usar ramas paralelas desde Construir (ver [desafios_procesamiento_incremental.md](./desafios_procesamiento_incremental.md)) |
| `Column 'attachments' does not exist` | Falta nodo **Preparar trazabilidad** antes de Guardar trazabilidad (ver abajo) |

### Error: `Column 'attachments' does not exist in selected table`

**Normalizar correo** incluye `attachments[]` para la rama de adjuntos. El nodo
Postgres con **Auto-map** intenta insertar **todos** los campos, pero `email_trace`
no tiene columna `attachments`.

**Solución en n8n (sin reimportar):**

1. Añade un nodo **Code** entre **Normalizar correo** y **Guardar trazabilidad**.
2. Nómbralo **Preparar trazabilidad**.
3. Pega el código de `code-nodes/04-preparar-trace.js`.
4. Conecta: Normalizar → Preparar trazabilidad → Guardar trazabilidad.
5. Normalizar → Expandir adjuntos (sin cambios).

O reimporta `workflow.json` actualizado del repo.

---

## Checklist de cierre F1

- [ ] `schema.sql` aplicado sin errores
- [ ] Workflow importado y credenciales asignadas
- [ ] Correo nuevo aparece en `email_trace`
- [ ] Respuesta en hilo comparte `thread_id`
- [ ] Reejecutar no duplica registros
- [ ] Adjuntos solo como referencia en `email_attachment_ref`

**Siguiente:** [fase_2.md](./fase_2.md) — activar y afinar filtro por keywords.
