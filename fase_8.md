# Fase 8 — Robustez, escalabilidad y multi-cuenta

**Objetivo:** logging end-to-end, reintentos con backoff, soporte de varias cuentas
Gmail sin duplicar lógica, y alertas si el workflow deja de procesar.

**Prerrequisitos:** Fases F1–F7 estables (al menos F1–F3 en producción).

---

## Paso 1 — Tabla de logs operativos

```sql
CREATE TABLE IF NOT EXISTS workflow_log (
    id            BIGSERIAL PRIMARY KEY,
    event_type    TEXT NOT NULL,  -- read | filter | notify | rest | ai | reply | error
    message_id    TEXT,
    thread_id     TEXT,
    gmail_account TEXT,
    detail        JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wlog_created ON workflow_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wlog_thread  ON workflow_log (thread_id);
```

Inserta desde nodos **Postgres** al final de cada rama crítica (o un sub-workflow
**Log event** reutilizable).

---

## Paso 2 — Reintentos y backoff

En nodos **HTTP Request** (REST, Groq) y **Telegram**:

| Nodo | Reintentos | Notas |
|------|------------|-------|
| REST F5 | 3 | Registrar cada intento en `rest_delivery_log` |
| Groq F6 | 2 | Fail-open a resumen simple |
| Telegram F3 | 3 | No bloquear guardado en BD |
| Gmail | 2 | Cuidado con rate limits |

Usa **Error Workflow** global en n8n: Settings → Error Workflow → flujo que
escribe en `workflow_log` y alerta por Telegram.

---

## Paso 3 — Monitoreo de salud

### 3.1 Workflow de watchdog

Cron cada hora:

```sql
SELECT MAX(reviewed_at) AS last_seen FROM email_trace;
```

Si `last_seen` > N horas en horario laboral → Telegram alerta:
"Workflow telemetría sin actividad".

### 3.2 Métricas mínimas

Consultas periódicas:

```sql
-- Correos procesados hoy
SELECT COUNT(*) FROM email_trace
WHERE reviewed_at::date = CURRENT_DATE;

-- Fallos REST últimas 24h
SELECT COUNT(*) FROM rest_delivery_log
WHERE status = 'failed' AND attempted_at > now() - interval '24 hours';
```

---

## Paso 4 — Multi-cuenta Gmail

### 4.1 Una credencial OAuth por cuenta

En n8n crea **Gmail OAuth2 - cuenta1**, **Gmail OAuth2 - cuenta2**, etc.

Cada redirect URI sigue siendo la misma de n8n; cada credencial autoriza una
cuenta distinta.

### 4.2 Sub-workflow parametrizado

1. Extrae la lógica F1–F7 a un **Sub-workflow** con inputs:
   - `gmailCredentialId`
   - `accountLabel`
   - `telegramChatId` (opcional por cuenta)
2. Workflow principal: **Loop** o ramas paralelas por cuenta.

### 4.3 Anti-duplicados por cuenta

Añade columna `gmail_account` a `email_trace` (migración):

```sql
ALTER TABLE email_trace ADD COLUMN IF NOT EXISTS gmail_account TEXT;
-- UNIQUE(message_id) sigue siendo válido (IDs Gmail son globales)
-- Para auditoría, filtra por gmail_account en consultas
```

Verifica que reprocesar cuenta A no afecta cuenta B.

---

## Paso 5 — Límites de API

| API | Límite típico | Mitigación |
|-----|---------------|------------|
| Gmail | cuota diaria por proyecto | intervalo cron ≥ 15 min; filtro keywords |
| Groq | RPM / tokens free tier | truncar body; cache resúmenes por message_id |
| Telegram | 30 msg/s por bot | cola si alto volumen |

---

## Paso 6 — Pruebas de caos controlado

1. **Token Gmail revocado** → error capturado, log + alerta, sin corrupción BD.
2. **API REST caída** → reintentos + `failed` en log; Telegram sigue.
3. **Segunda cuenta Gmail** → correos aislados, sin duplicados cruzados.
4. **Reconstruir ciclo de vida** de un correo solo con `workflow_log`:

```sql
SELECT event_type, detail, created_at
FROM workflow_log
WHERE thread_id = '<id>'
ORDER BY created_at;
```

---

## Criterios de sistema totalmente integrado

El sistema está completo cuando cumple de forma sostenida:

1. Lee correos y respuestas sin duplicar.
2. Filtra por keywords parametrizables.
3. Persiste hilos con estado.
4. Envía payload REST con reintentos.
5. Notifica Telegram con resumen IA.
6. Responde en el hilo con validación (asistida o automática).
7. Registra logs, maneja errores y soporta multi-cuenta.

Referencia completa: [plan_fases_telemetria.md](./plan_fases_telemetria.md).

---

## Checklist de cierre F8

- [ ] Tabla `workflow_log` operativa
- [ ] Error Workflow global configurado
- [ ] Watchdog de inactividad
- [ ] Reintentos en nodos críticos
- [ ] Segunda cuenta Gmail probada
- [ ] Documentación de runbook para operadores

**Proyecto integrado.** Mantén [README.md](./README.md) actualizado con el estado
de cada fase.
