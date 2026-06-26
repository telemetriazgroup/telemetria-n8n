# Trazabilidad de correos — Automatización de telemetría con n8n

Sistema de automatización para correos de instalaciones de telemetría. n8n orquesta
la lectura de Gmail, el filtrado, la persistencia en PostgreSQL y (en fases
posteriores) notificaciones, integración REST, IA y respuesta asistida.

**Estado actual del repo:** base operativa de **F1** (lectura + anti-duplicados) y
trazabilidad parcial de **F4** (`email_trace` + referencias de adjuntos). El resto
de fases se implementan siguiendo las guías paso a paso.

---

## Documentación del proyecto

| Documento | Contenido |
|-----------|-----------|
| [plan_fases_telemetria.md](./plan_fases_telemetria.md) | Visión, arquitectura, criterios de éxito y riesgos por fase |
| [fase_0.md](./fase_0.md) | Infraestructura: n8n :7001, proxy `/automatico/`, PostgreSQL, OAuth |
| [fase_0_implicancias.md](./fase_0_implicancias.md) | Topología, subruta, WebSocket, OAuth, riesgos |
| [fase_1.md](./fase_1.md) | Lectura de Gmail, esquema BD, workflow base, anti-duplicados |
| [fase_2.md](./fase_2.md) | Filtro por palabras clave configurable |
| [fase_3.md](./fase_3.md) | Notificación por Telegram (MVP visible) |
| [fase_4.md](./fase_4.md) | Hilos, máquina de estados y contexto completo |
| [fase_5.md](./fase_5.md) | Integración REST con la aplicación de gestión |
| [fase_6.md](./fase_6.md) | Enriquecimiento con IA (Groq) |
| [fase_7.md](./fase_7.md) | Respuesta asistida o automática vía Gmail |
| [fase_8.md](./fase_8.md) | Robustez, logs, reintentos y multi-cuenta |

### Orden recomendado

```
F0 → F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8
         ↑              ↑
    trazabilidad    valor visible
    en BD           (Telegram)
```

F3 puede adelantarse justo después de F2 para demostrar valor a stakeholders, pero
F4 debe estar sólida antes de F5 (REST) y F7 (respuestas).

---

## Roadmap — estado por fase

| Fase | Entrega | En este repo | Guía |
|------|---------|--------------|------|
| F0 | Infraestructura y persistencia base | Archivos en `infra/` | [fase_0.md](./fase_0.md) |
| F1 | Lectura Gmail + anti-duplicados | **Implementado** | [fase_1.md](./fase_1.md) |
| F2 | Filtro por keywords | Parcial (query Gmail, off por defecto) | [fase_2.md](./fase_2.md) |
| F3 | Telegram MVP | Pendiente | [fase_3.md](./fase_3.md) |
| F4 | Hilos + máquina de estados | Parcial (solo trazabilidad) | [fase_4.md](./fase_4.md) |
| F5 | API REST | Pendiente | [fase_5.md](./fase_5.md) |
| F6 | IA (resumen / clasificación) | Pendiente | [fase_6.md](./fase_6.md) |
| F7 | Respuesta asistida | Pendiente | [fase_7.md](./fase_7.md) |
| F8 | Robustez y multi-cuenta | Pendiente | [fase_8.md](./fase_8.md) |

---

## Arquitectura objetivo

```
Gmail API ──► n8n (orquestador) ──► Filtro keywords ──► Base de datos (estado/hilos)
                     │                                          │
                     ├──► Telegram Bot (notificación)           │
                     ├──► API REST (app de gestión) ◄───────────┘
                     └──► LLM (resumen / clasificación / borradores)
                                   │
                                   └──► Respuesta asistida vía Gmail (mismo Thread ID)
```

**Stack base:** n8n telemetría en `161.132.53.51:7001/` (raíz), proxy en
`ztrack.app` mapea `/automatico/` → `:7001/`, PostgreSQL, Gmail OAuth2, Telegram.
Convive con el n8n existente en puerto 5678.

---

## Contenido del repositorio

