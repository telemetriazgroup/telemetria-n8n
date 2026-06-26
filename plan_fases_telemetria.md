# Plan de Implementación por Fases
## Automatización de correos de instalaciones de telemetría con n8n

**Objetivo del plan:** llegar a un sistema totalmente integrado mediante etapas validables de forma independiente. Cada fase deja un incremento funcional y comprobable, de modo que ningún avance dependa de que "todo esté terminado" para probarse.

**Guías operativas paso a paso:** [README.md](./README.md) · [fase_0_implicancias.md](./fase_0_implicancias.md) · [fase_0.md](./fase_0.md) · [fase_1.md](./fase_1.md) · [fase_2.md](./fase_2.md) · [fase_3.md](./fase_3.md) · [fase_4.md](./fase_4.md) · [fase_5.md](./fase_5.md) · [fase_6.md](./fase_6.md) · [fase_7.md](./fase_7.md) · [fase_8.md](./fase_8.md)

---

## Visión general de la arquitectura

```
Gmail API ──► n8n (orquestador) ──► Filtro keywords ──► Base de datos (estado/hilos)
                     │                                          │
                     ├──► Telegram Bot (notificación)           │
                     ├──► API REST (app de gestión) ◄───────────┘
                     └──► LLM (resumen / clasificación / borradores)
                                   │
                                   └──► Respuesta asistida vía Gmail (mismo Thread ID)
```

**Stack base (ya disponible):** n8n self-hosted en Docker, Apache2 reverse proxy con `proxy_wstunnel`, dominio `ztrack.app`, Gmail OAuth2, bot de Telegram, Groq API.

**Componentes a incorporar:** base de datos persistente (PostgreSQL recomendado, idealmente el mismo motor que ya usa n8n), capa REST hacia la aplicación de gestión, máquina de estados de hilos, y la lógica de respuesta asistida.

---

## Resumen de fases

| Fase | Entrega | Guía | Estado típico |
|------|---------|------|---------------|
| F0 | Infraestructura y persistencia base | [fase_0.md](./fase_0.md) | Mayormente cubierta |
| F1 | Lectura de Gmail + anti-duplicados | [fase_1.md](./fase_1.md) | Implementado en repo |
| F2 | Filtro inteligente por palabras clave | [fase_2.md](./fase_2.md) | Parcial |
| F3 | Notificación por Telegram (MVP visible) | [fase_3.md](./fase_3.md) | Pendiente |
| F4 | Persistencia de hilos y máquina de estados | [fase_4.md](./fase_4.md) | Parcial (trazabilidad) |
| F5 | Integración REST con la aplicación | [fase_5.md](./fase_5.md) | Pendiente |
| F6 | Enriquecimiento con IA (resumen / clasificación / borradores) | [fase_6.md](./fase_6.md) | Pendiente |
| F7 | Respuesta automática o asistida | [fase_7.md](./fase_7.md) | Pendiente |
| F8 | Robustez, escalabilidad y multi-cuenta | [fase_8.md](./fase_8.md) | Pendiente |

El orden está diseñado para que la **F3 entregue valor visible temprano** (alertas funcionando) y para que la persistencia (F4) esté lista antes de exponer datos a la aplicación (F5) y antes de habilitar respuestas (F7).

---

## Fase 0 — Infraestructura y persistencia base

**Funcionalidades**
- n8n en Docker operativo detrás de Apache (ya resuelto, incluyendo WebSocket y ownership `1000:1000`).
- Base de datos PostgreSQL provisionada para el negocio del flujo (separada de la base interna de ejecuciones de n8n, o al menos en un esquema propio).
- Variables de entorno y/o un nodo de configuración central para parametrizar: palabras clave, URL de la API REST, chat IDs de Telegram, credenciales.

**Cómo validar**
- Conexión a la base de datos desde un nodo Postgres de n8n (un `SELECT 1`).
- Lectura correcta de las variables parametrizables desde un único punto.

