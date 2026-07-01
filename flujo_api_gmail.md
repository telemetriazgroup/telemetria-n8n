# Gmail API en n8n — por qué demora y cómo acelerar

Documento de **estrategias e implicancias** para leer correos en un rango de tiempo
vía Gmail API + n8n. **No modifica** el workflow actual (`workflow_ok.json`); sirve
para decidir optimizaciones futuras con criterio.

Relacionado: [fase_1.md](./fase_1.md) · [correos_historicos.md](./correos_historicos.md) ·
[desafios_procesamiento_incremental.md](./desafios_procesamiento_incremental.md)

---

## Resumen ejecutivo

Con **60 correos** puede parecer “lento” aunque el volumen sea bajo. No suele ser
un fallo de Gmail: es la suma de **muchas llamadas HTTP secuenciales**, **payload
grande por mensaje** y **overhead de n8n** por item.

En el flujo actual, por cada día histórico:

```
messages.list (1 llamada) → Filtrar IDs nuevos → messages.get × N (1 por correo)
→ Normalizar → Filtrar keywords (telemetría + Luis/Eusebio)
```

En modo **`historical`**, el filtro de keywords ocurre **después** de descargar el
cuerpo. Si un día tiene 60 recibidos y solo 4 hacen match, igual se hacen **60
GET completos**. Eso es correcto funcionalmente (no se pierden correos por query
restrictiva en Gmail), pero explica la demora.

---

## Por qué 60 correos pueden tardar minutos

### 1. Patrón N+1 (lista + un GET por mensaje)

| Paso | API | Llamadas (60 correos) | Peso típico |
|------|-----|------------------------|-------------|
| Listar IDs | `GET /users/me/messages?q=…` | 1 (+ paginación si >500) | Ligero (solo IDs) |
| Leer cada uno | `GET /users/me/messages/{id}` | **60** | Pesado (MIME / parts) |

Cada `messages.get` con formato completo trae `payload` con `text/plain`, a veces
`text/html` (HTML citado en hilos puede ser **cientos de KB o MB** por correo).

Orden de magnitud **solo en red + Gmail** (sin n8n):

- 60 × 200–800 ms ≈ **12 s – 48 s** en serie
- Con cuerpos grandes o latencia alta: **1–3 min** es normal

### 2. n8n ejecuta nodos en serie por defecto

El nodo **Leer Gmail** corre **una vez por item**. n8n no paraleliza de forma
agresiva entre items del mismo nodo salvo configuración explícita (sub-workflow,
cola externa, batch HTTP, etc.).

Costo adicional por correo:

- Invocación del nodo Gmail nativo
- Serialización JSON entre nodos
- **Normalizar correo** recorriendo `payload.parts`
- Historial de ejecución en UI (memoria)

### 3. Modo histórico: descarga antes de filtrar

En **incremental**, la query Gmail puede incluir keywords → menos IDs listados.

En **historical** (diseño actual):

- Gmail lista **todos** los recibidos del día (`after`/`before`, `-in:sent`)
- El filtro telemetría + persona corre en **Filtrar recibidos relevantes**

Implicación: el costo API escala con **correos del día**, no con **correos con match**.

### 4. Loop día a día

Un rango de 26 días implica **26 vueltas** del subflujo (planificar → listar → leer →
registrar). Aunque cada día tenga pocos correos, hay costo fijo de Postgres,
planificación y cierre en `email_history_day` por día.

### 5. Cuotas Gmail (no suele ser el cuello con 60 correos)

Límites orientativos (cuenta Workspace / consumer vía API):

| Concepto | Valor típico |
|----------|----------------|
| Unidades por usuario por segundo | ~250 quota units/s |
| `messages.list` | 5 units |
| `messages.get` | 5 units |
| Batch HTTP (hasta 100 subrequests) | 1 llamada HTTP, cada subrequest cuenta units |

60 GETs ≈ 300 units → caben en ~1–2 s **si fueran paralelos y sin otros procesos**.
En la práctica, la latencia serial y n8n dominan antes que el rate limit.

---

## Dónde está el tiempo (checklist de diagnóstico)

Antes de optimizar, mide en una ejecución de n8n:

