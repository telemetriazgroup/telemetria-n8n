from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql://telemetria_app:changeme@postgres-telemetria:5432/telemetria"
    )

    # Histórico: inicio fijo (puede moverse más atrás vía env). Fin = ayer Lima (dinámico).
    program_range_start: str = "2025-01-01"
    program_range_end_override: str = ""  # vacío → ayer America/Lima

    control_poll_interval_sec: int = 600
    control_watchdog_interval_sec: int = 120
    control_exec_timeout_min: int = 90
    scheduler_enabled: bool = True

    # Seguimiento en vivo del día actual (independiente del histórico)
    live_today_enabled: bool = True
    live_today_interval_sec: int = 600
    live_slot_minutes: int = 60
    live_exec_timeout_min: int = 25

    n8n_base_url: str = "http://n8n-telemetria:5678"
    n8n_api_key: str = ""
    n8n_workflow_id: str = ""
    n8n_webhook_path: str = "historico-run"
    n8n_webhook_live_path: str = "live-run"
    n8n_batch_size: int = 5

    cors_origins: str = "http://localhost:7201,http://161.132.53.51:7201"


settings = Settings()
