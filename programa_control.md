# Programa de control — barrido histórico 2026–2027 (FastAPI + React)

Documento de **metodología**, **arquitectura**, **implicancias** y **alternativas**
para una aplicación en el servidor que orquesta el modo **historical** de n8n,
supervisa el avance vía **`email_history_day.analyzed_date`** y expone datos en
**React :7201**.

Relacionado: [estructura_program_control.md](./estructura_program_control.md) ·
[correos_historicos.md](./correos_historicos.md) ·
[implicancias_proceso.md](./implicancias_proceso.md) ·
[programa_control.md](./programa_control.md) *(este documento)* ·
[flujo_api_gmail.md](./flujo_api_gmail.md)

**No implementa código aquí** — define requisitos validados y diseño alineado a
`workflow_ok.json` e [infra/docker-compose.yml](./infra/docker-compose.yml).

---

## Resumen ejecutivo

| Dato validado | Valor |
|---------------|--------|
| Tiempo por día (n8n) | **3–5 minutos** por `analyzed_date` |
| Intervalo de supervisión | **Cada 10 minutos** (margen ≥ 2× un día) |
| Fuente de avance | `email_history_day` — `analyzed_date` + `status = 'completed'` |
| Rango programado | **2026 completo** + **2027 enero–junio** |
| Orden de barrido | Mes a mes (ene 2026 → … → jun 2027), día a día (1, 2, 3…) |
| Ventana enviada a n8n | **2 días calendario** consecutivos (`startDate`, `endDate`) |
| UI | FastAPI + React en **puerto 7201** |

La app **no** reemplaza n8n: lee Postgres, calcula el siguiente par de días,
lanza/cancela el workflow y muestra tablas históricas y correos con match.

---

## Objetivo de negocio

Completar de forma **automática y reanudable** todos los días programados:

```text
Rango global: 2026-01-01 → 2027-06-30
Modo n8n: historical (1 día por vuelta interna; rango de 2 días en Config)
Día listo ⇔ fila en email_history_day con analyzed_date = ese día y status = 'completed'
```

Total calendario: **546 días** (365 + 181).  
Tiempo serial estimado: 546 × 4 min ≈ **36 h** de procesamiento n8n (la supervisión
cada 10 min solo coordina, no suma un día entero por pulso).

---

## Requisitos funcionales (validados)

### RF-1 — Programación en la app

- La app define qué tramo del calendario está **activo** (meses/años habilitados).
- Alcance mínimo acordado: **todo 2026** y **2027 hasta junio inclusive**.
- Orden estricto: **menor a mayor** — primero enero 2026, luego febrero 2026, …,
  diciembre 2026, enero 2027, …, **junio 2027**.
- Dentro de cada mes: días **1, 2, 3, …** según calendario.

### RF-2 — Validación por `analyzed_date`

- Tras cada pulso de 10 min, la app consulta Postgres:

```sql
SELECT analyzed_date, status,
       emails_listed_count, emails_processed_count, emails_match_count
FROM email_history_day
WHERE analyzed_date >= :range_start AND analyzed_date <= :range_end
  AND status = 'completed'
ORDER BY analyzed_date;
```

- Un día cuenta como **cumplido** solo con `status = 'completed'`.
- El workflow n8n ya escribe esa fila al cerrar cada día (Registrar día histórico).

### RF-3 — Ventana de 2 días hacia n8n

La app envía siempre un **par consecutivo** de fechas a Config histórico / webhook:

```text
startDate = primer día pendiente del mes activo
endDate   = startDate + 1 día   (dos días naturales inclusive)
```

Ejemplo: último día cumplido **2026-01-15** → siguiente solicitud **2026-01-16** … **2026-01-17**.

n8n internamente procesa **un día por vuelta**; con `endDate` a +1 día, **Planificar
días pendientes** puede encadenar 16 y luego 17 en la misma ejecución si el loop
cierra bien.

### RF-4 — Pulso cada 10 minutos (algoritmo)

Reloj del backend: **`CONTROL_POLL_INTERVAL_SEC=600`**.

