"""Seguimiento en vivo del día actual — ciclo cada 10 min (franjas horarias)."""

import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import (
    get_or_create_state,
    rollup_live_day_to_history,
)
from app.services.dates import today_lima
from app.services.live_planner import live_day_summary, next_live_slot
from app.services.n8n_client import N8nClient
from app.services.sync_manager import get_active_live_run, historical_blocks_live

logger = logging.getLogger(__name__)
_n8n = N8nClient()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _handle_day_rollover(db: Session, state) -> None:
    today = today_lima()
    tracked = getattr(state, "live_today_date", None)
    if tracked and tracked < today:
        rollup_live_day_to_history(db, tracked)
        logger.info("Live: día %s archivado en email_history_day", tracked)
    db.execute(
        text(
            """
            UPDATE control_state
            SET live_today_date = :today,
                live_last_slot_index = NULL
            WHERE id = 1
            """
        ),
        {"today": today},
    )


def live_tick(db: Session) -> str | None:
    """
    Ejecuta un ciclo de seguimiento en vivo.
    Devuelve mensaje corto o None si no hubo acción.
    """
    if not settings.live_today_enabled:
        return None

    state = get_or_create_state(db)
    _handle_day_rollover(db, state)

    db.execute(
        text("UPDATE control_state SET live_last_poll_at = :ts WHERE id = 1"),
        {"ts": _utcnow()},
    )

    if get_active_live_run(db):
        return "live run en curso"

    blocked, reason = historical_blocks_live(db)
    if blocked:
        logger.info("Live suspendido: %s", reason)
        return f"live suspendido: {reason}"

    slot = next_live_slot(db)
    if not slot:
        return "sin franjas pendientes hoy"

    if not _n8n.configured():
        return "n8n no configurado"

    execution_id = _n8n.trigger_live_slot(
        process_date=slot.analyzed_date.isoformat(),
        slot_index=slot.slot_index,
        slot_start_epoch=slot.slot_start_epoch,
        slot_end_epoch=slot.slot_end_epoch,
        slot_label=slot.label,
    )

    before = live_day_summary(db, slot.analyzed_date)["slots_completed"]
    db.execute(
        text(
            """
            INSERT INTO control_run (
                started_at, window_start, window_end,
                days_completed_before, action, status,
                n8n_execution_id, note
            ) VALUES (
                :now, :ws, :we, :before, 'launch', 'running',
                :eid, :note
            )
            """
        ),
        {
            "now": _utcnow(),
            "ws": slot.analyzed_date,
            "we": slot.analyzed_date,
            "before": before,
            "eid": execution_id,
            "note": (
                f"live_today franja #{slot.slot_index} "
                f"{slot.label} ({slot.analyzed_date})"
            ),
        },
    )
    db.execute(
        text(
            """
            UPDATE control_state
            SET live_last_slot_index = :idx, active_n8n_execution_id = :eid
            WHERE id = 1
            """
        ),
        {"idx": slot.slot_index, "eid": execution_id},
    )
    logger.info(
        "Live: lanzada franja %s #%s (%s)",
        slot.analyzed_date,
        slot.slot_index,
        slot.label,
    )
    return f"live slot {slot.slot_index} lanzado"


def finalize_stale_live_runs(db: Session) -> int:
    """Cierra runs live running cuya franja ya está completed en BD."""
    rows = db.execute(
        text(
            """
            SELECT id, note FROM control_run
            WHERE status = 'running' AND note ILIKE '%live_today%'
            """
        )
    ).mappings().all()
    closed = 0
    for row in rows:
        note = row["note"] or ""
        if "franja #" not in note:
            continue
        try:
            idx = int(note.split("franja #")[1].split()[0])
        except (IndexError, ValueError):
            continue
        day = today_lima()
        status = db.execute(
            text(
                """
                SELECT status FROM email_history_slot
                WHERE analyzed_date = :day AND slot_index = :idx
                """
            ),
            {"day": day, "idx": idx},
        ).scalar()
        if status in ("completed", "partial", "failed"):
            db.execute(
                text(
                    """
                    UPDATE control_run
                    SET status = 'completed', finished_at = :now,
                        note = note || ' — cerrado por slot en BD'
                    WHERE id = :id
                    """
                ),
                {"now": _utcnow(), "id": row["id"]},
            )
            closed += 1
    return closed
