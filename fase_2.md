# Fase 2 — Filtrado por palabras clave

**Objetivo:** procesar solo los correos relevantes para instalaciones de telemetría,
usando keywords configurables (**"Eusebio"**, **"Luis"**, ampliables) sin modificar
la lógica del flujo cada vez que cambie la lista.

**Prerrequisitos:** [fase_1.md](./fase_1.md) completada.

**Estado en el repo:** filtro **parcial** — ya existe vía query de Gmail en el nodo
**Configuración** + **Construir consulta Gmail**, desactivado por defecto.

**Siguiente fase:** [fase_3.md](./fase_3.md)

---

## Paso 1 — Activar filtro en la query de Gmail (implementación actual)

En el nodo **Configuración**:

```
keywordFilterEnabled = true
keywords = ["Eusebio", "Luis"]
```

El nodo **Construir consulta Gmail** añade a la búsqueda:

```
after:<epoch> before:<epoch> ("Eusebio" OR "Luis")
```

Gmail filtra **antes** de traer los mensajes, lo que reduce carga y cuota de API.

### Verificación

1. Envía un correo con "Eusebio" en el asunto → debe aparecer en `email_trace`.
2. Envía uno sin keywords → no debe procesarse.
3. Agrega `"Pedro"` al array `keywords` → debe tomar efecto sin tocar código.

---

## Paso 2 — Complementar con filtro post-normalización (recomendado)

La query de Gmail no cubre todo:

- No es insensible a acentos (`José` vs `Jose`).
- Puede coincidir subcadenas dentro de otras palabras.
- No filtra sobre cuerpo cuando Gmail indexa distinto.

Añade un nodo **Code** después de **Normalizar correo** y antes de **Guardar trazabilidad**:

```javascript
const cfg = $('Configuración').first().json;

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const keywords = (cfg.keywords || []).map(normalize);
const enabled = cfg.keywordFilterEnabled === true;

const out = [];
for (const item of $input.all()) {
  const m = item.json;
  if (!enabled) {
    out.push(item);
    continue;
  }
  const haystack = normalize(`${m.subject} ${m.body_text}`);
  const match = keywords.some(kw => {
    // palabra completa aproximada (word boundary)
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return re.test(haystack);
  });
  if (match) out.push(item);
}
return out;
```

Guarda este script como `code-nodes/04-filtrar-keywords.js` cuando lo incorpores al repo.

### Verificación

| Caso | Resultado esperado |
|------|-------------------|
| Asunto "Instalación Eusebio" | Pasa |
| Cuerpo menciona "Luis" | Pasa |
| Sin keywords | No pasa |
| "Eusebio" con acento distinto | Pasa (normalización NFD) |

---

## Paso 3 — Definir semántica del filtro

Documenta en **Configuración** (comentario o campo futuro):

| Decisión | Valor recomendado |
|----------|-------------------|
| ¿Basta una keyword? | Sí — lógica **OR** |
| ¿Palabra completa? | Sí — evita falsos positivos |
| ¿Asunto + cuerpo? | Sí |
| ¿Historial del hilo? | En F4, cuando exista contexto persistido |

---

## Paso 4 — Ramificar el flujo para fases posteriores

Después del filtro, la rama **positiva** alimentará:

- Guardar trazabilidad (F1) — ya existe
- Telegram (F3)
- REST (F5)

La rama **negativa** puede terminar sin acción o registrar un contador opcional.

```
Normalizar correo
      │
      ▼
Filtrar keywords ──NO──► (fin)
      │
     SÍ
      ├─► Guardar trazabilidad
      ├─► Telegram (F3)
      └─► REST (F5)
```

---

## Checklist de cierre F2

- [ ] `keywordFilterEnabled = true` probado con correos positivos y negativos
- [ ] Nueva keyword agregada solo en **Configuración**
- [ ] (Opcional) Filtro post-normalización con acentos y palabra completa
- [ ] Flujo ramificado listo para conectar F3

**Siguiente:** [fase_3.md](./fase_3.md) — alertas por Telegram.
