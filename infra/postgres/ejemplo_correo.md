# Ejemplo de body_text apilado (hilos Gmail / Outlook)

Referencia para `parseEmailThread.ts` — **Correos match → Ver contenido → Conversación**.

## Comportamiento esperado (estilo Gmail)

1. Cada mensaje muestra **solo su texto nuevo** (sin citas repetidas).
2. Orden **cronológico**: mensajes antiguos arriba colapsados con vista previa.
3. El **más reciente** abajo, expandido por defecto.
4. Las citas anidadas (`De:` / `Enviado el:` / `escribió:`) se separan o eliminan del cuerpo.

## Patrones detectados

| Formato | Ejemplo |
|---------|---------|
| Gmail ES | `El lun, 1 abr 2025, 10:30, Juan Pérez <juan@zgroup.com.pe> escribió:` |
| Gmail EN | `On Mon, Apr 1, 2025 at 10:30 AM John <john@example.com> wrote:` |
| Outlook ES | `De: Name <email@dominio>` + `Enviado el: …` |
| Outlook EN | `From: Name <email>` + `Sent: …` |
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

Resultado: 3 tarjetas — #1 colapsada (Cliente Minero), #2 colapsada (Luis), #3 expandida (María).

## Outlook dentro del mensaje más reciente

Si el cuerpo del último correo incluye bloques `De:` / `Enviado el:` sin haber sido partidos,
`stripNestedQuotes()` corta ahí para no mezclar hilos en la tarjeta «Más reciente».
