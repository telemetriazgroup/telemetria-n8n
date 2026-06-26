# Infraestructura — n8n telemetría

## Modelo

```
n8n (161.132.53.51:7001)     →  raíz /
ztrack.app/automatico/       →  proxy quita /automatico/ y reenvía a :7001/
```

| Dónde | URL |
|-------|-----|
| Contenedor / pruebas curl | `http://161.132.53.51:7001/` |
| Uso normal (navegador) | `https://ztrack.app/automatico/` |

## 161.132.53.51

```bash
cd infra
cp .env.example .env
./up.sh
curl -I http://127.0.0.1:7001/healthz
```

## ztrack.app (solo Apache)

Integrar en el VirtualHost `:443` de ztrack.app:

```apache
<Location /automatico/>
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Host "ztrack.app"
    ProxyPreserveHost On
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/automatico/?(.*) ws://161.132.53.51:7001/$1 [P,L]
    ProxyPass        http://161.132.53.51:7001/
    ProxyPassReverse http://161.132.53.51:7001/
</Location>
```

Verificar:

```bash
curl -sI https://ztrack.app/automatico/static/base-path.js | grep -i content-type
```

OAuth Gmail: `https://ztrack.app/automatico/rest/oauth2-credential/callback`

Detalle: [fase_0.md](../fase_0.md) · [fase_0_implicancias.md](../fase_0_implicancias.md)
