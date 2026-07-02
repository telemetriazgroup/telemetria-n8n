# Estructura — programa de control (`control_correo`)

Documentación de la **carpeta del proyecto**, integración Docker con el repo
`telemetria-n8n`, tablas de base de datos y flujo operativo.

Relacionado: [programa_control.md](./programa_control.md) ·
[correos_historicos.md](./correos_historicos.md) ·
[infra/README.md](./infra/README.md)

---

## Ubicación en el monorepo

```
telemetria-n8n/
├── control_correo/              ← aplicación FastAPI + React
│   ├── backend/
│   ├── frontend/
│   └── README.md
├── infra/
│   ├── docker-compose.yml       ← servicios control-correo-* añadidos
│   ├── .env.example
│   └── postgres/
│       └── 06-control-correo.sql
├── schema.sql                   ← tablas n8n (email_trace, email_history_day)
├── workflow_ok.json
├── programa_control.md          ← requisitos funcionales
└── estructura_program_control.md
```

---

## Propósito

| Componente | Función |
|------------|---------|
| **control-correo-api** | FastAPI: lee/escribe tablas `control_*`, consulta `email_history_day` y `email_trace`, scheduler cada **10 min**, cliente API n8n |
| **control-correo-web** | React en **:7201**: dashboard, días históricos, correos match, log ejecuciones |
| **postgres-telemetria** | **Base compartida** con n8n (misma BD `telemetria`, mismo usuario `telemetria_app`) |
| **n8n-telemetria** | Motor del barrido histórico (sin modificar lógica de filtrado) |

---

## Árbol de `control_correo/`

```
control_correo/
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py                 # FastAPI + CORS + lifespan scheduler
│       ├── config.py               # Variables de entorno
│       ├── database.py             # SQLAlchemy + helpers Postgres
│       ├── schemas.py              # Pydantic (API responses)
│       ├── routers/
│       │   ├── dashboard.py        # GET /api/v1/dashboard
│       │   ├── history.py          # email_history_day
│       │   ├── trace.py            # email_trace + adjuntos
│       │   ├── schedule.py         # control_schedule
│       │   └── runs.py             # control_run, pause/resume
│       └── services/
│           ├── planner.py          # Ventana 2 días, reintento/deslizamiento
│           ├── n8n_client.py       # Webhook / API n8n
│           └── scheduler.py        # APScheduler cada 600 s
└── frontend/
    ├── Dockerfile                  # build Vite → nginx
    ├── nginx.conf                  # :80 → proxy /api → API
    ├── package.json
    ├── vite.config.ts              # dev :7201
    └── src/
        ├── main.tsx                # Rutas + navegación
        ├── App.tsx                 # Vistas (dashboard, history, trace, runs)
        ├── api.ts                  # Cliente REST
        └── styles.css
```

---

## Docker — servicios y red

Todos los contenedores usan la red **`telemetria-net`**.

| Contenedor | Imagen / build | Puerto host | Acceso |
|------------|----------------|-------------|--------|
| `postgres-telemetria` | postgres:16-alpine | — (interno) | `postgres-telemetria:5432` |
| `n8n-telemetria` | n8nio/n8n | **7001** | Workflow |
| `control-correo-api` | `control_correo/backend` | — (interno **7200**) | Solo red Docker |
| `control-correo-web` | `control_correo/frontend` | **7201** | UI pública |
| `adminer-telemetria` | adminer | 7901 | Admin BD |

### Diagrama

```
                    ┌─────────────────────┐
  Browser :7201 ──► │ control-correo-web  │
                    │  nginx → /api/*     │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ control-correo-api  │
                    │  :7200 FastAPI      │
                    │  scheduler 10 min   │
                    └───┬────────────┬────┘
                        │            │
            ┌───────────▼──┐    ┌────▼────────────┐
            │ postgres     │    │ n8n-telemetria  │
            │ telemetria   │◄───┤ workflow OK     │
            └──────────────┘    └─────────────────┘
                 ▲                      │
                 │    email_history_day │
                 └──────────────────────┘ (escrito por n8n)
```

---

## Base de datos compartida

### Tablas existentes (n8n / workflow)

| Tabla | Escritura | Lectura app |
|-------|-----------|-------------|
| `email_history_day` | n8n (Registrar día histórico) | **Sí** — avance por `analyzed_date` |
| `email_trace` | n8n (matches) | **Sí** — listado y detalle UI |
| `email_attachment_ref` | n8n | **Sí** — detalle correo |

### Tablas nuevas (solo app)

Migración: [infra/postgres/06-control-correo.sql](./infra/postgres/06-control-correo.sql)

