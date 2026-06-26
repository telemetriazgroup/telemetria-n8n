# Fase 5 — Integración REST con la aplicación de gestión

**Objetivo:** enviar a la aplicación de gestión un payload JSON completo cada vez
que un correo relevante es procesado, con reintentos y registro del resultado en BD.

**Prerrequisitos:** [fase_4.md](./fase_4.md) (hilos y mensajes persistidos).

**Siguiente fase:** [fase_6.md](./fase_6.md)

---

## Paso 1 — Acordar contrato del payload

Antes de codificar, define con el equipo de la aplicación:

```json
{
  "message_id": "18abc...",
  "thread_id": "18def...",
  "from": "cliente@example.com",
  "to": "telemetria@ztrack.app",
  "subject": "Instalación Eusebio - unidad 123",
  "date": "2026-06-26T15:30:00Z",
  "body_text": "...",
  "thread_status": "pendiente",
  "messages": [],
  "attachments": [
    {
      "filename": "reporte.pdf",
      "mime_type": "application/pdf",
      "attachment_id": "ANGjdJ...",
      "gmail_link": "https://mail.google.com/..."
    }
  ],
  "gmail_link": "https://mail.google.com/mail/u/0/#inbox/18def..."
}
```

Documenta versión del esquema (`payload_version: 1`) para cambios futuros.

---

## Paso 2 — Configuración

En el nodo **Configuración**:

```
restApiEnabled = true
restApiUrl = https://app.ztrack.app/api/v1/email-ingest
```

Token/API key: **credencial HTTP** en n8n (no en texto plano del Set node).

---

## Paso 3 — Code node: construir payload (patrón obligatorio)

**No** incrustes `{{ }}` dentro de un string JSON en el nodo HTTP Request.

```javascript
const cfg = $('Configuración').first().json;

const out = [];
for (const item of $input.all()) {
  const m = item.json;
  const attachments = (m.attachments || []).map(a => ({
    filename: a.filename,
    mime_type: a.mime_type,
    attachment_id: a.attachment_id,
    gmail_link: m.gmail_link
  }));

  out.push({
    json: {
      payload: {
        payload_version: 1,
        message_id: m.message_id,
        thread_id: m.thread_id,
        from: m.from_address,
        to: m.to_addresses,
        cc: m.cc_addresses,
        subject: m.subject,
        date: m.email_date,
        body_text: m.body_text,
        thread_status: m.thread_status || 'pendiente',
        attachments,
        gmail_link: `https://mail.google.com/mail/u/0/#inbox/${m.thread_id}`
      }
    }
  });
}
return out;
```

---

## Paso 4 — Nodo HTTP Request

| Parámetro | Valor |
|-----------|-------|
| Method | POST |
| URL | `={{ $('Configuración').first().json.restApiUrl }}` |
| Authentication | Header Auth (Bearer token) |
| Body Content Type | JSON |
| Specify Body | Using JSON |
| JSON | `={{ $json.payload }}` |

Activa **Retry on Fail** (3 intentos, backoff).

---

## Paso 5 — Registrar resultado en BD

Tabla sugerida:

```sql
CREATE TABLE IF NOT EXISTS rest_delivery_log (
    id           BIGSERIAL PRIMARY KEY,
    message_id   TEXT NOT NULL,
    thread_id    TEXT,
    status       TEXT NOT NULL,  -- 'sent' | 'failed'
    http_status  INT,
    response_body TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Tras el HTTP Request, nodo **IF** + **Postgres Insert**:

- 2xx → `status = sent`
- otro → `status = failed` (no reprocesar a ciegas; alerta operador)

---

## Paso 6 — Pruebas

### 6.1 Endpoint de prueba

Usa [webhook.site](https://webhook.site) temporalmente como URL para validar
forma del JSON antes de conectar la app real.

### 6.2 Error simulado

Apunta a URL inválida → verificar registro `failed` y que la trazabilidad/Telegram
no se pierden.

### 6.3 Idempotencia

La app debe aceptar reenvío del mismo `message_id` sin duplicar tickets (o n8n
consulta `rest_delivery_log` antes de reenviar).

---

## Checklist de cierre F5

- [ ] Contrato JSON acordado y versionado
- [ ] Payload armado en Code node
- [ ] HTTP Request con reintentos
- [ ] Log de envío en BD
- [ ] Prueba end-to-end con app o webhook.site

**Siguiente:** [fase_6.md](./fase_6.md) — resumen y clasificación con IA.
