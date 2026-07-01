# Implicancias del proceso — diagnóstico de tiempos en n8n

Análisis de **por qué el workflow tarda tanto**, cuellos de botella en
**Filtrar recibidos relevantes**, y **riesgos de consultar varios días en paralelo**
a Gmail. No modifica `workflow_ok.json`.

Relacionado: [flujo_api_gmail.md](./flujo_api_gmail.md) · [correos_historicos.md](./correos_historicos.md) ·
[desafios_procesamiento_incremental.md](./desafios_procesamiento_incremental.md) ·
`code-nodes/07-filtrar-recibidos-relevantes.js`

---

## Resumen ejecutivo

En una ejecución real (modo histórico, un día del rango), los tiempos observados
fueron aproximadamente:

| Nodo | Tiempo | Rol |
|------|--------|-----|
| Planificar días pendientes | ~7 s | Elige el día a procesar |
| Construir consulta Gmail | ~12 s | Arma query `after`/`before` |
| Filtrar solo nuevos | ~11 s | Cruza IDs Gmail vs BD |
| Listar IDs Gmail | ~0,5 s | API ligera |
| Leer Gmail | ~1 min 37 s | **N × GET** cuerpo completo |
| Normalizar correo | ~3 s | Parseo MIME → `body_text` |
| **Filtrar recibidos relevantes** | **>5 min** (y subiendo) | **Cuello de botella CPU** |

Total de ejecución en pantalla: **>11 min** para un solo día.

Conclusión: **no es solo la API de Gmail**. Después de descargar los correos, el
filtro de keywords en JavaScript puede consumir **más tiempo que Leer Gmail**, sobre
todo en modo **historical** cuando se procesan **todos** los recibidos del día y
**casi ninguno** hace match.

---

## Qué hace el nodo lento

**Filtrar recibidos relevantes** (`07-filtrar-recibidos-relevantes.js`) corre en modo
**Run Once for All Items**: una sola ejecución de Code procesa **todos** los correos
normalizados del día.

Por cada correo:

1. Descarta enviados (`from` monitor o label `SENT`).
2. Construye un **haystack** = `subject + body_text + snippet`.
3. Busca **una** keyword de telemetría entre 7 variantes:
   `telemetria`, `telemtria`, `telemetrai`, `ztrack`, **`api`**, `software`, `plataforma`.
4. Si encuentra telemetría, busca **Luis** o **Eusebio** con la misma lógica.
5. Cada coincidencia pasa por validación estricta de contexto (no correo en encabezado,
   no dentro de `usuario@dominio`, no en listas Para/CC, etc.).
6. Si pasa, calcula excerpts (~120 caracteres alrededor del match).

Solo los que cumplen **telemetría AND (Luis OR Eusebio)** siguen a Guardar trazabilidad.

En histórico, si **ningún** correo hace match pero sí hubo correos leídos, emite
`_cerrarDiaHistorico` para cerrar el día igual.

---

## Causas raíz (ordenadas por impacto)

### 1. Palabra clave **`api`** — alta frecuencia, costo multiplicado

La variante **`api`** está en `telemetriaVariants` (Config histórico / Configuración).

En correos técnicos, `api` aparece muchas veces como palabra suelta:

- URLs (`api.example.com` a veces no coincide `\b`, pero sí frases con “API REST”, “la API”, etc.)
- Documentación, logs, hilos largos de soporte

El algoritmo usa:

```javascript
const re = new RegExp(`\\b${escapeRe(kw)}\\b`, 'gi');
while ((m = re.exec(haystack)) !== null) {
  if (isInvalidMatchContext(haystack, start, end)) continue;
  // ...
}
```

Implicación: **no se detiene en la primera aparición inválida**. Recorre **todo**
el haystack para **cada** keyword hasta agotar matches o encontrar uno válido.

Ejemplo orientativo:

| Escenario | Ocurrencias de `\bapi\b` en un cuerpo | Validaciones `isInvalidMatchContext` |
|-----------|----------------------------------------|--------------------------------------|
| Hilo corto | 5–20 | 5–20 |
| Hilo largo / log | 100–500+ | 100–500+ |
| 40 correos × 150 ocurrencias | — | **6 000+** ciclos de funciones pesadas |

`isInvalidMatchContext` encadena **cuatro** comprobaciones con `slice`, regex y bucles
sobre ventanas de hasta ~360 caracteres por match.

**Por qué Normalizar tarda ~3 s y el filtro >5 min:** Normalizar recorre el MIME **una
vez** por correo. El filtro puede recorrer el **mismo texto 7 veces** (una por variante
de telemetría) y, en el peor caso, cientos de veces por **`api`**.

---

### 2. Modo **historical**: muchos correos entrando, pocos saliendo

En histórico, Gmail lista **todos** los recibidos del día (sin keywords en la query).
El filtro se aplica **después** de descargar cada uno.

Si un día tiene **40–60 recibidos** y solo **2–5** son relevantes:

- **Leer Gmail** paga el costo de 40–60 GET (≈1,5 min en tu traza).
- **Filtrar recibidos** ejecuta la lógica completa de keywords en **los 40–60**, no solo en los matches.

Los correos que **no** tienen telemetría igual recorren hasta **7 búsquedas** completas
en el haystack (una por variante) antes de descartarse.

---

### 3. Haystack grande: `body_text` de hilos completos

**Normalizar correo** deja en `body_text` el texto plano (o HTML strip) del mensaje.
En respuestas encadenadas es habitual ver **50 KB – 500 KB+** por item.

El haystack concatena además `subject` y `snippet`, con solapamiento parcial.

Costo aproximado por correo sin match:

```
7 variantes × tamaño_haystack × (regex + N_ocurrencias × contexto)
```

Con 50 correos de 200 KB promedio, el filtro mueve **decenas de MB** en CPU en un solo
nodo Code, en **un hilo** de Node.js dentro del contenedor n8n.

---

### 4. Una sola ejecución Code para todos los items

n8n agrupa la salida de **Normalizar correo** y ejecuta **un** script para todos.

Efectos:

| Efecto | Implicancia |
|--------|-------------|
| Sin paralelismo | Un core CPU al 100 % durante minutos |
| Memoria | `$input.all()` retiene todos los JSON en RAM |
| UI | El nodo muestra “Running for Xm” sin progreso intermedio — parece colgado pero sigue calculando |
| GC | Strings grandes + regex → presión de garbage collector |

---

### 5. Orden de keywords: variantes raras antes que **`api`**

Orden actual: `telemetria` → `telemtria` → `telemetrai` → `ztrack` → **`api`** → …

Correos sin telemetría explícita ya pagaron 4 barridos completos antes de llegar a
`api`, que suele ser la más “ruidosa”.

---

### 6. Otros nodos lentos (secundarios en esta traza)

No explican los 5+ min del filtro, pero suman al total del día:

| Nodo | ~Tiempo | Posible causa |
|------|---------|----------------|
| Planificar días pendientes | 7 s | Lectura `$('Obtener días analizados').all()` + bucle de fechas |
| Construir consulta Gmail | 12 s | Resolución de nodos previos; no debería ser tan alto — revisar carga del host |
| Filtrar solo nuevos | 11 s | `$('Obtener IDs en BD').all()` + iteración; posible muchos IDs en BD |

Si el servidor n8n comparte CPU/RAM con otros servicios, **todos** los nodos Code se
inflan.

---

## Por qué parece “trabado” y no falla

El nodo **no está esperando red** (Gmail ya terminó). Está en **CPU-bound** puro:

- No hay timeout corto en nodos Code por defecto.
- La barra de progreso de n8n no avanza por item dentro del mismo nodo.
- Con 5–15 min en un día muy cargado, el comportamiento puede ser **normal** con la
  lógica actual, no necesariamente un deadlock.

Señales de que **sí** hay problema distinto (OOM / crash):