**Implicancias / riesgos**
- Definir desde ya el esquema de tablas evita migraciones dolorosas en F4–F5.
- Mantener la configuración centralizada (no hardcodeada en cada nodo) es lo que hace cumplir el requisito de "parametrizable" sin reescribir flujos después.

---

## Fase 1 — Lectura de Gmail y detección de correos

**Funcionalidades**
- Trigger de Gmail que detecte correos entrantes (nuevos y respuestas dentro de hilos existentes).
- Extracción de campos base: `messageId`, `threadId`, remitente, destinatarios, asunto, fecha, cuerpo.
- **Mecanismo anti-duplicados:** tabla de mensajes procesados con restricción `UNIQUE` sobre `messageId`. Antes de procesar, se consulta; si ya existe, se descarta.

**Cómo validar**
- Enviar varios correos de prueba (uno nuevo + una respuesta a un hilo) y confirmar que ambos se leen y que el `threadId` agrupa correctamente la respuesta con su hilo.
- Reprocesar manualmente la misma ejecución y comprobar que el anti-duplicados impide el doble procesamiento.

**Implicancias / riesgos**
- El Gmail Trigger de n8n funciona por *polling*; conviene fijar un intervalo razonable y, como respaldo, apoyar la deduplicación en la base de datos (no solo en el estado interno del nodo, que es frágil ante reinicios).
- Recordar que en los Code nodes los campos de Gmail vienen capitalizados (`$json.Subject`, `$json.From`).
- Decidir temprano si se procesan solo correos no leídos, etiquetados, o todos: condiciona el volumen de las pruebas siguientes.

---

## Fase 2 — Filtrado inteligente por palabras clave

**Funcionalidades**
- Filtro configurable sobre asunto + cuerpo (y, cuando esté disponible en F4, sobre el historial del hilo).
- Lista de palabras clave inicial: **"Eusebio"**, **"Luis"**, almacenada de forma parametrizable (variable de entorno, tabla de configuración o nodo Set) para poder ampliarla sin tocar la lógica.
- Coincidencia insensible a mayúsculas/acentos para evitar falsos negativos.

**Cómo validar**
- Correos que contienen las keywords pasan; correos que no las contienen se detienen en el filtro.
- Agregar una keyword nueva en la configuración y confirmar que toma efecto sin modificar el flujo.

**Implicancias / riesgos**
- Definir la semántica del filtro: ¿basta una keyword o se requieren varias? ¿coincidencia por palabra completa o por subcadena? Esto evita que "Luis" coincida dentro de otra palabra.
- Este es el punto donde más adelante (F6) la IA puede complementar el filtro por keywords con clasificación semántica, pero el filtro literal debe quedar sólido primero.

---

## Fase 3 — Notificación por Telegram (MVP visible)

**Funcionalidades**
- Alerta automática a Telegram cuando un correo supera el filtro.
- Contenido mínimo: remitente, asunto, resumen del contenido, identificador/enlace del correo, estado del proceso.
- Enlace directo al correo en Gmail usando `threadId` (`https://mail.google.com/mail/u/0/#inbox/<threadId>`).

**Cómo validar**
- Disparar un correo de prueba con keyword y confirmar que llega la notificación con todos los campos.
- Probar con asuntos/cuerpos que tengan caracteres especiales.

**Implicancias / riesgos**
- Usar `parse_mode=HTML` en Telegram (Markdown se rompe con caracteres especiales). Escapar `<`, `>`, `&` en los valores dinámicos.
- En esta fase el "resumen del contenido" puede ser un recorte simple del cuerpo; el resumen por IA se formaliza en F6. Esto permite tener el MVP visible antes de depender del LLM.
- Es el primer punto de valor demostrable para stakeholders: conviene cerrarlo bien porque suele ser el que se muestra primero.

---

## Fase 4 — Persistencia de hilos y máquina de estados

**Funcionalidades**
- Esquema de base de datos para conversaciones:
  - `threads` (thread_id, asunto, participantes, estado, fechas, contadores).
  - `messages` (message_id, thread_id, remitente, destinatarios, fecha, cuerpo, ref. a adjuntos).
  - `attachments` (id, message_id, nombre, tipo, ruta/almacenamiento).
