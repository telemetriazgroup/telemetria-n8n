# Fase 4 — Persistencia de hilos y máquina de estados

**Objetivo:** modelar conversaciones completas con estado (`pendiente`, `en_proceso`,
`completada`), reconstruir el contexto del hilo desde Gmail, y mantener coherencia
con el anti-duplicados de F1.

**Prerrequisitos:** [fase_1.md](./fase_1.md) y preferiblemente [fase_3.md](./fase_3.md).

**Estado en el repo:** trazabilidad parcial vía `email_trace` (un registro por
mensaje, sin tabla `threads` ni enum de estado).

**Siguiente fase:** [fase_5.md](./fase_5.md)

---

## Paso 1 — Extender el esquema PostgreSQL

Ejecuta una migración (nuevo archivo `schema_f4.sql` o ALTER):

```sql
-- Estado del hilo
CREATE TYPE thread_status AS ENUM ('pendiente', 'en_proceso', 'completada');

CREATE TABLE IF NOT EXISTS threads (
    id              BIGSERIAL PRIMARY KEY,
    thread_id       TEXT NOT NULL UNIQUE,
    subject         TEXT,
    participants    TEXT,
    status          thread_status NOT NULL DEFAULT 'pendiente',
    message_count   INT NOT NULL DEFAULT 0,
    first_message_at TIMESTAMPTZ,
    last_message_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Opcional: renombrar conceptualmente email_trace → messages
-- o mantener email_trace y sincronizar threads desde ella.

CREATE INDEX IF NOT EXISTS idx_threads_status ON threads (status);
```

Decisión de adjuntos: **mantener** `email_attachment_ref` (solo metadatos, sin
binarios) — alineado con el diseño actual del repo.

---

## Paso 2 — Obtener hilo completo desde Gmail

Tras detectar un correo nuevo, añade nodo **Gmail → Get Thread** (o HTTP Request a
Gmail API) usando `thread_id`:

1. Input: `thread_id` del mensaje normalizado.
2. Output: todos los mensajes del hilo en orden cronológico.
3. Normaliza cada mensaje con la misma lógica de `02-normalizar.js`.
4. Inserta/actualiza en `email_trace` con **Skip on conflict** (idempotente).

---

## Paso 3 — Upsert de tabla `threads`

Nodo **Code** o **Postgres** después de persistir mensajes:

```javascript
// Pseudológica por hilo procesado
// - Si threads.thread_id no existe → INSERT status='pendiente'
// - Si existe → UPDATE message_count, last_message_at, subject
// - No duplicar: UNIQUE(thread_id)
```

Transiciones de estado (manual al inicio, automatizadas en F7):

| De | A | Disparador típico |
|----|---|-------------------|
| pendiente | en_proceso | operador toma el caso / REST confirma recepción |
| en_proceso | completada | instalación confirmada / respuesta enviada |

---

## Paso 4 — Actualizar Telegram con estado real

En F3 el estado era fijo `pendiente`. Ahora:

```
<b>Estado:</b> pendiente | en_proceso | completada
```

Leer desde `threads.status` al armar el mensaje.

---

## Paso 5 — Relación con `email_trace` existente

Estrategia incremental (sin romper F1):

1. **Mantener** `email_trace` como registro de mensajes.
2. **Añadir** `threads` como agregado por `thread_id`.
3. Opcional: columna `thread_status` denormalizada en consultas frecuentes.

```sql
-- Vista útil
CREATE OR REPLACE VIEW v_thread_overview AS
SELECT
  t.thread_id,
  t.subject,
  t.status,
  t.message_count,
  COUNT(a.id) AS attachment_refs
FROM threads t
LEFT JOIN email_trace e ON e.thread_id = t.thread_id
LEFT JOIN email_attachment_ref a ON a.thread_id = t.thread_id
GROUP BY t.id;
```

---

## Paso 6 — Pruebas de validación

1. Hilo con 3 respuestas → 3 filas en `email_trace`, **1 fila** en `threads`.
2. Orden cronológico correcto al consultar por `thread_id`.
3. Cambiar estado manualmente:

```sql
UPDATE threads SET status = 'en_proceso', updated_at = now()
WHERE thread_id = '<id>';
```

4. Reprocesar el mismo hilo → sin filas duplicadas.

---

## Checklist de cierre F4

- [ ] Tabla `threads` con enum de estado
- [ ] Get Thread persiste todos los mensajes del hilo
- [ ] `message_count` y fechas coherentes
- [ ] Anti-duplicados sigue funcionando
- [ ] Telegram muestra estado real del hilo

**Siguiente:** [fase_5.md](./fase_5.md) — envío del payload a la aplicación REST.
