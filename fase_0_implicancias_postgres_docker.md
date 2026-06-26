# Implicancias — PostgreSQL y Adminer en Docker (F0)

Stack integrado en `infra/docker-compose.yml`: **n8n + PostgreSQL negocio + Adminer**.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  161.132.53.51                                              │
│                                                             │
│  :7001  n8n-telemetria ──────► SQLite (volumen n8n interno) │
│              │                                              │
│              │ red telemetria-net                            │
│              ▼                                              │
│         postgres-telemetria :5432  (sin puerto público)     │
│              │   volumen postgres_telemetria_data           │
│              │   tablas: email_trace, email_attachment_ref  │
│              ▲                                              │
│  :7901  adminer-telemetria (UI web)                         │
└─────────────────────────────────────────────────────────────┘

ztrack.app/automatico/  →  proxy  →  :7001
```

---

## Tres almacenamientos distintos (no mezclar)

| Almacén | Dónde | Para qué |
|---------|-------|----------|
| SQLite en volumen `n8n_telemetria_data` | Contenedor n8n | Workflows, credenciales n8n, historial ejecuciones n8n |
| PostgreSQL `telemetria` | Contenedor `postgres-telemetria` | Datos de negocio: correos trazados (F1+) |
| Adminer `:7901` | Contenedor `adminer-telemetria` | Solo interfaz; no guarda datos |

**No hace falta** instalar PostgreSQL en el servidor host (161.132.53.51) ni usar
`02-n8n-internal-db.sql` mientras n8n use SQLite.

---

## Ventajas

- Un solo `docker compose up -d` levanta todo el stack F0.
- `schema.sql` se aplica solo en el **primer** arranque del volumen Postgres.
- n8n se conecta por nombre de servicio `postgres-telemetria` (red interna).
- Adminer en `:7901` permite ver tablas sin instalar pgAdmin en el host.
- No compite con otros Postgres del servidor ni con el n8n en `:5678`.

---

## Implicancias y riesgos

### 1. Persistencia en volúmenes Docker

Los datos viven en volúmenes nombrados:

- `postgres_telemetria_data` — correos trazados
- `n8n_telemetria_data` — n8n interno

**Backup:** hacer dump periódico:

```bash
docker exec postgres-telemetria pg_dump -U telemetria_app telemetria > backup.sql
```

`docker compose down` **no** borra volúmenes. `docker volume rm postgres_telemetria_data`
**sí** borra todos los correos trazados.

### 2. Init scripts solo al crear el volumen

`schema.sql` se monta en `/docker-entrypoint-initdb.d/` y corre **una vez**.
Si cambias `schema.sql` después, debes migrar a mano o recrear el volumen.

### 3. Puerto 7901 (Adminer) — seguridad

Adminer **no tiene login propio fuerte** por defecto: quien acceda a
`http://161.132.53.51:7901` puede intentar conectarse a Postgres si conoce la
contraseña.

**Recomendado:**

- Firewall: permitir `:7901` solo desde IPs de administración (VPN, oficina).
- **No** exponer `:7901` a Internet público sin túnel SSH o proxy con auth.
- Contraseña fuerte en `TELEMETRIA_DB_PASSWORD`.

Opcional futuro: proxy Adminer bajo ztrack.app con auth Basic, o SSH tunnel:

```bash
ssh -L 7901:127.0.0.1:7901 user@161.132.53.51
```

### 4. Postgres sin puerto público

El puerto `5432` **no** se publica al host. Solo contenedores en `telemetria-net`
pueden conectar. Herramientas externas (DBeaver en tu PC) necesitan túnel SSH o
publicar `5432` temporalmente (no recomendado en producción).

### 5. Orden de arranque

n8n espera `postgres-telemetria` healthy antes de iniciar. Si Postgres falla,
n8n no arranca.

### 6. Credencial Postgres en n8n (manual)

Docker **no** crea la credencial en n8n automáticamente. Tras el primer login:

| Campo | Valor |
|-------|-------|
| Host | `postgres-telemetria` |
| Port | `5432` |
| Database | `telemetria` |
| User | `telemetria_app` |
| Password | valor de `TELEMETRIA_DB_PASSWORD` en `.env` |

### 7. Recursos del servidor

Postgres + n8n + Adminer consumen RAM/CPU adicional. En servidor compartido con
el n8n `:5678`, vigilar memoria (Postgres suele usar ~100–300 MB mínimo).

### 8. Adminer vs pgAdmin

Se eligió **Adminer** (ligero, puerto 7901). Si más adelante necesitas roles,
permisos gráficos o ERD, se puede sustituir por pgAdmin en el mismo compose.

---

## Puertos resumen

| Puerto | Servicio | Exposición recomendada |
|--------|----------|------------------------|
| 7001 | n8n | ztrack.app vía proxy + IP restringida |
| 7901 | Adminer | Solo IPs admin / SSH tunnel |
| 5432 | Postgres | **Solo red Docker** (no publicar) |
| 5678 | n8n existente | Sin cambios (otra instancia) |

---

## Checklist F0 con Docker Postgres

- [ ] `.env` con `TELEMETRIA_DB_PASSWORD` definido
- [ ] `docker compose up -d` — 3 contenedores healthy
- [ ] Adminer: `http://161.132.53.51:7901` → tablas `email_trace` visibles
- [ ] n8n credencial Postgres → `SELECT 1` OK
- [ ] Firewall en `:7901`

Referencia operativa: [fase_0.md](./fase_0.md) paso 3.
