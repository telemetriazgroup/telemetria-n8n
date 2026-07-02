# Ejemplo de body_text apilado (hilos Gmail / Outlook)

Referencia para `parseEmailThread.ts` en el frontend de **Correos match → Ver contenido**.

## Patrones que detecta el parser

| Formato | Ejemplo |
|---------|---------|
| Gmail ES | `El lun, 1 abr 2025, 10:30, Juan Pérez <juan@zgroup.com.pe> escribió:` |
| Gmail EN | `On Mon, Apr 1, 2025 at 10:30 AM John <john@example.com> wrote:` |
| Outlook | Bloque `De:` / `Enviado:` / `Para:` / `Asunto:` |
| Separador | `-----Original Message-----` / `-----Mensaje original-----` |

## Texto de ejemplo (3 mensajes)

```
Buenos días Eusebio, confirmo que la telemetría del vehículo ABC-123 ya está activa en ztrack.
Saludos,
María

El jue, 27 mar 2025, 14:22, Luis Mendoza <luis@zgroup.com.pe> escribió:
Eusebio, favor revisar la plataforma telemetria del cliente; no aparecen datos desde ayer.

El mié, 26 mar 2025, 09:15, Eusebio Rojas <eusebio@zgroup.com.pe> escribió:
De: Cliente Minero SAC <cliente@minero.pe>
Enviado: miércoles, 26 de marzo de 2025 9:10
Para: telemetria@zgroup.com.pe
Asunto: Falla telemetria unidad 402

Reportamos sin señal GPS en la unidad 402 desde las 06:00.
```

## Uso en código

```typescript
import { parseEmailThread } from "./parseEmailThread";

const { messages, isThread } = parseEmailThread(body_text, {
  fromAddress: from_address,
  subject: subject,
});
// messages[0] = más reciente; messages[n] = citas anteriores
```

## Nota

Si `body_text` llega en **una sola línea** (por normalización n8n), `expandCollapsedBody()` inserta saltos antes de los marcadores antes de partir el hilo.
