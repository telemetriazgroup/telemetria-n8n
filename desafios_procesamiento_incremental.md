# Procesamiento incremental — no reprocesar correos ya leídos

Guía cuando cada ejecución del workflow trae **más items** (15 → 28 → 30), la
salida de n8n pesa **varios MB**, y parece que se **releen los mismos correos**.

Relacionado: [fase_1.md](./fase_1.md) · [fase_2.md](./fase_2.md) ·
[desafios_normalizar_correo.md](./desafios_normalizar_correo.md)

---

## Qué está pasando (comportamiento normal)

### 1. El contador sube porque el día avanza

Con `mode = today`, la consulta es del estilo:

```
after:<inicio_del_día> before:<fin_del_día>
```

Cada 30 minutos **entran correos nuevos** al buzón. Por eso ves 15, luego 28,
luego 30: no es un bug, es el volumen acumulado **del mismo día**.

### 2. Los 13 MB son datos de ejecución en n8n, no filas duplicadas en Postgres

**Leer Gmail** (Simplify OFF) descarga el MIME completo de **cada** mensaje:
`text` + `html`. En hilos largos el HTML citado puede pesar **1 MB o más** por
correo (ver `Leer_Gmail.json`).

Ese peso vive en la **ejecución del workflow** (memoria / historial de n8n), no
significa que Postgres tenga 13 MB × N ejecuciones.

### 3. Anti-duplicados en BD ≠ no reprocesar en n8n

| Capa | Qué hace hoy |
|------|----------------|
| **Postgres** | `UNIQUE(message_id)` + **Skip on conflict** → no duplica filas |
| **n8n** | Vuelve a **descargar y normalizar** todos los IDs de la query |

Si reejecutas con 30 correos y 27 ya están en `email_trace`:

- Postgres inserta **solo los 3 nuevos**
- n8n igual procesó **30** (costo API, tiempo, MB en pantalla)

---

## Tres estrategias (elige según objetivo)

### A) Solo guardar lo nuevo en BD (ya lo tienes)

No requiere cambios. Reejecutar es **seguro**: los que faltaban se insertan; los
existentes se omiten.

Comprueba en Adminer:

```sql
SELECT COUNT(*) FROM email_trace
WHERE search_query LIKE 'after:1782536400%';

-- Ver cuáles entraron en la última pasada
SELECT message_id, subject, reviewed_at
FROM email_trace
ORDER BY reviewed_at DESC
LIMIT 10;
```

---

### B) No descargar correos ya en BD (recomendado — flujo en 2 fases)

Idea: primero lista **solo IDs** (ligero), compara con `email_trace`, y solo
entonces descarga el cuerpo de los **nuevos**.

```
Construir consulta Gmail
      ├─► Obtener IDs en BD          (rama lateral; puede devolver 0 filas)
      └─► Listar IDs Gmail           (flujo principal; NO depende de la salida de Postgres)
            → Filtrar solo nuevos
            → Omitir si vacío
            → Leer Gmail (Get) …
```

> **Importante:** si **Obtener IDs en BD** está **encadenado antes** de Listar IDs
> y la query devuelve **0 filas**, n8n **no emite items** y el flujo **se detiene**
> (“No output data returned”). Postgres ejecutó bien, pero el siguiente nodo no corre.
>
> **Solución:** conectar **Construir consulta Gmail** a **Listar IDs Gmail** en
> paralelo (o directo). **Obtener IDs en BD** queda en rama lateral sin salida
> hacia adelante; **Filtrar solo nuevos** lee `$('Obtener IDs en BD').all()`:
> si la BD está vacía → `[]` → **todos los IDs de Gmail se consideran nuevos**
> (búsqueda desde cero).

Archivos en repo:

| Archivo | Rol |
|---------|-----|
| `code-nodes/05-filtrar-solo-nuevos.js` | Quita IDs ya en BD |
| `code-nodes/06-skip-si-vacio.js` | No llama a Gmail si no hay nuevos |