1. **Listar IDs Gmail** — ¿cuántos ms? ¿cuántos IDs?
2. **Leer Gmail** — ¿cuántos items? ¿tiempo total del nodo?
3. **Normalizar** — ¿proporcional a Leer Gmail?
4. **Filtrar recibidos relevantes** — ¿cuántos items salen vs entraron?

Consulta útil tras un día histórico:

```sql
SELECT analyzed_date,
       emails_listed_count,
       emails_processed_count,
       emails_match_count,
       analyzed_at
FROM email_history_day
ORDER BY analyzed_date DESC
LIMIT 5;
```

Si `listed_count = 60`, `match_count = 4`, el cuello es **descargar 56 correos
innecesarios** para el objetivo de trazabilidad (aunque sean necesarios para
auditoría “día completo”).

---

## Estrategias de aceleración (sin cambiar el flujo hoy)

Ordenadas de **menor a mayor impacto / complejidad**. Cada una indica qué tocaría
en un workflow **futuro**, no en el actual.

### A) Medir y acotar el problema

| Acción | Beneficio | Implicancia |
|--------|-----------|-------------|
| Registrar tiempos por nodo en ejecución n8n | Saber si el cuello es Gmail o Normalizar | Solo observabilidad |
| Comparar `emails_listed` vs `emails_match` | Cuantifica “descarga de más” | Ninguna en código |

---

### B) Reducir payload por mensaje (mismo número de GETs)

**Idea:** pedir menos datos en cada `messages.get`.

| Variante API | Qué trae | Sirve para filtro actual |
|--------------|----------|---------------------------|
| `format=full` (actual vía nodo Gmail Simplify OFF) | Headers + body + parts | Sí (body + headers) |
| `format=metadata` | Headers + `snippet` (~200 chars) | Parcial: headers sí; body completo no |
| `format=minimal` | Solo id, threadId, labels | No para keywords en cuerpo |
| `format=full` + `fields=…` (Field mask) | Subconjunto del recurso | Sí, si se eligen solo headers + text/plain |

**Implicancias:**

- Pasar de nodo **Gmail** a **HTTP Request** con query params (`format`, `fields`)
  da control fino pero hay que mantener OAuth y parseo en Code.
- Quitar HTML y quedarse con `text/plain` reduce mucho tamaño; hilos largos siguen
  pesando si el plain incluye citas.
- **Riesgo:** si el filtro depende de texto solo presente en HTML, `metadata` puede
  dar **falsos negativos**.

**Ganancia esperada:** 30–70 % menos tiempo de red y Normalizar, sin bajar N.

---

### C) Filtrar antes del GET completo (two-phase fetch)

**Idea:** fase 1 barata → fase 2 solo para candidatos.

```
list IDs
  → batch metadata/snippet (60 mensajes en pocas llamadas batch)
  → filtro rápido (snippet + headers)
  → full GET solo para ~5–10 candidatos
  → Normalizar + filtro estricto actual
```

**Implicancias:**

- Cambia el orden respecto al flujo actual (filtrar antes de Normalizar completo).
- El `snippet` de Gmail **no garantiza** contener la keyword (puede estar más abajo
  en el cuerpo) → riesgo de **falsos negativos** si la fase 1 es demasiado agresiva.
- Mitigación: fase 1 conservadora (pasa todo lo dudoso) + fase 2 estricta = menos
  ganancia pero más seguro.
- Encaja con modo **historical** si se acepta trade-off o se guarda en BD también
  “listados pero no descargados”.

**Ganancia esperada:** de 60 GET full a 5–15 GET full → **4–10×** en días con pocos
matches.

---

### D) Gmail Batch API (paralelizar HTTP)

**Idea:** una sola petición HTTP con hasta **100** subrequests.

```http
POST https://gmail.googleapis.com/batch/gmail/v1
Content-Type: multipart/mixed; boundary=batch_boundary

--batch_boundary
Content-Type: application/http
GET /gmail/v1/users/me/messages/{id}?format=metadata
--batch_boundary--
```

**Implicancias:**

- n8n no expone batch nativamente → nodo **HTTP Request** + **Code** para armar
  multipart o usar librería en un **Function externo** / microservicio.
