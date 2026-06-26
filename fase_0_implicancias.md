# Fase 0 — Implicancias de arquitectura (n8n telemetría)

Documento de decisiones e implicancias para desplegar **n8n de telemetría** sin
conflictuar con el **n8n existente** (puerto 5678), usando puerto **7001** en el
servidor de aplicaciones y exposición pública vía **proxy inverso en ztrack.app**
bajo la subruta `/automatico/`.

---

## Topología

```
Usuario / OAuth (Google)
        │
        ▼ HTTPS
┌───────────────────────────┐
│  ztrack.app               │  Apache — SSL, dominio público
│  ProxyPass /automatico/   │
└─────────────┬─────────────┘
              │ HTTP (red interna o IP pública)
              ▼
┌───────────────────────────┐
│  161.132.53.51 :7001      │  Docker n8n-telemetria (contenedor :5678)
│  N8N_PATH=/automatico/    │
│  PostgreSQL (telemetria)  │
└───────────────────────────┘

┌───────────────────────────┐
│  Mismo u otro host :5678    │  n8n existente — NO se modifica
└───────────────────────────┘
```

| Rol | Host | Puerto | Ruta pública |
|-----|------|--------|--------------|
| n8n telemetría (este proyecto) | `161.132.53.51` | **7001** → contenedor 5678 | `https://ztrack.app/automatico/` |
| n8n existente | (otro) | **5678** | (su URL actual, sin cambios) |

---

## Implicancia 1 — Puerto 7001 vs n8n en 5678

**Decisión:** mapear `7001:5678` en Docker. Dentro del contenedor n8n **siempre**
escucha en 5678; el puerto 7001 es solo del host.

**Por qué:** evita colisión con el n8n ya operativo en 5678 en el mismo servidor.

**Implicaciones:**

- Acceso directo para pruebas: `http://161.132.53.51:7001/automatico/` (sin SSL).
- En producción la URL canónica es `https://ztrack.app/automatico/`; OAuth y
  webhooks **deben** usar la URL HTTPS con subruta, no la IP.
- Contenedor con nombre distinto (`n8n-telemetria`) y volumen distinto
  (`n8n_telemetria_data`) para no mezclar datos con el n8n existente.

---

## Implicancia 2 — n8n en `/`, subruta solo en ztrack.app

**Modelo acordado:**

```
161.132.53.51:7001/              ← n8n (raíz, sin /automatico/)
ztrack.app/automatico/*    →     161.132.53.51:7001/*   (Apache quita prefijo)
```

| Componente | Ruta |
|------------|------|
| Backend n8n | `/`, `/static/`, `/healthz`, `/rest/...` |
| URL pública | `https://ztrack.app/automatico/` |
| OAuth callback | `https://ztrack.app/automatico/rest/oauth2-credential/callback` |

**En `.env` del contenedor** (solo URLs públicas, no rutas internas):

```env
N8N_PATH=/automatico/
N8N_EDITOR_BASE_URL=https://ztrack.app/automatico/
WEBHOOK_URL=https://ztrack.app/automatico/
```

`N8N_PATH` le dice a la UI qué prefijo usar en enlaces cuando entras por
ztrack.app. **No** monta `/automatico/` dentro del contenedor.

**Apache en ztrack.app (strip-prefix):**

```apache
<Location /automatico/>
    ProxyPass        http://161.132.53.51:7001/
    ProxyPassReverse http://161.132.53.51:7001/
</Location>
```

```apache
# ❌ NO reenviar /automatico/ al backend
ProxyPass /automatico/ http://161.132.53.51:7001/automatico/
```

---

## Implicancia 3 — Proxy inverso en dos servidores

El SSL termina en **ztrack.app**. Entre ztrack y `161.132.53.51` puede ir HTTP
puerto 7001 (típico en red privada).

**Implicaciones de seguridad:**

- Restringir en firewall de `161.132.53.51` el puerto **7001** solo a la IP del
  servidor ztrack.app (no exponer 7001 a Internet si es evitable).
- Si 7001 es accesible públicamente, cualquiera podría abrir el editor sin pasar
  por el dominio; mitigar con firewall + autenticación n8n.

**Cabeceras recomendadas en Apache (ztrack.app):**

```apache
RequestHeader set X-Forwarded-Proto "https"
RequestHeader set X-Forwarded-Host "ztrack.app"
ProxyPreserveHost On
```

Sin `X-Forwarded-Proto`, n8n puede generar URLs `http://` o cookies inseguras.

---

## Implicancia 4 — WebSocket (UI en tiempo real)

La interfaz de n8n usa WebSocket (`/automatico/rest/push` con subruta). Si falla,
la UI carga pero muestra errores de conexión o no guarda workflows.

**En ztrack.app** hay que proxyar WebSocket además de HTTP:

```apache
RewriteEngine On
RewriteCond %{HTTP:Upgrade} websocket [NC]
RewriteCond %{HTTP:Connection} upgrade [NC]
RewriteRule ^/automatico/(.*) ws://161.132.53.51:7001/automatico/$1 [P,L]
```

Archivo listo: `infra/apache-ztrack-automatico.conf`.

**Implicación:** ambos servidores necesitan `proxy_wstunnel` y `rewrite` habilitados
en Apache del lado ztrack.