```
telemetria-n8n/
├── plan_fases_telemetria.md        Plan estratégico (visión y riesgos)
├── fase_0.md … fase_8.md           Guías operativas paso a paso
├── fase_0_implicancias.md          Topología 7001 + proxy /automatico/
├── infra/                          Docker, Apache proxy, SQL F0
│   ├── docker-compose.yml
│   ├── .env.example
│   ├── up.sh
│   ├── apache-ztrack-automatico.conf
│   └── postgres/01-telemetria-db.sql
├── schema.sql                      Esquema PostgreSQL (trazabilidad + referencias)
├── workflow.json                   Workflow de n8n importable (F1)
├── code-nodes/
│   ├── 01-construir-consulta.js    Arma la búsqueda Gmail (hoy / rango)
│   ├── 02-normalizar.js            Extrae solo texto + referencias de adjuntos
│   └── 03-expandir-adjuntos.js     Una fila por referencia de adjunto
└── README.md
```

---

## Inicio rápido (F0 + F1)

1. **[fase_0_implicancias.md](./fase_0_implicancias.md)** — Leer topología y requisitos.
2. **[fase_0.md](./fase_0.md)** — Levantar n8n en `161.132.53.51:7001`, proxy en
   `https://ztrack.app/automatico/`, credenciales.
3. **[fase_1.md](./fase_1.md)** — Crear tablas, importar workflow, conectar Gmail y Postgres.

---

## Qué hace el flujo actual (F1)

```
Programar revisión (cron)
      │
      ▼
Configuración           ← hoy / rango / palabras clave
      │
      ▼
Construir consulta Gmail  ← after:<epoch> before:<epoch>
      │
      ▼
Leer Gmail (Get Many)     ← Simplify = OFF (mensaje completo)
      │
      ▼
Normalizar correo         ← SOLO texto + referencias de adjuntos
      ├──────────────► Guardar trazabilidad          (tabla email_trace)
      │
      ▼
Expandir adjuntos ──────► Guardar referencia adjuntos (tabla email_attachment_ref)
```

Los **adjuntos e imágenes NO se almacenan como datos del sistema**: solo su
**referencia** (nombre + `attachment_id` + enlace al correo en Gmail).

---

## Configuración del workflow

Todo se controla en el nodo **Configuración**, sin tocar la lógica:

| Campo | Para revisar HOY | Para revisar un RANGO |
|-------|------------------|-----------------------|
| `mode` | `today` | `range` |
| `startDate` | (se ignora) | `2026-06-01` |
| `endDate` | (se ignora) | `2026-06-26` |
| `tzOffsetHours` | `-5` (Lima) | `-5` (Lima) |
| `keywordFilterEnabled` | `false` (todo) o `true` (filtrar) | igual |
| `keywords` | `["Eusebio", "Luis"]` | ampliable |

Detalle del filtro por keywords: **[fase_2.md](./fase_2.md)**.

---

## Modelo de datos actual

### `email_trace` — un registro por correo (solo texto)
`message_id` (único), `thread_id`, remitente, destinatarios, asunto, fecha,
`body_text`, `snippet`, `has_attachments`, `gmail_link`, `search_query`,
`review_mode`, `reviewed_at`.

### `email_attachment_ref` — solo referencias de adjuntos
`filename`, `mime_type`, `size_bytes`, `attachment_id`, `gmail_link`.

Consultas útiles y recuperación de adjuntos: ver **[fase_1.md](./fase_1.md)**.

---

## Anti-duplicados

Garantizado por PostgreSQL (`UNIQUE` en `message_id`) y **Skip on conflict** en
los nodos Postgres. Reejecutar el flujo no crea duplicados.

---

## Criterios de sistema integrado

El sistema se considera completo cuando cumple los 7 criterios del
[plan_fases_telemetria.md](./plan_fases_telemetria.md#criterios-de-totalmente-integrado).
Esta base cubre hoy los puntos 1 (lectura sin duplicar) y parte del 3 (persistencia
sin máquina de estados).
