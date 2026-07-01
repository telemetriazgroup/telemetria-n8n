# Desafíos al normalizar correo — campos vacíos en trazabilidad

Guía cuando **Normalizar correo** muestra `from_address`, `subject`, `body_text`,
`email_date`, etc. vacíos, aunque **Leer Gmail** sí trae el contenido del mensaje.

Relacionado: [fase_1.md](./fase_1.md) · [desafios_gmail.md](./desafios_gmail.md) ·
`code-nodes/02-normalizar.js`

---

## Síntoma

Tras **Leer Gmail** (27 items, datos visibles en la salida del nodo), **Normalizar
correo** produce filas con:

| Campo | Valor incorrecto |
|-------|------------------|
| `from_address`, `to_addresses`, `cc_addresses` | `empty` |
| `subject`, `body_text`, `snippet` | `empty` |
| `email_date` | `null` |
| `message_id`, `thread_id`, `gmail_link` | OK (sí se rellenan) |

Al guardar en Postgres, `email_trace` queda sin remitente, asunto ni cuerpo — inútil
para trazabilidad operativa.

---

## Causa raíz

El normalizador original asumía el **formato crudo de la API de Gmail**:

```json
{
  "id": "...",
  "payload": {
    "headers": [ { "name": "From", "value": "..." } ],
    "parts": [ ... ]
  },
  "internalDate": "1719...",
  "snippet": "..."
}
```

Pero el nodo **Gmail v2** de n8n con **Simplify = OFF** (`simple: false`) **no**
devuelve ese formato. Internamente llama a la API con `format=raw`, parsea el MIME con
`mailparser` y expone un JSON **ya interpretado**:

```json
{
  "id": "...",
  "threadId": "...",
  "from": { "text": "remitente@empresa.com", "value": [...] },
  "to": { "text": "...", "value": [...] },
  "subject": "RE: ...",
  "date": "2026-06-27T16:41:53.000Z",
  "text": "cuerpo en texto plano...",
  "html": "<html>...",
  "headers": { "from": "From: ...", "subject": "Subject: ..." }
}
```

No hay `payload.headers` ni `payload.parts` en esa salida. El código buscaba
`headerVal(payload, 'From')` sobre un objeto vacío → **todos los campos de texto
quedaban en blanco**.

> **Nota:** En n8n el nombre del toggle es confuso. **Simplify OFF** = salida
> parseada (from/to/text). **Simplify ON** = salida simplificada de metadatos API
> (headers planos, a veces `payload.parts`). La documentación antigua de F1 lo
> tenía al revés.

Referencia en código fuente n8n (`GmailV2.node.ts`, operación `getAll`):

- `simple: true` → `format=metadata` + `simplifyOutput`
- `simple: false` → `format=raw` + `parseRawEmail`

---

## Solución

### 1. Actualizar el nodo **Normalizar correo**

Copia el contenido de `code-nodes/02-normalizar.js` en el nodo Code de n8n, o
reimporta `workflow.json` y reasigna credenciales.

El normalizador corregido:

1. Lee **from / to / cc** con `addressText()` (objetos mailparser o strings).
2. Lee **subject** desde `m.subject` o cabeceras.
3. Lee **fecha** desde `m.date`, `m.internalDate` o cabecera `Date`.
4. Lee **cuerpo** desde `m.text`, luego `m.html` (sin HTML), luego `payload.parts`
   si existiera.
5. Genera **snippet** desde `m.snippet` o los primeros 200 caracteres del cuerpo.

### 2. Configuración recomendada de **Leer Gmail**

| Parámetro | Valor | Motivo |
|-----------|-------|--------|
| **Simplify** | **OFF** | Salida parseada con `text`, `from`, `subject`, `date` |
| **Download Attachments** | **ON** | Metadatos de adjuntos en `$binary` (no se guardan binarios en Postgres) |
| **Return All** | ON | Traer todos los del rango |
| **Query** | `={{ $json.gmailQuery }}` | Del nodo anterior |

**Download Attachments = ON** no contradice la política de “solo referencias”:

- n8n carga el binario **solo en memoria** durante la ejecución.
- **Normalizar** extrae `filename`, `mimeType`, `size` de `$binary`.
- **Preparar trazabilidad** + Postgres guardan **solo texto y referencias** en
  `email_trace` / `email_attachment_ref`.
- Los binarios **no** se insertan en la base de datos.

Con **Download Attachments = OFF**, n8n descarta la lista de adjuntos del parser;
`has_attachments` quedará en `false` aunque el correo diga “Adjunto…”.

### 3. Mantener **Preparar trazabilidad**

Entre **Normalizar** y **Guardar trazabilidad**, el nodo quita `attachments[]`
(ver `code-nodes/04-preparar-trace.js` y [desafios previos en fase_1.md](./fase_1.md)).

---

## Cómo validar

1. Ejecuta solo **Leer Gmail** → abre un item → confirma que existen `from.text`,
   `subject`, `text` o `date`.
2. Ejecuta **Normalizar correo** → la misma fila debe tener `from_address`,
   `subject`, `body_text`, `email_date` rellenos.
3. En Adminer:

```sql
SELECT message_id, from_address, subject, email_date,
       left(body_text, 80) AS body_preview
FROM email_trace
ORDER BY reviewed_at DESC
LIMIT 5;
```

---

## Mapeo de campos (Leer Gmail → email_trace)

| Salida Gmail (Simplify OFF) | Columna `email_trace` |
|-----------------------------|------------------------|
| `id` | `message_id` |
| `threadId` | `thread_id` |
| `from.text` | `from_address` |
| `to.text` | `to_addresses` |
| `cc.text` | `cc_addresses` |
| `subject` | `subject` |
| `date` (ISO) | `email_date` |
| `text` / `html` (sin tags) | `body_text` |
| primeros 200 chars / `snippet` | `snippet` |
| `$binary` / `payload.parts` | `has_attachments` + `attachments[]` auxiliar |
| (generado) | `gmail_link` |
| nodo Construir consulta | `search_query`, `review_mode` |

---

## Errores relacionados

| Síntoma | Documento |
|---------|-----------|
| Credencial Gmail ID no existe | [desafios_gmail.md](./desafios_gmail.md) |
| `Column 'attachments' does not exist` | [fase_1.md](./fase_1.md) — nodo Preparar trazabilidad |
| Lost connection / WebSocket | [desafios_gmail.md](./desafios_gmail.md) · [fase_0_implicancias.md](./fase_0_implicancias.md) |

---

## Archivo de ejemplo

`Leer_Gmail.json` en el repo es una exportación real de la salida del nodo con
**Simplify OFF**. Úsalo para probar el normalizador fuera de n8n o para comparar
estructuras si Google/n8n cambian el formato en futuras versiones.
