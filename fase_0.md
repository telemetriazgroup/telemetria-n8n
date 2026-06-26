# Fase 0 — Infraestructura y persistencia base

**Objetivo:** dejar operativo el entorno donde correrá todo el sistema: n8n,
PostgreSQL, reverse proxy, y las cuentas/API keys necesarias. Al cerrar esta fase
debes poder conectarte a n8n desde el navegador, ejecutar un `SELECT 1` en Postgres
desde un workflow, y tener un único punto de configuración parametrizable.

**Prerrequisitos:** servidor Linux con Docker, dominio apuntando al servidor
(ej. `ztrack.app`), acceso a Google Cloud Console y a Telegram.

**Siguiente fase:** [fase_1.md](./fase_1.md)

---

## Paso 1 — Levantar n8n en Docker

### 1.1 Directorio y permisos

```bash
mkdir -p ~/n8n-data
sudo chown -R 1000:1000 ~/n8n-data
```

n8n corre con UID `1000` dentro del contenedor; si el volumen no tiene ese
ownership, fallan permisos al guardar workflows y credenciales.

### 1.2 Contenedor

Ejemplo mínimo (ajusta variables según tu entorno):

```bash
docker run -d \
  --name n8n \
  --restart unless-stopped \
  -p 5678:5678 \
  -v ~/n8n-data:/home/node/.n8n \
  -e N8N_HOST="n8n.ztrack.app" \
  -e N8N_PROTOCOL="https" \
  -e WEBHOOK_URL="https://n8n.ztrack.app/" \
  -e GENERIC_TIMEZONE="America/Lima" \
  -e TZ="America/Lima" \
  n8nio/n8n
```

### 1.3 Verificación

- Abre `http://<IP>:5678` (o el dominio tras el proxy) y completa el registro inicial.
- Crea un workflow de prueba con un nodo **Manual Trigger** y ejecútalo.

---

## Paso 2 — Apache reverse proxy + WebSocket

n8n necesita WebSocket para la UI. En Apache2:

```apache
# /etc/apache2/sites-available/n8n.conf
<VirtualHost *:443>
    ServerName n8n.ztrack.app

    SSLEngine on
    # ... certificados SSL ...

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:5678/
    ProxyPassReverse / http://127.0.0.1:5678/

    # WebSocket (crítico)
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) ws://127.0.0.1:5678/$1 [P,L]

    ProxyPass /rest/push ws://127.0.0.1:5678/rest/push
    ProxyPassReverse /rest/push ws://127.0.0.1:5678/rest/push
</VirtualHost>
```

Habilitar módulos y sitio:

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite ssl
sudo a2ensite n8n.conf
sudo systemctl reload apache2
```

### Verificación

- Accede a `https://n8n.ztrack.app` — la UI debe cargar sin errores de conexión.
- En la consola del navegador no deben aparecer fallos de WebSocket.

---

## Paso 3 — PostgreSQL para el negocio

Usa una base **separada** de la interna de n8n (o al menos un esquema propio).

```bash
# Ejemplo en el servidor Postgres
sudo -u postgres psql <<'SQL'
CREATE DATABASE telemetria;
CREATE USER telemetria_app WITH PASSWORD 'CAMBIAR_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE telemetria TO telemetria_app;
SQL
```

Más adelante aplicarás `schema.sql` en [fase_1.md](./fase_1.md). En F0 solo
necesitas la base creada y accesible.

### Verificación desde n8n

1. **Credentials → Add credential → Postgres**
2. Host, puerto, base `telemetria`, usuario y contraseña.
3. Workflow de prueba: nodo **Postgres** → Operation **Execute Query** → `SELECT 1 AS ok`.
4. Ejecutar y confirmar resultado `{ ok: 1 }`.

---

## Paso 4 — Google Cloud: OAuth2 para Gmail

### 4.1 Proyecto y API