- Ejecución pasa a **Failed** con `JavaScript heap out of memory`.
- Contenedor n8n reiniciado por el healthcheck.
- Tiempo >30 min con pocos correos (<10).

---

## Diagnóstico práctico (sin cambiar el workflow)

### A) Cuántos correos procesó ese día

Tras cerrar el día (o si ya hay fila en BD):

```sql
SELECT analyzed_date,
       emails_listed_count,
       emails_processed_count,
       emails_match_count
FROM email_history_day
ORDER BY analyzed_at DESC
LIMIT 5;
```

Interpretación:

| listed | match | Lectura |
|--------|-------|---------|
| 60 | 3 | Filtro evaluó ~60 haysacks; 57 descartados con costo completo |
| 60 | 0 | Peor caso: 7 barridos × 60 correos, luego `_cerrarDiaHistorico` |

---

### B) Tamaño de datos en la ejecución n8n

En la ejecución, abrir **Normalizar correo → Output → JSON**:

- Contar **items** (número de correos).
- En 2–3 items al azar, revisar longitud de `body_text` (pegar en editor y ver KB).

Regla empírica:

- `< 20 KB` por correo → filtro debería ser segundos–decenas de s.
- **`> 100 KB` en varios items** → minutos con keywords amplias (`api`, `software`).

---

### C) Aislar si el cuello es **`api`**

Prueba manual **fuera de producción** (copiar un `body_text` grande a un script local
o consola Node):

```javascript
const haystack = '…'; // pegar body_text de un correo lento
const re = /\bapi\b/gi;
let n = 0;
while (re.exec(haystack)) n++;
console.log('ocurrencias api:', n);
```

Si `n > 50` en varios correos del día, la causa #1 está confirmada.

---

### D) Recursos del contenedor n8n

```bash
docker stats n8n-telemetria --no-stream
```

Durante **Filtrar recibidos relevantes**:

- **CPU ~100 %** de un core → CPU-bound (esperado).
- **RAM subiendo** sin tope → riesgo OOM con muchos cuerpos grandes.

Revisar límites en `infra/docker-compose.yml` (memoria/CPU del servicio n8n).

---

### E) Comparar tiempos por nodo en la misma ejecución

En n8n → Executions → workflow → vista de árbol (como en tu captura).

Orden esperado de magnitud **por día histórico típico**:

```
Listar IDs     < 1 s
Leer Gmail     ~1–3 min   (depende de N y tamaño MIME)
Normalizar     ~2–10 s
Filtrar recv.  ~30 s – 10 min   ← donde explota si N×body×api
Registrar día  < 5 s
```

Si **Filtrar recibidos** supera **Leer Gmail**, el problema es el algoritmo de filtro,
no la API.

---

## Modelo mental del costo

```
Tiempo_filtrar ≈ Σ (por cada correo recibido) [
    Σ (por cada variante telemetría hasta match o agotar) [
        escaneo_regex(haystack)
        + ocurrencias × costo_contexto(isInvalidMatchContext)
    ]
    + (si hubo tel) escaneo_personas
]
```

Factores que más multiplican:

1. **`emails_processed_count`** alto (histórico).
2. **`body_text`** largo.
3. Keywords frecuentes: **`api`**, **`software`**, **`plataforma`**.
4. **`isInvalidMatchContext`** ejecutada en cada match, no solo en el primero.

---

## Implicancias de negocio

| Decisión actual | Beneficio | Costo en tiempo |
|-----------------|-----------|-----------------|
| Histórico lista todo el día | No se pierden correos por query Gmail restrictiva | Muchos GET + filtro sobre todos |
| Filtro estricto post-descarga | Match fiable (headers vs cuerpo) | CPU alto en Code |
| Variantes amplias incl. `api` | Captura más casos de telemetría | Falsos positivos de búsqueda + muchas iteraciones |
| Excerpts y posiciones en BD | Trazabilidad F2/F4 | Cálculo extra por match (bajo vs barrido `api`) |

---

## Estrategias de mejora (futuro — no aplicadas al workflow OK)