**Configuración** (nodo Set):

```
skipKnownInDb = true    ← omitir ya procesados (default recomendado)
skipKnownInDb = false   ← reprocesar todo (depuración)
```

**Nodo Postgres — Obtener IDs en BD** (Execute Query):

```sql
SELECT message_id
FROM email_trace
WHERE search_query = '{{ $('Construir consulta Gmail').first().json.gmailQuery }}';
```

**Nodo HTTP Request — Listar IDs Gmail**:

| Campo | Valor |
|-------|-------|
| Method | GET |
| URL | `https://gmail.googleapis.com/gmail/v1/users/me/messages` |
| Auth | Gmail OAuth2 (misma credencial) |
| Query `q` | `={{ $('Construir consulta Gmail').first().json.gmailQuery }}` |
| Query `maxResults` | `500` |

**Leer Gmail**: cambiar de **Get Many** a **Get** con
`messageId = {{ $json.id }}`, Simplify OFF.

Resultado típico en la 3.ª ejecución del día:

- Listar IDs: 30 correos (~2 KB)
- Filtrar: 2 nuevos
- Leer Gmail: **2** descargas completas en lugar de 30

---

### C) Buscar rastro sin bajar el cuerpo otra vez

#### C1 — En lo ya guardado (Postgres)

Para keywords como **Eusebio** / **Luis** sin tocar Gmail:

```sql
SELECT message_id, subject, from_address, email_date, gmail_link,
       left(body_text, 200) AS preview
FROM email_trace
WHERE subject ILIKE '%Eusebio%'
   OR body_text ILIKE '%Eusebio%'
   OR subject ILIKE '%Luis%'
   OR body_text ILIKE '%Luis%'
ORDER BY email_date DESC;
```

#### C2 — Filtrar en Gmail antes de descargar (Fase 2)

Activa en **Configuración**:

```
keywordFilterEnabled = true
keywords = ["Eusebio", "Luis"]
```

La query pasa a:

```
after:… before:… ("Eusebio" OR "Luis")
```

Gmail devuelve **menos IDs** desde el servidor. Limitación: depende del índice
de búsqueda de Gmail (no siempre igual que buscar en el cuerpo ya normalizado).

#### C3 — Barrido ligero solo metadatos (exploración)

Para un **inventario rápido** sin cuerpo:

1. Nodo Gmail **Get Many** con **Simplify ON** (metadata + snippet ~100 chars).
2. No insertar en `email_trace`; solo revisar `subject`, `From`, `snippet`.
3. Si algo interesa → **Get** individual con Simplify OFF y guardar.

Útil para “¿hay algo que me perdí?” antes de activar el flujo completo.

---

## Preguntas frecuentes

### ¿Reejecutar guarda los que faltaban?

**Sí.** Mientras el normalizador rellene `message_id`, Postgres inserta los que
no existían. Los demás hacen skip silencioso.

### ¿Por qué algunos correos tienen `body_text` enorme?

Son **hilos de respuesta**: Outlook/Gmail incluyen todo el historial citado. Es
texto válido para trazabilidad; si molesta en análisis, en fases posteriores se
puede truncar o extraer solo el último fragmento.

### ¿Puedo usar etiqueta Gmail “procesado”?

Sí, como alternativa externa: el workflow marcaría `Label` tras insertar y la
query usaría `-label:telemetria-procesado`. En este repo la fuente de verdad es
**Postgres** (`message_id`), más robusto ante reinicios de n8n.

---

## Checklist rápido

- [ ] Confirmar en SQL que `COUNT(*)` crece solo con correos nuevos
- [ ] Activar flujo 2 fases (`skipKnownInDb = true`) si el volumen pesa
- [ ] Activar `keywordFilterEnabled` si solo interesan Eusebio/Luis/etc.
- [ ] Buscar en BD con SQL antes de volver a ejecutar el workflow entero