```text
CADA 10 MINUTOS:

1. Determinar mes/año activo (primer mes programado con días pendientes).

2. Leer completed en email_history_day para el mes activo.

3. Calcular primer día pendiente D (mínima fecha sin completed, en orden calendario).

4. Si no hay pendientes en el mes → pasar al mes siguiente (feb 2026, mar 2026, …).

5. Si no hay pendientes en todo el rango 2026-01-01…2027-06-30 → estado DONE.

6. Definir ventana objetivo: W = [D, D+1]  (startDate, endDate).

7. Consultar qué días de W ya están completed:
     C = { d ∈ W | completed(d) }

8. CASO A — Ejecución n8n RUNNING:
     • Si desde el pulso anterior aumentó analyzed_date completed → seguir esperando.
     • Si RUNNING > timeout (ej. 15 min sin nuevo completed) → STOP ejecución.

9. CASO B — No RUNNING (o recién cancelada):

     • Si C = ∅ (no se cumplió ninguno de W):
         → Lanzar workflow con startDate=D, endDate=D+1  (reintento 16–17)

     • Si C = {D} (solo cumplió el primero, ej. 16 sí, 17 no):
         → Lanzar startDate=D+1, endDate=D+2  (ej. 17–18)

     • Si C = W (cumplió D y D+1):
         → Lanzar siguiente par: startDate=D+2, endDate=D+3  (ej. 18–19)

10. Registrar en control_run: ventana pedida, completed antes/después, n8n_execution_id.
```

#### Ejemplo numérico (enero 2026)

| Situación tras 10 min | Último completed | Acción siguiente |
|----------------------|------------------|------------------|
| Tras 15 ene OK | 2026-01-15 | Pedir **16–17 ene** |
| Ninguno de 16–17 | 2026-01-15 | **Repetir 16–17 ene** |
| Solo 16 | 2026-01-16 | Pedir **17–18 ene** |
| 16 y 17 | 2026-01-17 | Pedir **18–19 ene** |
| … | … | Hasta 31 ene–1 feb (cuidar cambio de mes) |

**Cambio de mes:** si `D = 2026-01-31`, `D+1 = 2026-02-01`. La ventana cruza meses;
`endDate` sigue siendo el día calendario siguiente. Al cerrar enero, el mes activo
pasa a febrero cuando no queden pendientes en enero.

### RF-5 — Persistencia hasta completar

- El scheduler **corre en el servidor** (FastAPI + APScheduler o worker), 24/7
  mientras `control_schedule.enabled` lo permita.
- No detenerse tras un solo par de días: continúa mes a mes hasta **2027-06-30**.
- Pausa manual solo vía UI (flag `control_schedule.paused` o similar).

### RF-6 — Frontend :7201 (consulta de tablas)

La app debe permitir **ver y explorar** (solo lectura operativa):

| Vista | Tabla / origen | Contenido |
|-------|----------------|-----------|
| **Progreso por día** | `email_history_day` | `analyzed_date`, listados, procesados, **match**, estado |
| **Resumen mensual** | agregación | Días completed / total del mes, suma de matches |
| **Correos seleccionados (match)** | `email_trace` | Solo `review_mode = 'historical'` y fechas del rango |
| **Detalle de correo** | `email_trace` + `email_attachment_ref` | Asunto, remitente, `body_text`, excerpts, keywords, posiciones, enlace Gmail, PDFs ref. |
| **Ejecuciones** | `control_run` | Ventana pedida, id n8n, cancelaciones, notas |
| **Programación** | `control_schedule` | Meses/años habilitados |

Campos clave por correo match (`email_trace`):

- Identificación: `message_id`, `thread_id`, `gmail_link`
- Contenido: `subject`, `from_address`, `email_date`, `body_text`, `snippet`
- Match: `match_telemetria_keyword`, `match_person_keyword`, excerpts, posiciones
- Trazabilidad: `search_query`, `reviewed_at`

---

## Por qué 10 minutos (dato validado)