- Estado de cada hilo mediante un enum: `pendiente`, `en_proceso`, `completada` (ampliable).
- Reconstrucción del **contexto completo del hilo** usando la operación "get thread" de Gmail, persistiendo todos los mensajes del hilo.

**Cómo validar**
- Tras procesar un hilo con varias respuestas, consultar la base de datos y verificar que todos los mensajes quedan ligados al mismo `thread_id` en orden cronológico.
- Cambiar manualmente el estado de un hilo y confirmar que las consultas lo reflejan.

**Implicancias / riesgos**
- Definir bien la transición de estados ahora evita lógica ambigua en F7 (cuándo un hilo pasa a "en_proceso" o "completada").
- Decisión sobre adjuntos: ¿se guardan binarios en disco/objeto y solo metadatos en BD, o se difieren a la app de gestión? Recomendado guardar metadatos en BD y el binario en almacenamiento, enviando referencia.
- La idempotencia de F1 (anti-duplicados) y la persistencia aquí deben ser consistentes: un mismo `messageId` no debe duplicar filas.

---

## Fase 5 — Integración REST con la aplicación de gestión

**Funcionalidades**
- Envío del payload completo a la aplicación vía API REST cuando un correo cumple el filtro.
- Payload mínimo: ID del correo, Thread ID, remitente, destinatarios, asunto, fecha, contenido, historial del hilo (si está disponible) y adjuntos/referencias.
- URL de la API parametrizable; autenticación según lo que exponga la aplicación (token/API key).

**Cómo validar**
- Verificar en la aplicación (o en un endpoint de prueba / `webhook.site` temporal) que el payload llega completo y bien formado.
- Probar el comportamiento ante respuesta de error de la API (4xx/5xx) y confirmar que no se pierde el correo.

**Implicancias / riesgos**
- Cuidado con la inyección de expresiones dinámicas dentro del JSON del nodo HTTP Request (el problema que ya enfrentaste con Groq): conviene **construir el objeto en un Code node y pasarlo como JSON ya armado**, en lugar de incrustar `{{ }}` dentro de un string JSON crudo. Validar primero con un JSON estático y luego reintroducir lo dinámico.
- Activar reintentos en el nodo HTTP Request y registrar el resultado del envío en la BD (estado: enviado / fallido) para no reprocesar a ciegas.
- Acordar el contrato del payload con quien desarrolle la aplicación antes de codificar: cambios posteriores de esquema son costosos.

---

## Fase 6 — Enriquecimiento con IA

**Funcionalidades**
- Resumen del contenido del correo y/o del hilo completo.
- Clasificación de la conversación (p. ej. tipo de instalación, prioridad, estado sugerido).
- Generación de borradores de respuesta (insumo para F7).
- Sustituye el "resumen simple" de F3 por el resumen del LLM e incorpora la clasificación al payload de F5.

**Cómo validar**
- Comparar resúmenes generados con el contenido original en varios correos representativos.
- Verificar que la clasificación es coherente y que el borrador es razonable como punto de partida (no necesariamente final).

**Implicancias / riesgos**
- Mismo patrón de armado de JSON que en F5 para el HTTP Request hacia el LLM (Groq con `llama-3.1-8b-instant` o el modelo que se elija): construir el body en código, no como string con expresiones.
- Controlar costos/cuotas (free tier de Groq) y latencia: el resumen no debe bloquear la notificación de Telegram si la API tarda o falla. Conviene degradar con elegancia (notificar aunque el resumen falle).
- Definir si la IA solo asiste o también decide clasificación de estado: para auditoría suele convenir que la decisión final de estado quede en F7/aplicación, no en el LLM.

---

## Fase 7 — Respuesta automática o asistida