- Paginación: 60 IDs = 1 batch; 600 IDs = 6 batches.
- Errores parciales: hay que reintentar subrequests fallidas (429, 5xx).
- Cuota: sigue contando 5 units × mensaje; gana **latencia**, no units.

**Ganancia esperada:** 60 GET seriales (~30 s) → 1–2 round-trips (~2–5 s) + parseo.

---

### E) Paralelismo controlado en n8n

**Idea:** procesar varios IDs en paralelo con concurrencia limitada (ej. 5–10).

Opciones típicas:

| Enfoque | Pros | Contras |
|---------|------|---------|
| Sub-workflow + **Execute Workflow** con cola | Aísla fallos | Más complejidad operativa |
| Varios HTTP Request en ramas (no escala) | Simple | No sirve para 60 items |
| Worker fuera de n8n (Python/Node) | Máximo control | Otra pieza a desplegar |
| n8n **Queue mode** + workers | Escala horizontal | Infra adicional |

**Implicancias:**

- Paralelismo alto puede disparar **429 User-rate limit exceeded**; conviene
  ventana de 5–10 concurrent max con backoff.
- Postgres `skipOnConflict` sigue siendo seguro, pero carreras en la misma
  ejecución son raras.

**Ganancia esperada:** ~linear hasta el límite de cuota (ej. 5× con 5 concurrent).

---

### F) Mover el filtro a la query Gmail (modo histórico)

**Idea:** usar en `q=` las mismas keywords que en **Filtrar recibidos relevantes**.

Ejemplo conceptual:

```
after:… before:… -in:sent (telemetria OR ztrack …) (Luis OR Eusebio)
```

**Implicancias:**

- **Pros:** menos IDs → menos GETs; alineado con modo incremental.
- **Contras:** Gmail search **no es igual** al filtro regex del Code (encabezados,
  exclusiones `@telemetria@`, typos, palabras en cuerpo vs snippet indexado).
- Documentado en [correos_historicos.md](./correos_historicos.md): en histórico se
  evitó a propósito para **no omitir correos**.
- Solo recomendable si se acepta “recuperación incompleta” o un segundo barrido de
  reconciliación.

**Ganancia esperada:** alta si el buzón tiene mucho ruido; **riesgo funcional** alto.

---

### G) Procesamiento fuera de n8n (batch nocturno)

**Idea:** script Python/Node con:

- OAuth refresh token compartido
- `messages.list` paginado
- Batch `messages.get`
- Filtro idéntico al Code actual (portar lógica de `07-filtrar-recibidos-relevantes.js`)
- Insert directo a Postgres

n8n quedaría para **disparo**, alertas y casos incrementales.

**Implicancias:**

- Duplicar lógica de negocio (drift entre script y workflow).
- Mejor para barridos históricos grandes (miles de correos).
- Operación: cron en servidor, logs, reintentos.

**Ganancia esperada:** máxima para histórico masivo; costo de mantenimiento.

---

### H) Push en lugar de pull (futuro incremental)

**Idea:** `users.watch` + Cloud Pub/Sub → notificación al llegar correo nuevo.

**Implicancias:**

- No ayuda al **histórico** ya recibido.
- Infra GCP (topic, subscription, renovación del watch cada 7 días).
- Ideal para F1 incremental sin cron cada 30 min.

---

### I) Ajustes operativos sin tocar lógica

| Ajuste | Efecto |
|--------|--------|
| `downloadAttachments: false` (ya está) | Evita binarios PDF en GET |
| Desactivar guardar ejecuciones grandes en n8n | UI más rápida; menos RAM |
| Ejecutar histórico en horario valle | No acelera API; evita competir con cron |
| Aumentar recursos del contenedor n8n | Ayuda Normalizar / JSON grande |
| Reducir rango por tanda manual | Menos días por ejecución; mismo tiempo total |

---

## Matriz de decisión rápida

