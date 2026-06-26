# Fase 7 — Respuesta automática o asistida

**Objetivo:** responder dentro del **mismo hilo de Gmail** (preservando `threadId`,
`In-Reply-To`, `References`), solo cuando se cumplan condiciones de negocio o un
operador apruebe el borrador de F6.

**Prerrequisitos:** [fase_6.md](./fase_6.md) (borrador IA), [fase_4.md](./fase_4.md)
(estados de hilo).

**Riesgo:** envíos a clientes reales. **Empezar siempre en modo asistido.**

**Siguiente fase:** [fase_8.md](./fase_8.md)

---

## Paso 1 — Ampliar scope OAuth Gmail

En Google Cloud Console y credencial n8n, añade scope de envío:

```
https://www.googleapis.com/auth/gmail.send
```

(o `gmail.modify`). Re-autoriza la credencial tras cambiar scopes.

---

## Paso 2 — Configuración de modos

En **Configuración**:

```
replyMode = assisted          # assisted | automatic | disabled
autoReplyEnabled = false      # true solo tras validar assisted
replyRequireApproval = true
installationConfirmedField =  # regla de negocio (ej. flag desde REST)
```

---

## Paso 3 — Modo asistido (recomendado primero)

### 3.1 Telegram con botones inline

Tras F6, envía mensaje con borrador y botones:

- **Aprobar envío**
- **Editar / rechazar**

Implementación:

1. Workflow secundario con **Telegram Trigger** (callback_query).
2. Al aprobar → rama de envío Gmail.
3. Registrar en BD: `approval_by`, `approval_at`.

### 3.2 Aprobación desde la aplicación

Alternativa: la app expone `POST /threads/{id}/approve-reply` → webhook n8n.

---

## Paso 4 — Validación previa al envío

Nodo **IF** antes de Gmail Send:

| Condición | Acción |
|-----------|--------|
| `replyMode = disabled` | No enviar |
| Modo assisted sin aprobación | No enviar |
| Modo automatic sin `installationConfirmed` | No enviar |
| Estado hilo = `completada` | No enviar (opcional) |

Registra intentos bloqueados en tabla de auditoría.

---

## Paso 5 — Enviar respuesta en el hilo

Nodo **Gmail → Reply** (o Send con campos explícitos):

Campos críticos:

| Campo | Valor |
|-------|-------|
| Thread ID | `={{ $json.thread_id }}` |
| Message ID (In-Reply-To) | último `message_id` del hilo |
| To | remitente original (o lista acordada) |
| Subject | `Re: ...` (mismo hilo) |
| Body | `={{ $json.ai_draft_reply }}` o texto editado |

Verifica en Gmail que la respuesta **no** aparece como correo suelto.

---

## Paso 6 — Actualizar estado del hilo

Tras envío exitoso:

```sql
UPDATE threads
SET status = 'completada', updated_at = now()
WHERE thread_id = '<id>';
```

Notifica por Telegram: "Respuesta enviada — hilo completada".

---

## Paso 7 — Modo automático (solo casos acotados)

Habilitar `autoReplyEnabled = true` solo cuando:

1. Modo assisted probado al menos 2 semanas sin incidentes.
2. Reglas de negocio documentadas (ej. solo respuestas tipo " acuse de recibo").
3. Lista blanca de remitentes o categorías IA.

---

## Paso 8 — Pruebas obligatorias

1. **Hilo preservado:** respuesta visible dentro del hilo original en Gmail.
2. **Condiciones no cumplidas:** sistema no envía (verificar auditoría).
3. **Flujo assisted completo:** borrador → aprobar → envío → estado `completada`.
4. **Rechazo:** operador rechaza → no hay envío.

---

## Checklist de cierre F7

- [ ] Scope Gmail send configurado
- [ ] Modo assisted operativo con aprobación
- [ ] Validaciones previas al envío
- [ ] Thread ID e In-Reply-To correctos
- [ ] Auditoría de aprobaciones y envíos
- [ ] Modo automatic deshabilitado hasta validación explícita

**Siguiente:** [fase_8.md](./fase_8.md) — robustez y multi-cuenta.