Prioridad sugerida si se decide optimizar **sin relajar reglas de negocio**:

### Quick wins (solo configuración / código del filtro)

| Cambio | Efecto | Riesgo |
|--------|--------|--------|
| Quitar **`api`** de `telemetriaVariants` o sustituir por frases (`ztrack api`, `api telemetria`) | Menos ocurrencias `\bapi\b` | Pierde matches donde solo dice “api” |
| Reordenar: probar `telemetria`, `ztrack` antes; **`api` al final** con **break** al primer match válido | Mismo resultado, menos trabajo si hay match temprano | Bajo |
| **Early exit** por variante: dejar de buscar otras variantes tel tras primer match válido | Reduce de 7 barridos a 1 | Bajo |
| Limitar longitud de haystack (ej. primeros 50 KB de `body_text`) | Cap de tiempo | Puede perder match al final de hilos largos |
| Buscar primero en `subject`+`snippet`; solo si falla, usar `body_text` | Menos texto en la mayoría | Match solo en cuerpo profundo se retrasa |

### Cambios estructurales (workflow alternativo)

| Cambio | Efecto | Riesgo |
|--------|--------|--------|
| Filtrar en query Gmail en histórico | Menos correos descargados | Correos omitidos (ver [correos_historicos.md](./correos_historicos.md)) |
| Two-phase: snippet/metadata antes de GET full | Menos bytes en Normalizar/Filtrar | Paridad de filtro a validar |
| Filtro en worker Python/Node fuera de n8n | Mejor perf + batch | Duplicar lógica |
| Code **Run Once for Each Item** + sub-workflow | Progreso visible por correo | Más overhead n8n por item |

Detalle de aceleración API: [flujo_api_gmail.md](./flujo_api_gmail.md).

---

## ¿Se pueden consultar varios días en paralelo a Gmail?

### Diseño actual del workflow OK (secuencial)

En `workflow_ok.json` el modo **historical** **no** consulta varios días a la vez.
Procesa **un solo `processDate` por vuelta**:

```
Planificar (1 día) → Construir consulta → Listar → Leer → … → Guardar resumen día
  → Obtener días analizados → Planificar (siguiente día) → …
```

`09-planificar-dias-historicos.js` devuelve explícitamente **solo el primer día
pendiente**; el loop cierra el día en `email_history_day` antes de planificar el
siguiente.

Eso es **intencional**: trazabilidad por día, emparejamiento de items en n8n y
menor riesgo de cuota / memoria.

---

### Qué significaría “paralelo”

| Nivel | Qué haría | ¿Lo soporta el OK hoy? |
|-------|-----------|-------------------------|
| **A — Varios días en la misma ejecución** | Planificar emite N items (2025-12-01…05); Construir/Listar/Leer corren para N queries distintas a la vez | **No** — rompe emparejamiento y `Registrar día histórico` |
| **B — Paralelo solo en API (mismo día)** | Varios `messages.get` concurrentes para IDs del mismo día | **No configurado** — Leer Gmail es serial por item |
| **C — Varias ejecuciones manuales del workflow** | Dos “Histórico manual” a la vez (mismo rango o solapado) | **Posible** pero **riesgoso** (ver abajo) |
| **D — Cola n8n / workers** | Varios workers procesando ejecuciones distintas | Infra adicional; mismos riesgos que C |

---

### Cuotas Gmail — ¿permite paralelo?

Gmail API limita por **usuario OAuth** (no por “día”):

| Operación | Costo orientativo | Notas |
|-----------|-------------------|--------|
| `messages.list` | 5 quota units | 1 por día consultado |
| `messages.get` | 5 units | 1 por correo descargado |
| Techo típico | ~**250 units/usuario/segundo** | Workspace puede variar |

Ejemplo: **3 días en paralelo**, 40 correos/día:

```
3 × list (15 u) + 3 × 40 × get (600 u) ≈ 615 units en ráfaga
```

