# Fase 0 — Infraestructura y persistencia base

**Objetivo:** dejar operativo el entorno de telemetría: n8n en **puerto 7001**
(sin conflictuar con n8n existente en 5678), proxy inverso en **ztrack.app**
bajo `/automatico/`, PostgreSQL de negocio, y credenciales base.

**Arquitectura:** ver [fase_0_implicancias.md](./fase_0_implicancias.md).

| Servidor | Rol | Acceso |
|----------|-----|--------|
| `161.132.53.51` | Docker n8n en **raíz /** puerto 7001 | `http://161.132.53.51:7001/` |
| `ztrack.app` | Proxy: `/automatico/` → `:7001/` | `https://ztrack.app/automatico/` |

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
- Volumen: `n8n_telemetria_data`
- n8n escucha en **raíz /** (sin subcarpeta en Docker)

### 1.3 Verificación local (161.132.53.51)

```bash
curl -I http://127.0.0.1:7001/
curl -I http://127.0.0.1:7001/healthz
docker compose logs -f n8n-telemetria
```

Debe aparecer `Editor is now accessible via: https://ztrack.app/automatico`.

> **Navegador:** usa `https://ztrack.app/automatico/` (no `http://IP:7001/automatico/`).
> La IP sirve en `/` para curl y diagnóstico; `/automatico/` solo existe en ztrack.app.

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

### 2.2 Reglas proxy (strip-prefix — obligatorio en n8n 2.x)

Dentro del VirtualHost `:443` de ztrack.app:

```apache
<Location /automatico/>
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Host "ztrack.app"
    ProxyPreserveHost On

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/automatico/?(.*) ws://161.132.53.51:7001/$1 [P,L]

    # Quita /automatico/ al reenviar — NO uses ...7001/automatico/
    ProxyPass        http://161.132.53.51:7001/
    ProxyPassReverse http://161.132.53.51:7001/
</Location>
```

Archivo completo: `infra/apache-ztrack-automatico.conf`.

> **Importante:** `http://161.132.53.51:7001/automatico/` dará 404 en el backend.
> Eso es **normal**. La URL pública es `https://ztrack.app/automatico/`.

### 2.3 Verificación pública

```bash
# Desde cualquier máquina — Content-Type debe ser JavaScript, no HTML
curl -sI https://ztrack.app/automatico/static/base-path.js | grep -i content-type
```

1. Abre `https://ztrack.app/automatico/`
2. Completa el registro inicial de n8n (usuario admin)
3. Consola del navegador **sin** errores WebSocket ni MIME `text/html`

---

## Paso 3 — PostgreSQL de negocio (Docker + Adminer)

Incluido en `docker-compose.yml`: **no** hace falta instalar Postgres en el
servidor host. Ver implicancias: [fase_0_implicancias_postgres_docker.md](./fase_0_implicancias_postgres_docker.md).

### 3.1 Configurar contraseña

```bash
cd infra
cp .env.example .env
nano .env   # TELEMETRIA_DB_PASSWORD=una_contraseña_segura
```

### 3.2 Levantar stack completo

```bash
docker compose up -d
docker compose ps
```

Deben estar **Up (healthy):** `postgres-telemetria`, `n8n-telemetria`, `adminer-telemetria`.

Al **primer** arranque, Postgres ejecuta `schema.sql` y crea `email_trace` y
`email_attachment_ref` (listo para F1).

### 3.3 Adminer — administración gráfica (:7901)

Abre `http://161.132.53.51:7901` (restringir por firewall a IPs admin):

| Campo | Valor |
|-------|-------|
| Sistema | PostgreSQL |
| Servidor | `postgres-telemetria` |
| Usuario | `telemetria_app` |
| Contraseña | la de `TELEMETRIA_DB_PASSWORD` en `.env` |
| Base de datos | `telemetria` |

Debes ver las tablas `email_trace` y `email_attachment_ref`.

> **Seguridad:** no expongas `:7901` a Internet. Usa firewall o túnel SSH.

### 3.4 Credencial Postgres en n8n

1. `https://ztrack.app/automatico/` → **Credentials → Postgres**
2. Configuración:

| Campo | Valor |
|-------|-------|
| Host | `postgres-telemetria` |
| Port | `5432` |
| Database | `telemetria` |
| User | `telemetria_app` |
| Password | `TELEMETRIA_DB_PASSWORD` del `.env` |

3. Workflow prueba: **Postgres → Execute Query** → `SELECT 1 AS ok`

### SQLite vs PostgreSQL (recordatorio)

| | SQLite (volumen n8n) | PostgreSQL (contenedor) |
|--|----------------------|-------------------------|
| Uso | Interno n8n | Correos trazados |
| ¿F0? | Automático | Automático con compose |
| UI | — | Adminer :7901 |

### Instalación manual (alternativa)

Solo si **no** usas Docker para Postgres: `infra/postgres/01-telemetria-db.sql` + `schema.sql`.

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

1. `https://ztrack.app/automatico/` → **Credentials → Add credential → Gmail OAuth2 API**
   (no uses "Google OAuth2 API" — el nodo Gmail no la lista)
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
├── docker-compose.yml              n8n :7001 + Postgres + Adminer :7901
├── .env.example
├── up.sh
├── diagnose.sh
├── apache-ztrack-automatico.conf
└── postgres/01-telemetria-db.sql   solo instalación manual sin Docker
```

Implicancias Postgres Docker: [fase_0_implicancias_postgres_docker.md](./fase_0_implicancias_postgres_docker.md)

---

## Checklist de cierre F0

### Servidor 161.132.53.51
- [ ] `.env` con `TELEMETRIA_DB_PASSWORD` definido
- [ ] `docker compose ps` → `postgres-telemetria`, `n8n-telemetria`, `adminer-telemetria` healthy
- [ ] `http://127.0.0.1:7001/` responde (backend n8n)
- [ ] Adminer `:7901` muestra tablas `email_trace` / `email_attachment_ref`
- [ ] Credencial Postgres en n8n → `SELECT 1` OK (host `postgres-telemetria`)
- [ ] Puerto 7001 no interfiere con n8n en 5678
- [ ] Firewall restringe `:7901` a IPs admin

### Servidor ztrack.app
- [ ] `https://ztrack.app/automatico/` carga UI completa
- [ ] WebSocket OK (sin errores en consola)
- [ ] Proxy strip-prefix → `:7001/` (sin `/automatico/` en backend)

### Credenciales
- [ ] Gmail OAuth2 con callback `/automatico/rest/oauth2-credential/callback`
- [ ] Telegram token guardado
- [ ] Groq API key guardada (F6)

### Documentación
- [ ] [fase_0_implicancias.md](./fase_0_implicancias.md) (proxy / puertos)
- [ ] [fase_0_implicancias_postgres_docker.md](./fase_0_implicancias_postgres_docker.md) (BD)

**Siguiente:** [fase_1.md](./fase_1.md) — importar workflow y trazabilidad.

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

### Tu diagnóstico confirma el patrón n8n 2.x

```
/automatico/              → 404   ← normal en backend directo
/automatico/static/...    → 404   ← normal en backend directo
/static/base-path.js      → 200   ← backend sirve en raíz
/                         → 200
```

n8n **está sano**. El fallo es de **rutas**: el HTML pide `/automatico/static/...`
pero el backend solo tiene `/static/...`. Apache debe **quitar** `/automatico/`
al reenviar (strip-prefix).

### Corrección en ztrack.app

Cambia el proxy de:

```apache
# ❌ Incorrecto
ProxyPass /automatico/ http://161.132.53.51:7001/automatico/
```

a:

```apache
# ✅ Correcto (dentro de <Location /automatico/>)
ProxyPass        http://161.132.53.51:7001/
ProxyPassReverse http://161.132.53.51:7001/
```

Ver bloque completo en `infra/apache-ztrack-automatico.conf`, reload Apache, y:

```bash
curl -sI https://ztrack.app/automatico/static/base-path.js | grep -i content-type
# text/javascript
```

### No probar con IP + subruta

`http://161.132.53.51:7001/automatico/` **siempre** fallará (404). Usa:

- Producción: `https://ztrack.app/automatico/`
- Solo backend (sin UI completa): `http://161.132.53.51:7001/` + `./diagnose.sh`
