-- Configuración editable de palabras de match (UI control_correo).

CREATE TABLE IF NOT EXISTS control_match_config (
    id                   SMALLINT PRIMARY KEY DEFAULT 1,
    telemetria_variants  JSONB NOT NULL DEFAULT '[
        "telemetria", "telemetría", "telemtria", "telemetrai",
        "madurador", "ztrack", "api", "software", "plataforma"
    ]'::jsonb,
    person_keywords      JSONB NOT NULL DEFAULT '["Luis", "Eusebio"]'::jsonb,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT control_match_config_singleton CHECK (id = 1)
);

INSERT INTO control_match_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