Si las descargas ocurren en pocos segundos → **`429 User-rate limit exceeded`**
(reintentos, backoff, ejecución más lenta o fallida).

Paralelizar días **multiplica** list + get en el **mismo token OAuth**. Gmail no
distribuye cuota “por día”; todo compite en la misma ventana.

---

### Riesgos si se paralelizan días (nivel A — mismo workflow)

#### 1. Emparejamiento de items en n8n

Nodos downstream usan referencias cruzadas:

- `$json.gmailQuery` / `$('Construir consulta Gmail').item`
- `$('Filtrar solo nuevos')._dayCtx` / `_qinfo`
- `10-registrar-dia-historico.js` agrega `$('Normalizar correo').all()` y
  `$('Listar IDs Gmail').item`

Con **varios días mezclados** en una ejecución, el índice del item ya no garantiza
“este correo pertenece a este `processDate`”. Resultado: **conteos erróneos** en
`email_history_day`, queries Gmail incorrectas en el resumen, matches atribuidos al
día equivocado.

#### 2. `Registrar día histórico` mezcla días

Ese nodo consolida **todos** los items de nodos previos en el run. Con N días
paralelos no hay forma fiable de separar `message_ids_listed` por `analyzed_date`
sin reescribir la lógica (hoy asume **un** día activo).

#### 3. Memoria y CPU en n8n

Un día con 60 correos ya supera **11 min** en tu traza. **Tres días en paralelo**
en la misma ejecución implicaría:

- ~180 GET + JSON en memoria simultáneos
- **Filtrar recibidos relevantes** con un solo `$input.all()` gigante
- Riesgo de **heap out of memory** o swap severo en el contenedor

Paralelo de días **no elimina** el cuello de botella del filtro; lo **amplifica**.

#### 4. Loop `Guardar resumen → Obtener días analizados`

El cierre secuencial marca un día `completed` antes de planificar el siguiente. Con
varios días abiertos a la vez:

- Días **partial** o sin fila en `email_history_day`
- Re-ejecuciones que **repiten** días no cerrados
- Orden de `analyzed_date` no determinista en la UI

#### 5. Idempotencia en Postgres (menor riesgo, no cero)

| Mecanismo | Paralelo mismo `message_id` |
|-----------|----------------------------|
| `email_trace.message_id` UNIQUE + skip on conflict | No duplica filas |
| `email_history_day.analyzed_date` UNIQUE | Upsert por día; **no** protege conteos incorrectos si el nodo mezcla IDs |
| `skipKnownInDb` | Carrera: dos ramas leen BD antes del insert del otro → **doble GET** del mismo ID (desperdicio, no duplicado) |

No suele corromper BD, pero sí **desperdicia cuota** y tiempo.

---

### Riesgos si se paralelizan ejecuciones (nivel C — dos Histórico manual)

Dos operadores (o una doble pulsación) con el **mismo rango**:

| Riesgo | Efecto |
|--------|--------|
| Mismo día pendiente en ambas | Duplicación de trabajo API + filtro |
| `429` Gmail | Ambas compiten por cuota del mismo usuario |
| `email_history_day` | Upsert concurrente — último gana; conteos pueden reflejar solo una pasada parcial |
| Carga n8n | CPU/RAM duplicada; peor si el filtro ya va al 100 % |

Mitigación operativa: **una sola ejecución histórica activa**; no relanzar hasta
`completed` o fallo claro.

---

### ¿Cuándo el paralelo es razonable?

| Escenario | Paralelo | Comentario |
|-----------|----------|------------|
| Workflow OK sin cambios | **1 día / ejecución / loop** | Recomendado |
| Acelerar barrido histórico | Paralelo de días en el **mismo** run | **No recomendado** con el OK actual |
| Reducir tiempo por día | Paralelo **limitado** de GET (5–10) **dentro del mismo día** | Viable en workflow **experimental**; vigilar 429 |
| Muchos días (meses) | Worker externo + cola + concurrencia acotada | Fuera de n8n; ver [flujo_api_gmail.md](./flujo_api_gmail.md) |
| Dos cuentas Gmail distintas | Ejecuciones paralelas **separadas** (credencial distinta) | Cuota independiente; OK si no comparten BD de forma conflictiva |

