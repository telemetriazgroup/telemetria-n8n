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

COPY app ./app

ENV PYTHONUNBUFFERED=1

EXPOSE 7200

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7200"]