| Métrica | Valor |
|---------|--------|
| Procesamiento real por día | **3–5 min** |
| Pulso de supervisión | **10 min** |
| Margen | Permite cerrar 1 día y parte del 2.º antes de reevaluar |
| Evita | Relanzar en falso a los 2 min; da tiempo al loop n8n + Postgres |

Si a los 10 min **no** hay ningún `completed` nuevo en la ventana pedida → **reintento
misma ventana** (RF-4, caso B, C = ∅).  
Si hay **avance parcial** → ventana **deslizante** (solo 17–18, no repetir 16).

Timeout de ejecución n8n sugerido: **12–15 min** sin nuevo `analyzed_date` (≈ 3×
un día) antes de cancelar.

---

## Arquitectura propuesta

```
┌─────────────────────────────────────────────────────────────────┐
│  Servidor (Docker: telemetria-net)                              │
│                                                                 │
│  control-web :7201 (React) ──► control-api :7200 (FastAPI)     │
│                                      │                          │
│                    ┌─────────────────┼─────────────────┐        │
│                    ▼                 ▼                 ▼        │
│            postgres-telemetria   n8n :7001          scheduler    │
│            email_history_day     workflow OK        cada 10 min │
│            email_trace                                          │
│            control_schedule / control_run                       │
└─────────────────────────────────────────────────────────────────┘
```

| Servicio | Puerto | Función |
|----------|--------|---------|
| `control-api` | 7200 (interno) | REST, planner, n8n client, pulso 10 min |
| `control-web` | **7201** | UI tablas históricas + correos match |
| `n8n-telemetria` | 7001 | Motor historical (sin cambiar lógica de filtro) |

---

## Metodología del planner (`planner.py`)

### Entrada

- `control_schedule`: meses habilitados en 2026 y ene–jun 2027.
- `email_history_day`: conjunto de `analyzed_date` con `status = 'completed'`.

### Salida

```python
{
  "active_year": 2026,
  "active_month": 1,
  "first_pending": date(2026, 1, 16),
  "window_start": date(2026, 1, 16),
  "window_end": date(2026, 1, 17),
  "action": "launch" | "wait" | "retry_same" | "slide_window" | "done"
}
```

### Pseudocódigo — siguiente ventana

```python
def next_window(programmed_range, completed_set, last_requested_window):
    D = first_calendar_day_not_in(completed_set, programmed_range, order='asc')
    if D is None:
        return DONE

    W = (D, D + timedelta(days=1))
    completed_in_W = {d for d in W if d in completed_set}

    if completed_in_W == set(W):
        # Ambos listos → siguiente par
        return (D + 2 days, D + 3 days)

    if len(completed_in_W) == 1 and W[0] in completed_in_W:
        # Avanzó solo el primero → deslizar
        return (W[1], W[1] + 1 day)

    if len(completed_in_W) == 0:
        # Nada cumplido → misma ventana W (reintento)
        return W

    # Solo segundo cumplido (raro): replanificar desde D
    return W
```

---

## Integración con n8n

### Parámetros por lanzamiento

```json
{
  "mode": "historical",
  "startDate": "2026-01-16",
  "endDate": "2026-01-17",
  "tzOffsetHours": -5,
  "skipKnownInDb": true
}
```

Entrega recomendada: **Webhook histórico** → nodo Set equivalente a Config histórico
(ver Fase 0). Alternativa: PATCH del workflow vía API n8n.

### API n8n

| Acción | Cuándo |
|--------|--------|
| `POST /workflows/{id}/run` | Tras calcular ventana (RF-4 caso B) |
| `POST /executions/{id}/stop` | Timeout sin nuevo `completed` |
| `GET /executions?status=running` | Pulso 10 min — máximo **una** ejecución histórica |

```env
N8N_BASE_URL=http://n8n-telemetria:5678
N8N_API_KEY=...
N8N_WORKFLOW_ID=...
CONTROL_POLL_INTERVAL_SEC=600
CONTROL_EXEC_TIMEOUT_MIN=15
PROGRAM_RANGE_START=2026-01-01
PROGRAM_RANGE_END=2027-06-30
```

---

## Backend FastAPI — endpoints (actualizado)

