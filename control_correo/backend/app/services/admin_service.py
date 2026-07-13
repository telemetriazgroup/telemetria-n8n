"""Reset de datos de correos, días históricos y logs."""

import logging
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings

logger = logging.getLogger(__name__)


def verify_reset_password(password: str) -> bool:
    return password == settings.admin_reset_password


def reset_mail_data(db: Session) -> dict:
    """Borra trazas, correos procesados, días, slots y ejecuciones. Conserva control_schedule y match config."""
    counts: dict[str, int] = {}
    tables = [
        "email_attachment_ref",
        "email_trace",
        "correos_procesados",
        "email_history_slot",
        "email_history_day",
        "control_run",
    ]
    for table in tables:
        n = db.execute(text(f"SELECT COUNT(*)::int FROM {table}")).scalar_one()
        counts[table] = int(n)
        db.execute(text(f"DELETE FROM {table}"))

    db.execute(
        text(
            """
            UPDATE control_state SET
                paused = true,
                last_poll_at = NULL,
                last_completed_date = NULL,
                current_window_start = NULL,
                current_window_end = NULL,
                active_n8n_execution_id = NULL,
                live_today_date = NULL,
                live_last_slot_index = NULL,
                live_last_poll_at = NULL
            WHERE id = 1
            """
        )
    )
    logger.warning("Reset completo de datos de correo ejecutado desde la UI")
    return {"cleared": counts, "control_state_reset": True}
