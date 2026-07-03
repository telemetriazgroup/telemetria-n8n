# Diagnóstico — ejecución colgada en «Leer Gmail»

Guía para saber si el problema es **Gmail API**, **n8n** o el **nodo siguiente**
(Filtrar recibidos relevantes).

Relacionado: [flujo_api_gmail.md](../flujo_api_gmail.md) · [implicancias_proceso.md](../implicancias_proceso.md)

---

## Qué hace «Leer Gmail» en este workflow

```536:543:workflow_ok.json
        "resource": "message",
        "operation": "get",
        "messageId": "={{ $json.id }}",
        "simple": false,
        "options": {
          "downloadAttachments": false
        }
```

- **Una llamada `messages.get` por cada item** (no es un solo GET).
- **Simplify OFF** → descarga MIME completo (puede ser muy grande en hilos).
- n8n ejecuta los items **en serie** (no 48 en paralelo).

Tiempo esperado orientativo:

| Correos del día | Solo Leer Gmail (serie) |
|---------------|-------------------------|
| 10 | ~30 s – 2 min |
| 48 | ~2 – 5 min |
| 60+ con hilos largos | 5 – 15 min |

Si supera **15–20 min** en un solo día, hay que aislar la causa.

---

## Árbol de decisión (5 minutos)

### Paso 1 — ¿Cuántos items entran a «Leer Gmail»?

En la ejecución n8n:

1. Abre **Omitir si vacío** (o **Filtrar solo nuevos**).
2. Cuenta items de salida (p. ej. **48**).

Si hay **48 items** y el log de Leer Gmail dice **~2 min**, es plausible que **aún esté procesando**
(el tiempo del log a veces es parcial hasta que termina **todos** los items).

En Postgres (día en curso):

```sql
SELECT analyzed_date, emails_listed_count, emails_processed_count, status
FROM email_history_day
ORDER BY analyzed_date DESC
LIMIT 3;
```

---

### Paso 2 — ¿El nodo siguiente ya corrió?

| Lo que ves | Interpretación |
|------------|----------------|
| Solo **Leer Gmail** en rojo / running; **Normalizar** sin ✓ | Sigue dentro de **Leer Gmail** (item lento o colgado) → ir a **Paso 3** |
| **Leer Gmail** ✓ en ~2–5 min; **Normalizar** ✓; **Filtrar recibidos** running >10 min | **No es Gmail** — cuello CPU en filtro ([implicancias_proceso.md](../implicancias_proceso.md)) |
| **Leer Gmail** ✓; todo parado sin avanzar al loop | Revisar **¿Hay correos nuevos?** / ramas históricas |

En tu captura (18 min, Normalizar sin ejecutar): **prioridad = Leer Gmail aún no terminó todos los GET**.

---

### Paso 3 — ¿API Gmail o n8n? (prueba aislada)

#### A) Probar **un solo** mensaje en n8n

1. Abre ejecución → **Filtrar solo nuevos** → copia **un** `id` (el primero).
2. Crea workflow temporal de 2 nodos:
   - **Manual Trigger**
   - **Gmail → Get** → `messageId` = ese id, Simplify OFF, Download Attachments OFF.
3. **Execute step**.

| Resultado | Conclusión |
|-----------|------------|
| < 3 s | API OK para ese mensaje; el colgado es **volumen N × serie** o **un id concreto** |
| > 30 s o timeout | Ese mensaje / credencial / red — ir a **Paso 4** |
| Error 401/403 | Credencial OAuth Gmail |
| Error 429 | Cuota / rate limit Gmail |

#### B) Probar el **mismo id** fuera de n8n (API pura)

Con token OAuth válido (misma cuenta que n8n):

```bash
MSG_ID="pega_el_id_aqui"
time curl -sS -o /tmp/msg.json -w "HTTP:%{http_code} time:%{time_total}s\n" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/${MSG_ID}?format=full"
ls -lh /tmp/msg.json
```

| Resultado | Conclusión |
|-----------|------------|
| HTTP 200 en < 2 s, JSON pequeño | API bien; n8n lento por **N serial** o carga del contenedor |
| HTTP 200 en > 10 s o JSON > 2 MB | Mensaje pesado (hilo completo) — normal que tarde |
| HTTP 429 | Límite Gmail — esperar o reducir paralelismo |
| Timeout sin respuesta | Red / proxy / firewall hacia `googleapis.com` |

Si **curl es rápido** pero n8n tarda minutos con el mismo id → **inconveniente n8n**
(memoria, versión, bug del nodo Gmail, contenedor sin CPU).

Si **curl también tarda o falla** → **inconveniente API / mensaje / OAuth**.

---

### Paso 4 — Revisar logs del contenedor n8n

```bash
docker logs n8n-telemetria --since 30m 2>&1 | tail -80
```

Buscar:

- `429` / `rateLimitExceeded` / `User-rate limit exceeded` → **Gmail API**
- `ETIMEDOUT` / `ECONNRESET` → **red**
- `OAuth` / `invalid_grant` → **credencial**
- Sin errores, CPU al 100% → posible **Filtrar recibidos** (siguiente nodo) o JS pesado

---

### Paso 5 — Google Cloud Console

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs → **Gmail API** → **Metrics**.
2. Filtra la hora de la ejecución.
3. Picos de **429** o latencia alta confirman presión en **API**.

---

## Resumen: síntoma → causa probable

| Síntoma | Causa más probable |
|---------|-------------------|
| 18 min en Leer Gmail, 40–60 items, sin error | **Normal**: N GETs en serie + cuerpos grandes |
| Un item concreto nunca termina | **Un message.get** colgado (MIME enorme o red) |
| Leer Gmail ✓ en 3 min, total > 15 min después | **Filtrar recibidos relevantes** (keyword `api`, CPU) |
| Error 401/403 en nodo | **Credencial** n8n (reconectar OAuth) |
| Error 429 | **Cuota Gmail** |
| curl rápido, n8n lento mismo id | **n8n** (recursos, serialización, UI) |

---

## Acciones inmediatas (sin cambiar workflow)

1. **Cancelar** ejecución en n8n si supera **2× timeout** del control (20 min).
2. En **control_correo** → **Reconciliar logs** (watchdog cierra «En curso»).
3. Repetir el día con **menos correos**: pausa sync → ventana manual de **un solo día** ya procesado parcialmente.
4. Anotar: `emails_listed_count`, tiempo **Leer Gmail**, tiempo **Filtrar recibidos**.

---

## Mejoras futuras (si el diagnóstico confirma volumen API)

| Problema confirmado | Mejora |
|---------------------|--------|
| Muchos GETs, pocos matches | Keywords en query Gmail (modo incremental) o `format=metadata` + Get solo candidatos |
| Un mensaje bloquea todo | Code node: timeout por id; saltar id y registrar en `note` |
| Serie muy lenta | Batch HTTP Gmail (hasta 100 subrequests) — requiere cambio de workflow |
| Filtro > Leer Gmail | Optimizar `07-filtrar-recibidos-relevantes.js` (quitar `api` suelta, early exit) |

---

## Checklist rápido

- [ ] Conté items antes de Leer Gmail
- [ ] Vi si Normalizar / Filtrar ya ejecutaron
- [ ] Probé **un** message id aislado en n8n
- [ ] (Opcional) Probé el mismo id con `curl` + token
- [ ] Revisé `docker logs n8n-telemetria`
- [ ] Consulté métricas Gmail API en Google Cloud