| Método | Ruta | Uso |
|--------|------|-----|
| GET | `/api/v1/dashboard` | Progreso global 2026–jun 2027, mes activo, ventana actual |
| GET | `/api/v1/history/days?from=&to=` | Filas `email_history_day` |
| GET | `/api/v1/history/days/{date}` | Detalle un día + arrays de IDs |
| GET | `/api/v1/history/summary?year=` | Días completed por mes |
| GET | `/api/v1/trace` | Lista paginada `email_trace` (filtro historical, fechas) |
| GET | `/api/v1/trace/{message_id}` | Detalle completo + adjuntos |
| GET | `/api/v1/trace/stats` | Totales procesados / match por mes |
| GET | `/api/v1/schedule` | Programación meses |
| PUT | `/api/v1/schedule` | Habilitar meses 2026 / 2027 ene–jun |
| GET | `/api/v1/runs/current` | Ejecución n8n + ventana pedida |
| GET | `/api/v1/runs` | Historial `control_run` |
| POST | `/api/v1/runs/pause` | Pausar scheduler |
| POST | `/api/v1/runs/resume` | Reanudar |

---

## Frontend React — puerto 7201

### Pantallas

1. **Dashboard** — barra 546 días, mes en curso (ej. “Marzo 2026”), ventana n8n actual
   (16–17 ene), próximo pulso en mm:ss.
2. **Calendario histórico** — heatmap por `analyzed_date`; tooltip con
   `emails_listed_count`, `emails_processed_count`, `emails_match_count`.
3. **Día detalle** — JSON/lista de IDs listados vs match; enlace a correos.
4. **Correos match** — tabla `email_trace` filtrable por mes; columnas asunto, fecha,
   persona, keyword telemetría.
5. **Correo detalle** — ficha con `body_text`, excerpts, adjuntos PDF (ref.), metadata
   de búsqueda.
6. **Programación** — checklist meses 2026 + ene–jun 2027; pausa global.
7. **Log ejecuciones** — reintentos 16–17, deslizamientos 17–18, cancelaciones.

Polling UI sugerido: **30 s** (el scheduler crítico está en backend a 10 min).

---

## Tablas

### Existentes (solo lectura + escritura vía n8n)

- **`email_history_day`** — progreso diario; **`analyzed_date`** es la clave de avance.
- **`email_trace`** — correos con match; detalle para UI.
- **`email_attachment_ref`** — PDFs referenciados.

### Nuevas (app)

```sql
CREATE TABLE control_schedule (
    year       SMALLINT NOT NULL,
    month      SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    enabled    BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (year, month)
);

-- Semilla sugerida: 2026 meses 1–12 + 2027 meses 1–6 enabled

CREATE TABLE control_run (
    id                   BIGSERIAL PRIMARY KEY,
    started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at          TIMESTAMPTZ,
    n8n_execution_id     TEXT,
    window_start         DATE NOT NULL,
    window_end           DATE NOT NULL,
    days_completed_before INT NOT NULL DEFAULT 0,
    days_completed_after  INT,
    action               TEXT NOT NULL  -- launch | retry_same | slide_window | stop
        CHECK (action IN ('launch','retry_same','slide_window','stop','wait')),
    status               TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','completed','cancelled','failed','timeout')),
    note                 TEXT
);

CREATE TABLE control_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    paused BOOLEAN NOT NULL DEFAULT false,
    last_poll_at TIMESTAMPTZ,
    last_completed_date DATE,
    current_window_start DATE,
    current_window_end DATE
);
```

---

## Implicancias y riesgos

### Operativas

| Tema | Implicancia |
|------|-------------|
| Reintento 16–17 | Si n8n falla 2 veces seguidas, revisar logs; la app no avanza ventana hasta `completed` |
| Ventana deslizante 17–18 | Correcto: no reprocesa 16 ya en BD (`Planificar` lo omite) |
| Cancelar a 15 min | Puede cortar día en curso; siguiente pulso reintenta misma ventana |
| Una sola ejecución n8n | Obligatorio — misma cuenta Gmail |
| Rango 2027 jun | Tras 2026-12-31 sigue ene 2027 sin intervención manual |

