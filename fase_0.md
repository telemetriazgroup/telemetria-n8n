# Fase 0 — Infraestructura y persistencia base

**Objetivo:** dejar operativo el entorno de telemetría: n8n en **puerto 7001**
(sin conflictuar con n8n existente en 5678), proxy inverso en **ztrack.app**
bajo `/automatico/`, PostgreSQL de negocio, y credenciales base.

**Arquitectura:** ver [fase_0_implicancias.md](./fase_0_implicancias.md).

| Servidor | Rol | Acceso |
|----------|-----|--------|
| `161.132.53.51` | Docker n8n telemetría + Postgres | `http://161.132.53.51:7001/automatico/` |
| `ztrack.app` | Apache proxy inverso + SSL | `https://ztrack.app/automatico/` |

**Siguiente fase:** [fase_1.md](./fase_1.md)

---

## Paso 1 — Servidor 161.132.53.51: levantar n8n (puerto 7001)

### 1.1 Clonar repo y preparar entorno

```bash
cd /opt/telemetria-n8n/infra    # o la ruta donde clonaste el repo
cp .env.example .env
# Revisa .env — valores por defecto ya apuntan a ztrack.app/automatico/
```

### 1.2 Iniciar contenedor

```bash
chmod +x up.sh
./up.sh
```

Equivalente manual:

```bash
docker compose up -d
```

El compose define:

- Contenedor: `n8n-telemetria` (distinto del n8n en 5678)
- Puerto host: **7001** → contenedor **5678**
- Volumen: `n8n_telemetria_data` (datos aislados)
- Subruta: `N8N_PATH=/automatico/`

### 1.3 Verificación local (161.132.53.51)

```bash
curl -I http://127.0.0.1:7001/automatico/
docker compose logs -f n8n-telemetria
```

Abre en navegador: `http://161.132.53.51:7001/automatico/` — debe aparecer
setup o login de n8n.

> Usa la IP solo para diagnóstico. OAuth y webhooks requieren la URL pública HTTPS.

### 1.4 Firewall (recomendado)

Permitir puerto **7001** solo desde la IP del servidor ztrack.app:

```bash
# Ejemplo ufw
sudo ufw allow from <IP_SERVIDOR_ZTRACK> to any port 7001 proto tcp
```

---

## Paso 2 — Servidor ztrack.app: proxy inverso Apache

### 2.1 Instalar configuración

En el servidor **ztrack.app**:

```bash
sudo cp infra/apache-ztrack-automatico.conf /etc/apache2/sites-available/ztrack-automatico.conf
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite headers ssl
sudo a2ensite ztrack-automatico.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Si ztrack.app ya tiene un VirtualHost `:443`, integra el bloque de
`apache-ztrack-automatico.conf` dentro de ese vhost (ver comentarios al final
del archivo).

### 2.2 Reglas proxy (referencia)

```apache
ProxyPass        /automatico/ http://161.132.53.51:7001/automatico/
ProxyPassReverse /automatico/ http://161.132.53.51:7001/automatico/
```

Incluye WebSocket y cabeceras `X-Forwarded-Proto` / `X-Forwarded-Host`.
Detalle completo: [fase_0_implicancias.md](./fase_0_implicancias.md).

### 2.3 Verificación pública

1. Abre `https://ztrack.app/automatico/`
2. Completa el registro inicial de n8n (usuario admin)
3. Consola del navegador **sin** errores WebSocket

---

## Paso 3 — PostgreSQL para el negocio

En el Postgres de `161.132.53.51` (o host acordado):

```bash
# Edita la contraseña en el SQL antes de ejecutar
psql -h 127.0.0.1 -U postgres -f infra/postgres/01-telemetria-db.sql
```

Las tablas de trazabilidad (`email_trace`, etc.) se crean en **F1** con
`schema.sql`.

### Verificación desde n8n

1. `https://ztrack.app/automatico/` → **Credentials → Postgres**
2. Host: `161.132.53.51` (o `host.docker.internal` / IP interna según red)
3. Database: `telemetria`, User: `telemetria_app`
4. Workflow prueba: **Postgres → Execute Query** → `SELECT 1 AS ok`

---

## Paso 4 — Google Cloud: OAuth2 para Gmail

### 4.1 APIs y consent screen

