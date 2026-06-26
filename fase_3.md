# Fase 3 — Notificación por Telegram (MVP visible)

**Objetivo:** enviar una alerta automática a Telegram cuando un correo supera el
filtro de keywords. Es el **primer valor visible** para stakeholders.

**Prerrequisitos:** [fase_2.md](./fase_2.md) completada (filtro activo y probado).

**Siguiente fase:** [fase_4.md](./fase_4.md)

---

## Paso 1 — Configurar destino en el nodo Configuración

Añade al nodo **Configuración**:

```
telegramChatId = -1001234567890   # tu chat ID (número)
telegramEnabled = true
summaryMaxChars = 400             # recorte simple del cuerpo (antes de IA en F6)
```

Obtener chat ID: ver [fase_0.md](./fase_0.md), paso 5.

---

## Paso 2 — Nodo Code: armar mensaje HTML

Inserta después del filtro (rama positiva) y **antes** o **en paralelo** con guardar BD.

```javascript
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const cfg = $('Configuración').first().json;
const max = Number(cfg.summaryMaxChars || 400);

const out = [];
for (const item of $input.all()) {
  const m = item.json;
  const body = (m.body_text || m.snippet || '').slice(0, max);
  const threadLink = `https://mail.google.com/mail/u/0/#inbox/${m.thread_id}`;

  const text =
    `<b>Nuevo correo de telemetría</b>\n` +
    `<b>De:</b> ${escHtml(m.from_address)}\n` +
    `<b>Asunto:</b> ${escHtml(m.subject)}\n` +
    `<b>Resumen:</b> ${escHtml(body)}${body.length >= max ? '…' : ''}\n` +
    `<b>Estado:</b> pendiente\n` +
    `<a href="${threadLink}">Abrir hilo en Gmail</a>`;

  out.push({
    json: {
      ...m,
      telegram_text: text,
      telegram_chat_id: cfg.telegramChatId
    }
  });
}
return out;
```

**Importante:** usar `parse_mode=HTML`, no Markdown. Escapar `<`, `>`, `&`.

---

## Paso 3 — Nodo Telegram

1. Añade nodo **Telegram → Send Message**.
2. Credencial: la del bot (F0).
3. Parámetros:
   - **Chat ID:** `={{ $json.telegram_chat_id }}`
   - **Text:** `={{ $json.telegram_text }}`
   - **Parse Mode:** `HTML`

Conecta la salida del Code node anterior.

---

## Paso 4 — Orden de ejecución y degradación

Recomendado:

```
Filtrar keywords (SÍ)
      ├─► Guardar trazabilidad     (no bloquear por Telegram)
      └─► Armar mensaje → Telegram
```

Si Telegram falla, la trazabilidad en BD ya quedó guardada. En F8 añadirás
reintentos y logging.

**No esperes al LLM** en esta fase: el resumen es un recorte de `body_text`.
F6 lo reemplazará por resumen de IA.

---

## Paso 5 — Pruebas de validación

### 5.1 Caso feliz

1. Correo con keyword → debe llegar mensaje con remitente, asunto, resumen y enlace.
2. El enlace debe abrir el hilo correcto en Gmail.

### 5.2 Caracteres especiales

Prueba asuntos/cuerpos con: `<script>`, `A & B`, comillas, tildes, emojis.
El mensaje no debe romperse ni mostrar HTML crudo no escapado.

### 5.3 Sin filtro / sin match

Correo sin keyword → no debe llegar notificación.

---

## Paso 6 — Contenido mínimo del MVP

| Campo | Fuente |
|-------|--------|
| Remitente | `from_address` |
| Asunto | `subject` |
| Resumen | recorte de `body_text` |
| Enlace | `#inbox/<thread_id>` |
| Estado | `pendiente` (fijo hasta F4) |

---

## Checklist de cierre F3

- [ ] `telegramChatId` configurado
- [ ] Mensaje HTML escapado correctamente
- [ ] Alerta llega en menos de 1 ciclo de cron tras el correo de prueba
- [ ] Trazabilidad en BD independiente del éxito de Telegram
- [ ] Demo lista para stakeholders

**Siguiente:** [fase_4.md](./fase_4.md) — persistencia de hilos y estados.