| Tabla | Rol |
|-------|-----|
| **`control_schedule`** | Meses habilitados (2026×12 + 2027×6 semilla) |
| **`control_run`** | Log de ventanas pedidas, acción (`launch`, `retry_same`, `slide_window`), id ejecución n8n |
| **`control_state`** | Una fila: pausa, ventana actual, último poll, ejecución n8n activa |

### Aplicar migración

En servidor con Postgres ya creado (no solo init):

```bash
docker exec -i postgres-telemetria psql -U telemetria_app -d telemetria \
  < infra/postgres/06-control-correo.sql
```

Verificar:

```sql
SELECT COUNT(*) FROM control_schedule;  -- 18 filas semilla
SELECT * FROM control_state;
```

---

## Variables de entorno (`infra/.env`)

| Variable | Default | Uso |
|----------|---------|-----|
| `TELEMETRIA_DB_PASSWORD` | — | Password Postgres (compartido n8n + API) |
| `N8N_API_KEY` | — | API n8n (Settings → API) |
| `N8N_WORKFLOW_ID` | — | ID workflow OK |
| `N8N_WEBHOOK_PATH` | `historico-run` | Webhook histórico (Fase 0 n8n) |
| `CONTROL_POLL_INTERVAL_SEC` | `600` | Pulso **10 minutos** |
| `CONTROL_EXEC_TIMEOUT_MIN` | `15` | Cancelar ejecución colgada |
| `CONTROL_SCHEDULER_ENABLED` | `true` | Apagar scheduler en dev |
| `PROGRAM_RANGE_START` | `2026-01-01` | Inicio calendario |
| `PROGRAM_RANGE_END` | `2027-06-30` | Fin calendario |
| `CONTROL_CORS_ORIGINS` | `:7201` | CORS FastAPI |

La API construye:

```text
DATABASE_URL=postgresql://telemetria_app:${TELEMETRIA_DB_PASSWORD}@postgres-telemetria:5432/telemetria
```

---

## Arranque

```bash
cd infra
cp .env.example .env    # editar passwords y N8N_*
docker exec -i postgres-telemetria psql -U telemetria_app -d telemetria \
  < postgres/06-control-correo.sql
docker compose up -d --build
docker compose ps
```

Solo control:

```bash
docker compose up -d --build control-correo-api control-correo-web
```

Comprobar:

```bash
curl -s http://127.0.0.1:7201/health
curl -s http://127.0.0.1:7201/api/v1/dashboard
```

---

## API REST (backend)

Prefijo: `/api/v1`

| Método | Ruta | Datos |
|--------|------|-------|
| GET | `/dashboard` | Progreso 546 días, ventana, mes activo, pausa |
| GET | `/history/days?from=&to=` | Filas `email_history_day` |
| GET | `/history/days/{date}` | Un día |
| GET | `/history/summary?year=` | Resumen mensual |
| GET | `/trace` | Lista paginada matches |
| GET | `/trace/{message_id}` | Detalle + adjuntos |
| GET | `/schedule` | Meses programados |
| PUT | `/schedule/{year}/{month}?enabled=` | Habilitar mes |
| GET | `/runs` | Log `control_run` |
| GET | `/runs/current` | Estado scheduler + n8n running |
| POST | `/runs/pause` | Pausar |
| POST | `/runs/resume` | Reanudar |

---

## Frontend — puerto 7201

| Ruta UI | Contenido |
|---------|-----------|
| `/` | Dashboard: % completado, ventana n8n, pendiente |
| `/history` | Tabla días: listados / procesados / match |
| `/trace` | Correos seleccionados (`email_trace`) |
| `/runs` | Log de lanzamientos y reintentos |

Polling UI: **30 s**. Scheduler crítico: **600 s** en backend.

En producción nginx sirve estáticos y proxy `/api` → `control-correo-api:7200`.

Desarrollo local:

```bash
cd control_correo/frontend && npm install && npm run dev
cd control_correo/backend && pip install -r requirements.txt \
  && DATABASE_URL=... uvicorn app.main:app --port 7200
```

---

## Lógica del scheduler (resumen)

Implementada en `backend/app/services/planner.py` + `scheduler.py`.

1. Lee días **`completed`** en `email_history_day` (`analyzed_date`).
2. Primer pendiente **D** en orden cronológico (mes habilitado en `control_schedule`).
3. Ventana **W = [D, D+1]** → envía a n8n.
4. Cada **10 min**:
   - Si **ninguno** de W completado → **retry_same** (repetir W).
   - Si solo **D** completado → **slide_window** (D+1, D+2).
   - Si **ambos** completados → siguiente par.