1. [Google Cloud Console](https://console.cloud.google.com/) → proyecto telemetría.
2. Habilitar **Gmail API**.
3. Configurar **OAuth consent screen**.

### 4.2 Redirect URI (con subruta `/automatico/`)

Registrar **exactamente**:

```
https://ztrack.app/automatico/rest/oauth2-credential/callback
```

> Distinta del n8n en puerto 5678. Puedes usar la misma app OAuth con varias
> redirect URIs o credenciales separadas.

### 4.3 Credencial en n8n

1. `https://ztrack.app/automatico/` → **Credentials → Gmail OAuth2**
2. Client ID + Client Secret
3. Scope inicial: `https://www.googleapis.com/auth/gmail.readonly`
4. **Connect my account**

### Verificación

Workflow prueba: **Gmail → Get Many**, límite 1 → debe devolver un correo.

---

## Paso 5 — Bot de Telegram

1. [@BotFather](https://t.me/BotFather) → `/newbot` → guardar **token**
2. Enviar mensaje al bot → `https://api.telegram.org/bot<TOKEN>/getUpdates` → anotar `chat.id`
3. En n8n: **Credentials → Telegram API** → pegar token

Integración en workflows: [fase_3.md](./fase_3.md).

---

## Paso 6 — Groq API (preparar para F6)

1. [console.groq.com](https://console.groq.com/) → API Key
2. n8n: credencial **Header Auth** con `Authorization: Bearer <KEY>`

---

## Paso 7 — Nodo de configuración central

Parámetros del workflow en un único nodo **Set** (`workflow.json` → **Configuración**):

| Campo | Fase | Descripción |
|-------|------|-------------|
| `mode` | F1 | `today` o `range` |
| `startDate` / `endDate` | F1 | Rango de revisión |
| `tzOffsetHours` | F1 | Lima = `-5` |
| `keywordFilterEnabled` | F2 | Activar filtro |
| `keywords` | F2 | `["Eusebio", "Luis", ...]` |
| `telegramChatId` | F3 | Chat ID destino |
| `restApiUrl` | F5 | URL API gestión |
| `groqModel` | F6 | ej. `llama-3.1-8b-instant` |
| `autoReplyEnabled` | F7 | `false` hasta validar asistido |

**Regla:** no hardcodear URLs ni tokens en nodos sueltos.

---

## Archivos de infraestructura en el repo

```
infra/
├── docker-compose.yml              n8n telemetría :7001
├── .env.example                    variables (N8N_PATH, WEBHOOK_URL, …)
├── up.sh                           script de arranque
├── apache-ztrack-automatico.conf   proxy en ztrack.app
└── postgres/01-telemetria-db.sql   BD negocio
```

---

## Checklist de cierre F0

### Servidor 161.132.53.51
- [ ] `docker compose ps` → `n8n-telemetria` healthy
- [ ] `http://161.132.53.51:7001/automatico/` responde
- [ ] Puerto 7001 no interfiere con n8n en 5678
- [ ] BD `telemetria` creada; `SELECT 1` OK desde n8n

### Servidor ztrack.app
- [ ] `https://ztrack.app/automatico/` carga UI completa
- [ ] WebSocket OK (sin errores en consola)
- [ ] ProxyPassReverse sin espacios en URL

### Credenciales
- [ ] Gmail OAuth2 con callback `/automatico/rest/oauth2-credential/callback`
- [ ] Telegram token guardado
- [ ] Groq API key guardada (F6)

### Documentación
- [ ] Leídas implicancias: [fase_0_implicancias.md](./fase_0_implicancias.md)

**Siguiente:** [fase_1.md](./fase_1.md) — importar workflow, `schema.sql`, trazabilidad.

---

## Solución de problemas — `password authentication failed for user "n8n_telemetria"`

### Causa

En tu `infra/.env` están **activas** las variables `DB_TYPE=postgresdb` y
`DB_POSTGRESDB_*`. n8n intenta usar PostgreSQL como base **interna** (workflows,
credenciales guardadas en n8n), pero:

- el usuario `n8n_telemetria` **no existe** en Postgres, o
- la contraseña en `.env` **no coincide** con la del usuario en Postgres.

Esto es **distinto** de la base `telemetria` / `telemetria_app` (negocio del flujo
de correos). Son dos bases separadas.

### Opción A — Recomendada para F0 (SQLite, más simple)

1. Edita `infra/.env` y **comenta o elimina** todas las líneas `DB_*`:

```bash
# DB_TYPE=postgresdb
# DB_POSTGRESDB_HOST=...
# DB_POSTGRESDB_USER=n8n_telemetria
# ...
```

2. Reinicia:

```bash
cd infra
docker compose down
docker compose up -d
docker compose logs -f n8n-telemetria
```

n8n guardará sus datos en el volumen Docker (`n8n_telemetria_data`) con SQLite.
Es suficiente para F0 y F1.

### Opción B — Postgres interno de n8n (si lo necesitas)

1. Crea usuario y BD en Postgres **antes** de levantar n8n:

```bash
# Edita la contraseña en el SQL y en .env — deben ser iguales
psql -h 127.0.0.1 -U postgres -f postgres/02-n8n-internal-db.sql
```

2. En `infra/.env`, host accesible **desde el contenedor Docker**:

```env
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=172.17.0.1
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=n8n_telemetria
DB_POSTGRESDB_USER=n8n_telemetria
DB_POSTGRESDB_PASSWORD=la_misma_del_sql
```

3. Asegura que `pg_hba.conf` permita conexiones desde la red Docker (ej.
`172.17.0.0/16`) con `md5` o `scram-sha-256`.

4. Reinicia: `docker compose down && docker compose up -d`

### Verificar que arrancó

```bash
curl -I http://127.0.0.1:7001/automatico/
docker compose logs n8n-telemetria | tail -20
# Debe decir "Editor is now accessible via..." sin "error initializing DB"
```

---

## Solución de problemas — pantalla en blanco / MIME type `text/html` en JS y CSS

### Síntoma

Consola del navegador (tanto en `https://ztrack.app/automatico/` como en
`http://161.132.53.51:7001/automatico/`):

```
Refused to apply style... MIME type ('text/html')
Failed to load module script... server responded with MIME type of 'text/html'
/automatico/static/base-path.js
```

### Diagnóstico: ¿Apache o n8n?

| Prueba | Conclusión |
|--------|------------|
| Falla **solo** en ztrack.app | Proxy Apache mal configurado o otro vhost captura `/automatico/` |
| Falla **también** en `161.132.53.51:7001` | **Problema en el contenedor n8n** (no es el proxy) |

Si te pasa con la IP directa, el proxy de ztrack.app **no es la causa principal**.

### Causa más probable

El HTML de la UI carga, pero las peticiones a `/automatico/static/*.js` reciben
**otra página HTML** (índice o error 404) en lugar de JavaScript. Eso ocurre cuando:

1. **n8n no terminó de arrancar** — sigue el error de Postgres (`error initializing DB`
   por `DB_*` en `.env`). El proceso muere y reinicia; las rutas estáticas no responden bien.
2. **`N8N_PATH` incorrecto o vacío** — el HTML pide `/automatico/static/...` pero n8n
   sirve los archivos en `/static/...` (sin prefijo). Cada `.js` devuelve HTML → pantalla blanca.
3. **Volumen iniciado sin subruta** — se cambió `.env` después del primer arranque; conviene
   recrear el contenedor (y en último caso borrar el volumen).

### Pasos para corregir (en 161.132.53.51)

**1. Ejecutar diagnóstico:**

```bash
cd infra
chmod +x diagnose.sh
./diagnose.sh
```

**2. Corregir `.env`** — mínimo necesario:

```env
N8N_HOST=ztrack.app
N8N_PROTOCOL=https
N8N_PORT=5678
N8N_PATH=/automatico/
N8N_EDITOR_BASE_URL=https://ztrack.app/automatico/
WEBHOOK_URL=https://ztrack.app/automatico/
N8N_PROXY_HOPS=1

# IMPORTANTE: comentar TODAS las líneas DB_* hasta tener Postgres n8n creado
# DB_TYPE=postgresdb
```

Comprueba que **no** exista `N8N_PATH=` vacío (anula el valor por defecto).

**3. Recrear contenedor:**

```bash
docker compose down
docker compose up -d --force-recreate
docker compose logs -f n8n-telemetria
```

Espera en el log: **`Editor is now accessible via...`** (sin `error initializing DB`).

**4. Validar Content-Type antes de abrir el navegador:**

```bash
curl -sI http://127.0.0.1:7001/automatico/static/base-path.js | grep -i content-type
# Debe ser: application/javascript  o  text/javascript
# Si dice text/html → sigue fallando N8N_PATH o n8n no está sano
```

**5. Probar en navegador:**

- `http://161.132.53.51:7001/automatico/` → debe cargar UI
- Luego `https://ztrack.app/automatico/` (tras proxy Apache)

**6. Si persiste** — reset del volumen (solo F0, pierdes setup admin):

```bash
docker compose down
docker volume rm n8n_telemetria_data
docker compose up -d
# Vuelve a registrar usuario en https://ztrack.app/automatico/
```

### Causa secundaria (solo ztrack.app)

Si la IP funciona pero ztrack.app no, revisa en el **vhost activo** de ztrack.app:

- El bloque `ProxyPass /automatico/` debe estar **antes** de cualquier `ProxyPass /` genérico.
- No debe haber reglas SPA/fallback que devuelvan `index.html` para `/automatico/static/*`.
- Usar el fragmento `<Location /automatico/>` de `infra/apache-ztrack-automatico.conf`
  **dentro** del VirtualHost que ya sirve ztrack.app (no un segundo vhost duplicado).
