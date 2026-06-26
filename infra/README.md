# Infraestructura — n8n telemetría

Despliegue en **161.132.53.51:7001** con URL pública
**https://ztrack.app/automatico/**.

Documentación completa: [fase_0.md](../fase_0.md) · [fase_0_implicancias.md](../fase_0_implicancias.md)

## Arranque rápido (161.132.53.51)

```bash
cd infra
cp .env.example .env
./up.sh
curl -I http://127.0.0.1:7001/automatico/
```

## Proxy (ztrack.app) — strip-prefix obligatorio

Integrar `<Location /automatico/>` del archivo `apache-ztrack-automatico.conf`
**dentro** del VirtualHost `:443` existente de ztrack.app.

```apache
ProxyPass        http://161.132.53.51:7001/
ProxyPassReverse http://161.132.53.51:7001/
```

**No** usar `...7001/automatico/` en el backend.

Verificar:

```bash
curl -sI https://ztrack.app/automatico/static/base-path.js | grep -i content-type
```

## PostgreSQL

```bash
psql -U postgres -f postgres/01-telemetria-db.sql
```

## OAuth Gmail — redirect URI

```
https://ztrack.app/automatico/rest/oauth2-credential/callback
```