1. [Google Cloud Console](https://console.cloud.google.com/) → crear o seleccionar proyecto.
2. **APIs & Services → Library** → habilitar **Gmail API**.
3. **OAuth consent screen** → configurar (tipo External o Internal según tu org).
4. **Credentials → Create credentials → OAuth client ID** → tipo **Web application**.

### 4.2 Redirect URI (evitar `redirect_uri_mismatch`)

La URI debe coincidir **exactamente** con la que usa n8n:

```
https://n8n.ztrack.app/rest/oauth2-credential/callback
```

Guarda **Client ID** y **Client Secret**.

### 4.3 Credencial en n8n

1. **Credentials → Gmail OAuth2 API**
2. Pega Client ID y Client Secret.
3. Scope mínimo recomendado: `https://www.googleapis.com/auth/gmail.readonly`
   (ampliar en F7 cuando se necesite enviar correos: `gmail.modify` o `gmail.send`).
4. **Connect my account** → autoriza la cuenta Gmail de telemetría.

### Verificación

- En un workflow de prueba, nodo **Gmail → Get Many** con límite 1.
- Debe devolver al menos un correo sin error de autenticación.

---

## Paso 5 — Bot de Telegram

### 5.1 Crear el bot

1. En Telegram, habla con [@BotFather](https://t.me/BotFather).
2. `/newbot` → elige nombre y username.
3. Guarda el **token** del bot.

### 5.2 Obtener chat ID

1. Envía un mensaje al bot desde el chat/grupo donde quieres recibir alertas.
2. Consulta: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Anota `chat.id` (número, puede ser negativo en grupos).

### 5.3 Credencial en n8n

**Credentials → Telegram API** → pega el token.

La integración real del bot ocurre en [fase_3.md](./fase_3.md); en F0 solo deja la
credencial lista.

---

## Paso 6 — Groq API (para F6, preparar ahora)

1. Registro en [console.groq.com](https://console.groq.com/).
2. Genera una **API Key**.
3. En n8n: **Credentials → Header Auth** o credencial HTTP genérica con
   `Authorization: Bearer <GROQ_API_KEY>`.

No se usa hasta [fase_6.md](./fase_6.md), pero conviene tenerla desde F0.

---

## Paso 7 — Nodo de configuración central

Todo parámetro del sistema debe vivir en **un solo nodo Set** al inicio del
workflow (ya presente en `workflow.json` como **Configuración**).

Campos actuales y futuros:

| Campo | Fase | Descripción |
|-------|------|-------------|
| `mode` | F1 | `today` o `range` |
| `startDate` / `endDate` | F1 | Rango de revisión |
| `tzOffsetHours` | F1 | Offset horario (Lima = `-5`) |
| `keywordFilterEnabled` | F2 | Activar filtro |
| `keywords` | F2 | `["Eusebio", "Luis", ...]` |
| `telegramChatId` | F3 | Chat ID destino |
| `restApiUrl` | F5 | URL endpoint aplicación |
| `restApiToken` | F5 | Token/API key (mejor en credencial) |
| `groqModel` | F6 | ej. `llama-3.1-8b-instant` |
| `autoReplyEnabled` | F7 | `false` hasta validar modo asistido |

**Regla:** no hardcodear URLs, tokens ni keywords en nodos sueltos.

### Verificación

- Abre el workflow importado y confirma que el nodo **Configuración** existe.
- Cambia `mode` a `today` y ejecuta manualmente el flujo hasta **Construir consulta Gmail**;
  debe generar `gmailQuery` con epoch del día actual.

---

## Checklist de cierre F0

- [ ] n8n accesible por HTTPS en `ztrack.app` (o tu dominio)
- [ ] WebSocket funcionando (UI estable)
- [ ] Volumen Docker con ownership `1000:1000`
- [ ] PostgreSQL `telemetria` creada; `SELECT 1` OK desde n8n
- [ ] Credencial Gmail OAuth2 conectada
- [ ] Credencial Telegram creada; chat ID anotado
- [ ] API Key Groq guardada (para F6)
- [ ] Nodo **Configuración** definido como punto único de parámetros

**Siguiente:** [fase_1.md](./fase_1.md) — importar workflow, crear tablas y trazabilidad.