| Objetivo | Estrategia recomendada | Riesgo |
|----------|------------------------|--------|
| Entender la demora | Medición por nodo + SQL `email_history_day` | Ninguno |
| Acelerar sin cambiar reglas de match | Batch API + `fields` / sin HTML | Medio (implementación) |
| Acelerar histórico con pocos matches/día | Two-phase: metadata → full solo candidatos | Medio (falsos negativos si fase 1 estricta) |
| Acelerar incremental diario | Push watch o paralelismo leve en GET | Bajo–medio |
| Máximo throughput histórico | Worker externo + batch | Alto (segundo sistema) |
| Menos correos listados | Keywords en `q=` | Alto (correos omitidos) |

---

## Estimación orientativa (60 correos, 1 día)

Supuestos: GET full serial, cuerpos medianos, filtro post-descarga, 4 matches.

| Escenario | Tiempo aprox. |
|-----------|----------------|
| Flujo actual (serial, full) | 1–3 min |
| Serial + solo `text/plain` (sin HTML) | 45 s – 1.5 min |
| Batch metadata (1–2 HTTP) + 4 GET full | 15–40 s |
| Batch 60 metadata + filtro snippet conservador + 10 GET full | 20–50 s |
| 10 GET paralelos (6 waves) | 20–60 s |

Tiempos reales dependen de latencia a Google, tamaño de hilos y carga del host n8n.

---

## Implicancias de negocio vs velocidad

1. **Completitud del histórico** — listar todo el día y filtrar después es más lento
   pero auditable (`message_ids_listed` vs `message_ids_match` en
   `email_history_day`).

2. **Consistencia del filtro** — cualquier optimización que no use el mismo texto
   que **Filtrar recibidos relevantes** debe validarse con un set de correos de
   prueba (golden set).

3. **Idempotencia** — `message_id` UNIQUE + skip known sigue siendo la red de
   seguridad al reintentar.

4. **Costo de mantenimiento** — Batch HTTP y two-phase en n8n Code suben complejidad;
   un script externo es más rápido en runtime pero más caro en operación.

---

## Roadmap sugerido (cuando decidan optimizar)

Fases incrementales **sin romper** el workflow actual:

1. **Observabilidad** — anotar en `email_history_day` duración opcional o log en
   Code al cerrar día (listed vs match vs tiempo).

2. **Quick win de payload** — HTTP GET con `format=full` + field mask excluyendo
   parts HTML innecesarios (misma semántica de filtro).

3. **Batch metadata** — nuevo workflow experimental `workflow_gmail_batch.json` que
   no reemplaza al OK hasta validar paridad de matches.

4. **Worker histórico** — solo si el rango supera miles de correos o n8n se queda
   sin memoria.

---

## Referencia API Gmail (lectura)

| Operación | Uso en proyecto actual |
|-----------|-------------------------|
| `users.messages.list` | **Listar IDs Gmail** (HTTP Request) |
| `users.messages.get` | **Leer Gmail** (nodo Gmail, Simplify OFF) |
| `users.messages.batchModify` | No usado (labels) |
| Batch multipart | No usado (oportunidad) |
| `users.history.list` | No usado (sync incremental alternativo) |

Documentación oficial:

- [Gmail API – Usage limits](https://developers.google.com/gmail/api/reference/quota)
- [messages.list](https://developers.google.com/gmail/api/reference/rest/v1/users.messages/list)
- [messages.get](https://developers.google.com/gmail/api/reference/rest/v1/users.messages/get)
- [Batch requests](https://developers.google.com/gmail/api/guides/batch)

---

## Conclusión

Que **60 correos** tarden **varios minutos** en n8n con el flujo actual es **esperable**:
son ~60 viajes de ida y vuelta con cuerpo completo, más procesamiento por item, y en
histórico se descargan **todos** los recibidos del día aunque pocos hagan match.

La aceleración más alineada con las reglas actuales (sin perder completitud del día)
suele ser:

1. **Batch API** para reducir latencia de red.
2. **Two-phase fetch** (metadata/snippet → full solo candidatos) con fase 1 conservadora.
3. **Recortar payload** (plain text, field masks, sin HTML).

La aceleración más simple pero **arriesgada** para histórico es filtrar en la query
Gmail; contradice el diseño documentado en [correos_historicos.md](./correos_historicos.md).

Este documento no altera `workflow_ok.json`; cuando elijan una estrategia, conviene
prototiparla en un workflow separado y comparar `emails_match_count` contra una
ejecución de referencia del flujo OK.
