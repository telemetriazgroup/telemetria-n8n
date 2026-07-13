FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN mkdir -p /app/migrations
COPY migrations/06-control-correo.sql /app/migrations/06-control-correo.sql
COPY migrations/07-control-correo-range-2025.sql /app/migrations/07-control-correo-range-2025.sql
COPY migrations/08-control-correo-run-actions.sql /app/migrations/08-control-correo-run-actions.sql
COPY migrations/09-email-history-slot.sql /app/migrations/09-email-history-slot.sql
COPY migrations/10-open-calendar.sql /app/migrations/10-open-calendar.sql
COPY migrations/11-correos-procesados.sql /app/migrations/11-correos-procesados.sql
COPY migrations/12-match-config.sql /app/migrations/12-match-config.sql

COPY app ./app

ENV PYTHONUNBUFFERED=1

EXPOSE 7200

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7200"]
