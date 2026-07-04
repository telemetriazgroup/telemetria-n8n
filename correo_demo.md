# Demo — conversación estilo Gmail (3 mensajes)

Pega este texto en `body_text` para probar el parser en **Correos match → Conversación**.

```
Estimado Johan / Jessica

Buenos días, para informar que el cliente realizará la devolución de los contenedores del ciclo #41.

* Fecha de devolución: 30 junio 2026
* Hora: 11:30 am.

Saludos,
Kiara Castillo

El lun, 15 jun 2025, 19:11, informes@zgroup.com.pe escribió:
Estimada Kiara
Realizó el envío de los reportes de ingreso de combustible según lo solicitado.

El lun, 15 jun 2025, 10:13, Kiara Castillo <kiara@zgroup.com.pe> escribió:
De: Cliente Logística SAC <cliente@logistica.pe>
Enviado el: lunes, 15 de junio de 2025 10:05
Para: operaciones@zgroup.com.pe
Asunto: DEVOLUCION contenedores ciclo 41

Estimados, confirmamos devolución programada para fin de mes.
```

Esperado: 3 tarjetas cronológicas; la de Kiara (30 jun) abajo expandida sin mezclar los `De:`/`Enviado el:` de abajo.