5. Registra en **`control_run`**.

Tiempo validado por día en n8n: **3–5 min** → 10 min es margen suficiente.

---

## Prerrequisito n8n (Fase 0) — implementado

El workflow `workflow_ok.json` incluye:

| Nodo | Rol |
|------|-----|
| **Webhook histórico** | `POST …/webhook/historico-run` |
| **Config histórico API** | Normaliza body → mismo schema que Config histórico |

Flujo webhook:

```text
Webhook histórico → Config histórico API → Obtener días analizados → …
```

### Body JSON

```json
{
  "mode": "historical",
  "startDate": "2026-01-16",
  "endDate": "2026-01-17"
}
```

Campos opcionales: `tzOffsetHours`, `skipKnownInDb`, `keywords`, `telemetriaVariants`.

### URLs (n8n en `WEBHOOK_URL`)

| Estado workflow | URL |
|-----------------|-----|
| **Activo** (producción) | `https://ztrack.app/automatico/webhook/historico-run` |
| Inactivo (prueba UI) | `https://ztrack.app/automatico/webhook-test/historico-run` |

Prueba manual:

```bash
curl -sS -X POST 'https://ztrack.app/automatico/webhook/historico-run' \
  -H 'Content-Type: application/json' \
  -d '{"mode":"historical","startDate":"2026-01-16","endDate":"2026-01-17"}'
```

Desde Docker (red interna):

```bash
curl -sS -X POST 'http://n8n-telemetria:5678/webhook/historico-run' \
  -H 'Content-Type: application/json' \
  -d '{"mode":"historical","startDate":"2026-01-16","endDate":"2026-01-17"}'
```

**Importante:** activar el workflow en n8n para que `/webhook/` (no `-test`) responda.

### Fallback API

Si el webhook devuelve 404 y están configurados `N8N_API_KEY` + `N8N_WORKFLOW_ID`,
`control-correo-api` usa `POST /api/v1/workflows/{id}/run`.

### Código

- Normalizador: `code-nodes/00c-webhook-config-historico.js`
- Nodos que leen config: priorizan **Config histórico API** en `getCfg()`

---

## Implicancias

| Tema | Detalle |
|------|---------|
| **Una BD** | App y n8n comparten `telemetria`; no crear segunda base |
| **Migración 06** | Manual en BD existente; `schema.sql` init no re-ejecuta scripts |
| **Puerto 7201** | Exponer con auth; muestra cuerpos de correo |
| **API key n8n** | Solo en backend; nunca en React |
| **Una ejecución histórica** | Scheduler no lanza si n8n ya tiene `running` |
| **Cron incremental n8n** | Puede convivir; evitar solapar carga Gmail en horario pico |

---

## Alternativas de despliegue

| Opción | Descripción |
|--------|-------------|
| **Integrado (actual)** | Servicios en `infra/docker-compose.yml` |
| **Compose overlay** | `docker compose -f docker-compose.yml -f control-compose.yml` |
| **Solo API en host** | `uvicorn` local apuntando a Postgres Docker |
| **Sin scheduler** | `CONTROL_SCHEDULER_ENABLED=false`; solo UI consulta |

---

## Evolución prevista

| Fase | Entrega |
|------|---------|
| **Hecho** | Estructura repo, Docker, migración SQL, API MVP, UI MVP |
| **Siguiente** | ~~Webhook histórico en `workflow_ok.json`~~ (hecho) |
| | Detalle correo en UI (modal `/trace/{id}`) |
| | Calendario heatmap + programación meses en React |
| | Timeout n8n + cancelación automática en scheduler |
| | Auth básica nginx o OAuth |

---

## Criterios de verificación

- [ ] `06-control-correo.sql` aplicado; 18 filas en `control_schedule`
- [ ] `docker compose ps` muestra `control-correo-api` y `control-correo-web` healthy
- [ ] http://161.132.53.51:7201 carga dashboard
- [ ] `/api/v1/history/days` refleja datos reales de n8n
- [ ] Con `N8N_API_KEY`, cada 10 min aparece fila en `control_run`
- [ ] Pausa/resume actualiza `control_state.paused`

---

## Referencias cruzadas

| Documento | Contenido |
|-----------|-----------|
| [programa_control.md](./programa_control.md) | RF-1…RF-6, algoritmo ventana 2 días |
| [correos_historicos.md](./correos_historicos.md) | Flujo n8n historical |
| [implicancias_proceso.md](./implicancias_proceso.md) | Tiempos 3–5 min/día, no paralelo |
| [control_correo/README.md](./control_correo/README.md) | Arranque rápido |