Regla práctica: **paralelizar correos (GET)** con techo bajo puede ayudar; **paralelizar
días** con el diseño actual **genera más riesgo que beneficio**, sobre todo mientras
**Filtrar recibidos relevantes** domine el tiempo.

---

### Estimación orientativa: secuencial vs N días en paralelo

Supuestos: 26 días, ~11 min/día (tu traza), mismo host n8n.

| Estrategia | Tiempo wall-clock teórico | Riesgo |
|------------|---------------------------|--------|
| Secuencial (actual) | ~26 × 11 min ≈ **4,7 h** | Bajo |
| 3 días en paralelo (mismo run) | ~**1,6 h** si escala lineal | Alto (429, OOM, mezcla días) |
| 3 ejecuciones manuales solapadas | Impredecible | Alto (duplicado + 429) |
| Secuencial + filtro optimizado (50 % menos CPU/día) | ~**2,4 h** | Medio (solo código filtro) |

El paralelo de días **no sustituye** optimizar el filtro: con 5 min/día en filtro,
3 días paralelos pueden saturar CPU **y** Gmail a la vez.

---

### Recomendación documentada

1. **Mantener un día por vuelta** en el workflow OK (como está hoy).
2. **No lanzar** dos Histórico manual concurrentes sobre el mismo rango/cuenta.
3. Si se necesita más velocidad, priorizar (en este orden):
   - Optimizar **Filtrar recibidos relevantes** (mayor impacto en tu traza).
   - Paralelismo **acotado de GET** dentro del **mismo día** (workflow de prueba).
   - Batch API / worker externo para barridos grandes.
4. Cualquier paralelo multi-día exige **rediseño**: sub-workflow por día,
   `processDate` en cada item hasta Registrar, estado `processing` en
   `email_history_day`, semáforo de concurrencia y backoff ante `429`.

---

## Checklist de confirmación del diagnóstico

Marca lo que aplique a tu ejecución:

- [ ] `emails_listed_count` ≥ 30 en ese día
- [ ] Modo `historical` (Config histórico)
- [ ] `telemetriaVariants` incluye **`api`**
- [ ] Varios `body_text` > 50 KB en Normalizar
- [ ] `emails_match_count` ≪ `emails_processed_count`
- [ ] **Filtrar recibidos** tarda más que **Leer Gmail**
- [ ] CPU n8n al 100 % durante el nodo

Si **4 o más** casillas: el comportamiento encaja con este diagnóstico; el filtro no
está “roto”, está **sobredimensionado** para el volumen y las keywords actuales.

---

## Conclusión

El tiempo excesivo en **Filtrar recibidos relevantes** no contradice un barrido de
~60 correos: el diseño actual combina:

1. **Todos** los recibidos del día (histórico).
2. **Cuerpos grandes** ya normalizados.
3. Búsqueda con **`\\bapi\\b`** y otras palabras frecuentes sobre el texto completo.
4. Validación de contexto **por cada ocurrencia**, no solo por la primera.
5. **Un solo** hilo JavaScript en n8n para todo el lote.

La API de Gmail ya consumió ~1,5 min en **Leer Gmail**; el filtro puede superarlo
porque el costo crece con **N correos × tamaño × ocurrencias de keywords**, no con
latencia de red.

Próximo paso recomendado cuando quieras actuar: medir `listed / processed / match` en
`email_history_day` y el tamaño de `body_text` en la ejecución; con eso se valida si
conviene acotar keywords (`api`), acortar haystack o mover parte del filtro antes del
GET completo — en un **workflow de prueba**, manteniendo el OK como referencia.

**Paralelo multi-día:** no recomendado con el OK actual; ver sección
[¿Se pueden consultar varios días en paralelo a Gmail?](#se-pueden-consultar-varios-días-en-paralelo-a-gmail).
