# Fase 2 — Filtrado: solo recibidos + telemetria + Luis/Eusebio

**Objetivo:** procesar **solo correos recibidos** (no enviados por la cuenta
`telemetria@zgroup.com.pe`) que mencionen **telemetria** y además **Luis** o
**Eusebio** en asunto o cuerpo.

**Prerrequisitos:** [fase_1.md](./fase_1.md) completada.

**Estado en el repo:** implementado en **Configuración**, **Construir consulta
Gmail**, y nodo **Filtrar recibidos relevantes** (`code-nodes/07-filtrar-recibidos-relevantes.js`).

**Siguiente fase:** [fase_3.md](./fase_3.md)

---

## Regla de negocio

| Condición | Debe cumplirse |
|-----------|----------------|
| Dirección | **Recibido** (no enviado por la cuenta monitoreada) |
| Palabra base | **telemetria** / **telemtria** / **telemetrai** (sin distinguir mayúsculas) |
| Persona | **Luis** **o** **Eusebio** (palabra completa, sin distinguir mayúsculas) |

Lógica: `telemetria-variante AND (Luis OR Eusebio)`

Campos guardados si pasa el filtro:

- `match_telemetria_pos` — posición en el texto
- `match_person_pos` — posición de la persona
- `match_person_keyword` — texto exacto encontrado (ej. `EUSEBIO`)

Ver también: [desafios_busqueda_incremental.md](./desafios_busqueda_incremental.md)

---

## Paso 1 — Configuración (nodo Set)

Valores por defecto en `workflow.json`:

```
receivedOnly         = true
monitorMailbox       = telemetria@zgroup.com.pe
keywordFilterEnabled = true
requiredKeyword      = telemetria
keywords             = ["Luis", "Eusebio"]
```

---

## Paso 2 — Query de Gmail (filtro en servidor)

**Construir consulta Gmail** genera, por ejemplo:

```
after:1782536400 before:1782622800 -in:sent -from:telemetria@zgroup.com.pe telemetria ("Luis" OR "Eusebio")
```

| Fragmento | Efecto |
|-----------|--------|
| `-in:sent` | Excluye carpeta Enviados |
| `-from:telemetria@zgroup.com.pe` | Excluye alertas/correos originados por la cuenta |
| `telemetria ("Luis" OR "Eusebio")` | Pre-filtra en el índice de Gmail |

Esto reduce volumen **antes** de descargar el cuerpo.

---

## Paso 3 — Filtro post-normalización (doble verificación)

Gmail no indexa siempre igual el cuerpo. Tras **Normalizar correo**, el nodo
**Filtrar recibidos relevantes**:

1. Descarta si `from_address` contiene `telemetria@zgroup.com.pe` o label `SENT`.
2. Exige `telemetria` + (`Luis` o `Eusebio`) en `subject`, `body_text` o `snippet`.
3. Normaliza acentos (`José` ≈ `Jose`).

Solo los que pasan llegan a **Guardar trazabilidad**.

Flujo:

```
Normalizar correo
      ▼
Filtrar recibidos relevantes ──NO──► (fin, no se guarda)
      │
     SÍ
      ├─► Preparar trazabilidad → Guardar trazabilidad
      └─► Expandir adjuntos → Guardar referencia adjuntos
```

---

## Paso 4 — Limpiar registros enviados ya guardados

Si antes del filtro quedaron filas de **ZTRACK TELEMETRY** (enviados), bórralas
en Adminer:

```sql
DELETE FROM email_trace
WHERE from_address ILIKE '%telemetria@zgroup.com.pe%';

DELETE FROM email_attachment_ref
WHERE message_id NOT IN (SELECT message_id FROM email_trace);
```

---

## Verificación

| Caso | ¿Se guarda? |
|------|-------------|
| Alerta enviada por `telemetria@zgroup.com.pe` | No |
| Recibido: asunto con "telemetria" y cuerpo menciona "Luis" | Sí |
| Recibido: solo "Luis" sin "telemetria" | No |
| Recibido: "telemetria" + "Eusebio" en cuerpo | Sí |
| Recibido: operaciones genérico sin keywords | No |

Consulta de control:

```sql
SELECT from_address, subject, left(body_text, 80)
FROM email_trace
ORDER BY reviewed_at DESC
LIMIT 10;
```

---

## Ampliar personas o palabras

Solo edita **Configuración** (sin tocar código):

```
keywords = ["Luis", "Eusebio", "Pedro"]
requiredKeyword = telemetria
```

---

## Checklist de cierre F2

- [ ] `receivedOnly = true` — no aparecen enviados de ZTRACK TELEMETRY
- [ ] Query Gmail incluye `-in:sent` y `telemetria ("Luis" OR "Eusebio")`
- [ ] Nodo **Filtrar recibidos relevantes** conectado entre Normalizar y Guardar
- [ ] SQL de limpieza ejecutado si había datos previos
- [ ] Correo de prueba recibido con keywords → aparece en `email_trace`

**Siguiente:** [fase_3.md](./fase_3.md) — alertas por Telegram.
