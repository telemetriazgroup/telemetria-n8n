from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql://telemetria_app:changeme@postgres-telemetria:5432/telemetria"
    )

    program_range_start: str = "2025-01-01"
    program_range_end: str = "2026-06-30"
    total_program_days: int = 546

    control_poll_interval_sec: int = 600
    control_exec_timeout_min: int = 15
    scheduler_enabled: bool = True  # env: SCHEDULER_ENABLED

    n8n_base_url: str = "http://n8n-telemetria:5678"
    n8n_api_key: str = ""
    n8n_workflow_id: str = ""
    n8n_webhook_path: str = "historico-run"

    cors_origins: str = "http://localhost:7201,http://161.132.53.51:7201"


settings = Settings()
