# Fase 6 — Enriquecimiento con IA (Groq)

**Objetivo:** generar resumen del correo/hilo, clasificación (tipo, prioridad) y
borrador de respuesta usando Groq. Sustituye el recorte simple de F3 e enriquece
el payload de F5.

**Prerrequisitos:** [fase_3.md](./fase_3.md) y [fase_5.md](./fase_5.md) (o al menos
Telegram + payload definido).

**Siguiente fase:** [fase_7.md](./fase_7.md)

---

## Paso 1 — Configuración

En **Configuración**:

```
groqEnabled = true
groqModel = llama-3.1-8b-instant
aiFailOpen = true    # si Groq falla, notificar igual con resumen simple
```

Credencial: API Key Groq (creada en [fase_0.md](./fase_0.md)).

---

## Paso 2 — Code node: body para Groq (sin string JSON con {{ }})

```javascript
const cfg = $('Configuración').first().json;
const model = cfg.groqModel || 'llama-3.1-8b-instant';

const out = [];
for (const item of $input.all()) {
  const m = item.json;
  const userContent =
    `Asunto: ${m.subject}\nDe: ${m.from_address}\n\n${m.body_text || m.snippet}`;

  out.push({
    json: {
      ...m,
      groq_body: {
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'Eres un asistente de telemetría. Responde SOLO JSON válido con keys: ' +
              'summary (string), category (string), priority (low|medium|high), ' +
              'draft_reply (string).'
          },
          { role: 'user', content: userContent.slice(0, 12000) }
        ],
        response_format: { type: 'json_object' }
      }
    }
  });
}
return out;
```

---

## Paso 3 — HTTP Request a Groq

| Parámetro | Valor |
|-----------|-------|
| Method | POST |
| URL | `https://api.groq.com/openai/v1/chat/completions` |
| Auth | Bearer `<GROQ_API_KEY>` |
| Body | `={{ $json.groq_body }}` |

Timeout razonable (15–30 s). Reintentos: 2.

---

## Paso 4 — Parsear respuesta

Nodo **Code** posterior:

```javascript
const out = [];
for (const item of $input.all()) {
  const m = item.json;
  let ai = { summary: '', category: '', priority: 'medium', draft_reply: '' };
  try {
    const content = m.choices[0].message.content;
    ai = JSON.parse(content);
  } catch (e) {
    ai.summary = (m.body_text || '').slice(0, 400);
  }
  out.push({
    json: {
      ...$('Armar payload Groq').item.json, // o referencia al item original
      ai_summary: ai.summary,
      ai_category: ai.category,
      ai_priority: ai.priority,
      ai_draft_reply: ai.draft_reply
    }
  });
}
return out;
```

Ajusta la referencia al nodo anterior según tu workflow.

---

## Paso 5 — Integrar en Telegram y REST

### Telegram (reemplaza recorte F3)

```
<b>Resumen:</b> {{ ai_summary }}
<b>Categoría:</b> {{ ai_category }}
<b>Prioridad:</b> {{ ai_priority }}
```

### Payload REST (F5)

Añade al objeto `payload`:

```json
"ai": {
  "summary": "...",
  "category": "...",
  "priority": "high",
  "draft_reply": "..."
}
```

---

## Paso 6 — Degradación elegante

Ramifica con **IF** o try/catch en Code:

```
Groq OK ──► usar ai_summary en Telegram y REST
Groq FAIL ──► aiFailOpen=true → resumen simple (body_text slice)
           └──► registrar fallo en log (F8)
```

**La notificación Telegram no debe bloquearse** si Groq tarda o falla.

---

## Paso 7 — Validación

1. Tres correos representativos → resúmenes coherentes con el original.
2. Clasificación razonable (no perfecta).
3. Desconectar Groq (URL inválida) → Telegram sigue llegando con resumen simple.
4. Verificar cuotas/latencia del free tier.

---

## Checklist de cierre F6

- [ ] Body Groq armado en Code node
- [ ] Resumen IA en Telegram
- [ ] Campos `ai.*` en payload REST
- [ ] Degradación si falla Groq
- [ ] Borrador guardado para F7

**Siguiente:** [fase_7.md](./fase_7.md) — respuesta asistida vía Gmail.