---

## Implicancia 5 — OAuth Gmail (redirect URI)

Con subruta, la URI de callback **cambia** respecto a un n8n en raíz:

```
https://ztrack.app/automatico/rest/oauth2-credential/callback
```

**Implicaciones:**

- Registrar **exactamente** esa URI en Google Cloud Console (OAuth Web client).
- Es distinta de la del n8n en 5678; cada instancia tiene su propia credencial
  OAuth o la misma app Google con **varias** redirect URIs autorizadas.
- Tras cambiar `N8N_EDITOR_BASE_URL`, reconectar credenciales Gmail en n8n si
  falla el callback.

---

## Implicancia 6 — WEBHOOK_URL y workflows futuros

Webhooks generados por n8n (Telegram trigger, callbacks F7, ingest REST) usarán:

```
https://ztrack.app/automatico/webhook/<id>
https://ztrack.app/automatico/webhook-test/<id>
```

**Implicaciones:**

- `WEBHOOK_URL` debe apuntar a la URL pública **antes** de activar workflows.
- Si se cambia la subruta o dominio, hay que actualizar env y **reactivar**
  workflows para regenerar URLs.
- El proxy ztrack debe permitir POST a `/automatico/webhook*` sin truncar body.

---

## Implicancia 7 — PostgreSQL separado de n8n interno

n8n guarda sus ejecuciones en su propia BD (SQLite por defecto en volumen Docker,
o Postgres si se configura `DB_TYPE=postgresdb`).

**Recomendación para telemetría:**

| Base | Uso |
|------|-----|
| Volumen `/home/node/.n8n` o Postgres n8n | Workflows, credenciales, historial n8n |
| Base `telemetria` | Tablas de negocio (`email_trace`, etc.) — [schema.sql](./schema.sql) |

**Implicación:** dos conexiones Postgres distintas en credenciales n8n (una opcional
para el propio n8n, otra obligatoria para el flujo de correos).

---

## Implicancia 8 — Orden de despliegue recomendado

1. **161.132.53.51:** levantar Docker (`infra/docker-compose.yml`), verificar
   `http://161.132.53.51:7001/automatico/`.
2. **161.132.53.51:** crear BD `telemetria` (`infra/postgres/01-telemetria-db.sql`).
3. **ztrack.app:** aplicar `infra/apache-ztrack-automatico.conf`, reload Apache.
4. **Navegador:** abrir `https://ztrack.app/automatico/`, completar setup n8n.
5. **n8n:** credenciales Postgres, Gmail OAuth, Telegram, Groq.
6. **Validar:** workflow prueba `SELECT 1` (ver [fase_0.md](./fase_0.md)).

No configurar OAuth con la IP directa; Google exige HTTPS en producción y la
redirect URI registrada es la de ztrack.app.

---

## Implicancia 9 — Conflictos y aislamiento

| Recurso | n8n existente | n8n telemetría |
|---------|---------------|----------------|
| Puerto host | 5678 | **7001** |
| Contenedor | (existente) | `n8n-telemetria` |
| Volumen datos | (existente) | `n8n_telemetria_data` |
| URL pública | (su dominio/ruta) | `/automatico/` |
| Workflows | independientes | repo `workflow.json` |

No compartir volumen Docker entre ambas instancias.

---

## Implicancia 10 — Riesgos frecuentes y mitigación

| Síntoma | Causa probable | Mitigación |
|---------|----------------|------------|
| UI en blanco / 404 en assets | Falta `N8N_PATH` o `N8N_EDITOR_BASE_URL` | Revisar `infra/.env` |
| WebSocket failed | Falta rewrite WS en Apache ztrack | `apache-ztrack-automatico.conf` |
| `redirect_uri_mismatch` | URI Google no incluye `/automatico/` | Añadir callback exacto |
| Webhooks 404 | `WEBHOOK_URL` incorrecto | Debe ser `https://ztrack.app/automatico/` |
| Cookies / login loop | Falta `X-Forwarded-Proto` | Cabeceras en Apache |
| Timeout desde ztrack | Firewall bloquea 7001 | Abrir 7001 solo desde IP ztrack |
| Mezcla con n8n 5678 | Mismo volumen o nombre contenedor | Usar compose de este repo |

---

## Checklist de validación post-despliegue

- [ ] `curl -I http://161.132.53.51:7001/automatico/` → respuesta n8n
- [ ] `https://ztrack.app/automatico/` → UI carga completa
- [ ] Consola navegador sin errores WebSocket
- [ ] OAuth Gmail conecta sin `redirect_uri_mismatch`
- [ ] Postgres `SELECT 1` OK desde workflow de prueba
- [ ] n8n en 5678 sigue operando sin cambios

---

## Referencias en el repo

| Archivo | Propósito |
|---------|-----------|
| [infra/docker-compose.yml](./infra/docker-compose.yml) | n8n :7001 + Postgres + Adminer :7901 |
| [fase_0_implicancias_postgres_docker.md](./fase_0_implicancias_postgres_docker.md) | Implicancias BD en Docker |
| [infra/apache-ztrack-automatico.conf](./infra/apache-ztrack-automatico.conf) | Proxy en ztrack.app |
| [fase_0.md](./fase_0.md) | Guía operativa paso a paso |
