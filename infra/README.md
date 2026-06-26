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

## Proxy (ztrack.app)

```bash
sudo cp apache-ztrack-automatico.conf /etc/apache2/sites-available/ztrack-automatico.conf
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite headers ssl
sudo a2ensite ztrack-automatico.conf
sudo apache2ctl configtest && sudo systemctl reload apache2
```

Verificar: https://ztrack.app/automatico/

## PostgreSQL

```bash
psql -U postgres -f postgres/01-telemetria-db.sql
```

## OAuth Gmail — redirect URI

```
https://ztrack.app/automatico/rest/oauth2-credential/callback
```
