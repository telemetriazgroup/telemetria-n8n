import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app.config import settings
from app.database import (
    ControlRun,
    SessionLocal,
    count_completed,
    fetch_completed_dates,
    get_or_create_state,
)
from app.services.n8n_client import N8nClient
from app.services.planner import decide_window

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler(timezone="America/Lima")
_n8n = N8nClient()


def poll_and_act() -> None:
    db: Session = SessionLocal()
    try:
        state = get_or_create_state(db)
        state.last_poll_at = datetime.now(timezone.utc)
        db.commit()

        if state.paused:
            logger.info("Scheduler pausado")
            return

        completed = fetch_completed_dates(db)
        before = len(completed)
        plan = decide_window(
            db,
            completed=completed,
            current_start=state.current_window_start,
            current_end=state.current_window_end,
            total_days=settings.total_program_days,
        )

        if plan.action == "done":
            state.current_window_start = None
            state.current_window_end = None
            state.active_n8n_execution_id = None
            db.commit()
            logger.info("Programa histórico completado")
            return

        running = _n8n.list_running_executions()
        active_id = state.active_n8n_execution_id

        if running:
            exec_ids = {str(e.get("id")) for e in running}
            if active_id and active_id not in exec_ids:
                state.active_n8n_execution_id = None
                db.commit()
                active_id = None

        if active_id or running:
            if state.last_poll_at and state.current_window_start:
                # Timeout: si no aumentó completed, cancelar (simplificado en MVP)
                pass
            db.commit()
            logger.info("Ejecución n8n en curso; esperando")
            return

        if plan.window_start is None or plan.window_end is None:
            return

        action = plan.action if plan.action in ("launch", "retry_same", "slide_window") else "launch"
        note = plan.message
        execution_id = None

        if _n8n.configured():
            try:
                execution_id = _n8n.trigger_historical(
                    plan.window_start.isoformat(),
                    plan.window_end.isoformat(),
                )
            except Exception as exc:
                logger.exception("Error al lanzar n8n: %s", exc)
                run = ControlRun(
                    started_at=datetime.now(timezone.utc),
                    finished_at=datetime.now(timezone.utc),
                    window_start=plan.window_start,
                    window_end=plan.window_end,
                    days_completed_before=before,
                    days_completed_after=before,
                    action=action,
                    status="failed",
                    note=f"Inicio automático fallido: {exc}",
                )
                db.add(run)
                db.commit()
                return
        else:
            note = "N8N no configurado; solo planificación registrada"

        after = count_completed(db)
        run = ControlRun(
            started_at=datetime.now(timezone.utc),
            window_start=plan.window_start,
            window_end=plan.window_end,
            days_completed_before=before,
            days_completed_after=after,
            action=action,
            status="running" if execution_id else "completed",
            n8n_execution_id=execution_id,
            note=f"Inicio automático scheduler — {note}",
        )
        state.current_window_start = plan.window_start
        state.current_window_end = plan.window_end
        state.active_n8n_execution_id = execution_id
        if completed:
            state.last_completed_date = max(completed)
        db.add(run)
        db.commit()
        logger.info("Ventana %s–%s acción=%s", plan.window_start, plan.window_end, action)
    finally:
        db.close()


def start_scheduler() -> None:
    if not settings.scheduler_enabled:
        return
    scheduler.add_job(
        poll_and_act,
        "interval",
        seconds=settings.control_poll_interval_sec,
        id="control_poll",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler iniciado cada %s s", settings.control_poll_interval_sec)


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