**Funcionalidades**
- Capacidad de responder dentro del mismo hilo vía Gmail API, **manteniendo el Thread ID** y las cabeceras `In-Reply-To` / `References` para preservar la conversación.
- **Validación previa al envío:** el sistema solo responde si se cumplen condiciones del proceso de instalación (confirmación de instalación, validación de datos o aprobación de un operador).
- Dos modos:
  - **Asistido:** se genera el borrador (F6) y un operador lo aprueba antes de enviar (p. ej. botones inline en Telegram o un flag desde la aplicación de gestión).
  - **Automático:** envío directo solo cuando las condiciones definidas se cumplen sin intervención.

**Cómo validar**
- Enviar una respuesta de prueba y confirmar en Gmail que queda dentro del hilo original (mismo `threadId`, no como correo nuevo).
- Forzar el caso "condiciones no cumplidas" y verificar que el sistema **no** envía.
- Probar el flujo de aprobación humana de principio a fin.

**Implicancias / riesgos**
- Es la fase de mayor riesgo operativo: un envío equivocado va a un cliente real. Recomendado empezar siempre en modo asistido y habilitar el automático solo para casos acotados y bien validados.
- La compuerta de aprobación (operador) y la actualización de estado del hilo (`en_proceso` → `completada`) deben quedar registradas para auditoría.
- Mantener el Thread ID correctamente es lo que diferencia una "respuesta" de un "correo suelto"; conviene probarlo exhaustivamente.

---

## Fase 8 — Robustez, escalabilidad y multi-cuenta

**Funcionalidades**
- **Logging** de todas las operaciones (lectura, filtrado, envío REST, notificación, respuesta) en tabla dedicada o sistema de logs.
- **Manejo de errores y reintentos automáticos** en los nodos críticos (HTTP, Gmail, Telegram), con backoff y registro de fallos.
- **Soporte multi-cuenta de Gmail:** parametrizar credenciales por cuenta y reutilizar el flujo (sub-workflow parametrizado) para escalar sin duplicar lógica.
- Monitoreo de salud del workflow (alerta si deja de procesar).

**Cómo validar**
- Inyectar fallos controlados (API caída, token vencido) y comprobar reintentos y registro.
- Conectar una segunda cuenta de Gmail y verificar que ambos flujos operan de forma aislada y sin duplicados cruzados.
- Revisar que los logs permiten reconstruir el ciclo de vida de un correo de extremo a extremo.

**Implicancias / riesgos**
- La deduplicación (F1) y la persistencia (F4) deben ser sólidas antes de escalar a varias cuentas, o los duplicados se multiplican.
- El OAuth2 de cada cuenta de Gmail requiere que las redirect URI coincidan exactamente con las configuradas en Google Cloud Console (recordar el `redirect_uri_mismatch`).
- A mayor volumen, vigilar los límites de la Gmail API y de la API del LLM; puede requerir colas o throttling.

---

## Criterios de "totalmente integrado"

El sistema se considera integrado cuando, de forma sostenida y sin intervención manual:

1. Lee correos nuevos y respuestas de hilos sin duplicar.
2. Filtra por las keywords parametrizables.
3. Persiste hilos y mensajes con su estado.
4. Envía el payload completo (incluido historial y adjuntos) a la aplicación vía REST con reintentos.
5. Notifica por Telegram con resumen de IA.
6. Permite responder dentro del hilo, manteniendo el Thread ID, con validación previa (asistida o automática).
7. Registra logs, maneja errores y soporta múltiples cuentas.

---

## Recomendaciones transversales

- **Idempotencia primero:** cada fase debe poder reejecutarse sin efectos colaterales. El anti-duplicados es la columna vertebral del sistema.
- **JSON dinámico en HTTP Request:** construir los cuerpos en Code nodes y validar con JSON estático antes de introducir expresiones `{{ }}`. Aplica a Groq/LLM (F6) y a la API REST (F5).
- **Degradación elegante:** que un fallo del LLM o de la API de gestión no impida que la notificación básica llegue.
- **Configuración centralizada:** keywords, URLs, chat IDs y credenciales en un único punto parametrizable desde F0.
- **Modo asistido antes que automático:** habilitar respuestas automáticas solo tras validar exhaustivamente el modo asistido.