### Técnicas

| Tema | Implicancia |
|------|-------------|
| 3–5 min/día | Estimación 546 días ≈ 36 h CPU n8n; planificar carga servidor |
| 10 min poll | No sustituye timeout 15 min en ejecución colgada |
| Webhook fechas | Prerrequisito Fase 0; sin él hay que PATCH workflow |
| Puerto 7201 | Auth obligatoria — expone cuerpos de correo |

### UI / datos

| Tema | Implicancia |
|------|-------------|
| “Procesados” vs “match” | `emails_processed_count` (día) vs filas en `email_trace` (solo match) |
| IDs en JSONB | `message_ids_match` en history_day; detalle en `email_trace` |
| Paginación | `email_trace` crecerá miles de filas — API paginada |

---

## Alternativas

| Opción | Cuándo |
|--------|--------|
| Script bash + cron 10 min | MVP sin UI 7201 |
| Solo n8n Schedule | No implementa bien ventana deslizante + reintento |
| **FastAPI + React (propuesta)** | Requisito completo RF-1…RF-6 |

---

## Plan de implementación

### Fase 0 — Webhook histórico en n8n ✅

Implementado en `workflow_ok.json`:

- **Webhook histórico** → path `historico-run`
- **Config histórico API** → `{ mode, startDate, endDate }` desde POST

Reimportar workflow y **activarlo** en n8n. Ver [estructura_program_control.md](./estructura_program_control.md).

### Fase 1 — Backend + pulso 10 min

`planner.py` con lógica RF-4; `n8n_client`; semilla `control_schedule` 2026 + 2027
ene–jun.

### Fase 2 — Frontend 7201

Dashboard, calendario, tablas history/trace, detalle correo.

### Fase 3 — Endurecimiento

Alertas si 3 reintentos misma ventana; métricas tiempo real por día.

---

## Consultas SQL útiles

Progreso global:

```sql
SELECT COUNT(*) FILTER (WHERE status = 'completed') AS days_done,
       546 - COUNT(*) FILTER (WHERE status = 'completed') AS days_remaining
FROM email_history_day
WHERE analyzed_date >= '2026-01-01' AND analyzed_date <= '2027-06-30';
```

¿Cumplió la ventana 16–17 ene?

```sql
SELECT analyzed_date, status, emails_match_count
FROM email_history_day
WHERE analyzed_date IN ('2026-01-16', '2026-01-17');
```

Correos match de un día:

```sql
SELECT et.*
FROM email_trace et
WHERE et.review_mode = 'historical'
  AND et.email_date >= '2026-01-16'
  AND et.email_date <  '2026-01-17'::date + 1
ORDER BY et.reviewed_at;
```

---

## Criterios de éxito

- [ ] Pulso **10 min** operativo en servidor sin intervención manual.
- [ ] Avance **mes a mes**, días **1…n**, usando solo `analyzed_date` completed.
- [ ] Ventana **2 días** con reintento (ninguno cumplido) y deslizamiento (solo uno cumplido).
- [ ] Rango **2026-01-01 → 2027-06-30** completado en BD.
- [ ] UI **7201**: conteos por día, lista de match, detalle completo por correo.
- [ ] Nunca dos ejecuciones históricas n8n simultáneas.

---

## Conclusión

Metodología acordada tras validación en campo:

1. **3–5 min** por día en n8n → supervisión cada **10 min**.
2. **`analyzed_date`** en `email_history_day` como única señal de día cumplido.
3. Orden **cronológico estricto** (mes a mes, día a día) hasta **junio 2027**.
4. Ventana móvil de **2 días** hacia n8n, con **reintento** y **deslizamiento** según
   qué días aparezcan completed tras cada pulso.
5. App **FastAPI + React :7201** para programar meses y **visualizar** history_day,
   trace y detalle de cada correo match.

El workflow OK permanece como motor; la app es el **programa de control** que lo
mantiene funcionando hasta agotar el calendario programado.

Próximo paso: **Fase 0** (webhook con fechas) + migración `control_*` en
`infra/postgres/`.
