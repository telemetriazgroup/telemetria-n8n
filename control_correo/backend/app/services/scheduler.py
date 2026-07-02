"""Watchdog cada 2 min + lanzamiento automático cuando no hay sync en curso."""

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_or_create_state
from app.services.sync_manager import (
    evaluate_active_run,
    get_active_running_run,
    launch_window,
    reconcile_orphan_runs,
    try_launch_next,
    utcnow,
)

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler(timezone="America/Lima")


def watchdog_tick() -> None:
    db: Session = SessionLocal()
    try:
        state = get_or_create_state(db)
        state.last_poll_at = utcnow()

        result = evaluate_active_run(db, state)
        db.commit()

        if state.paused:
            if result:
                logger.info("Watchdog: ventana evaluada (%s); scheduler pausado", result)
            return

        if result == "completed":
            db.commit()
            run = try_launch_next(db, state)
            db.commit()
            if run:
                logger.info("Watchdog: siguiente ventana lanzada tras completar")
            return

        if result == "timeout":
            active = get_active_running_run(db)
            if not active:
                ws, we = state.current_window_start, state.current_window_end
                if ws and we:
                    launch_window(
                        db,
                        state,
                        ws,
                        we,
                        "retry_same",
                        f"Watchdog: reintento automático {ws}–{we} tras timeout",
                    )
                    db.commit()
            return

        if result == "waiting":
            return

        try_launch_next(db, state)
        db.commit()
    except Exception:
        logger.exception("Error en watchdog_tick")
        db.rollback()
    finally:
        db.close()


def start_scheduler() -> None:
    if not settings.scheduler_enabled:
        return

    db = SessionLocal()
    try:
        state = get_or_create_state(db)
        n = reconcile_orphan_runs(db)
        if not state.paused:
            try_launch_next(db, state)
        db.commit()
        if n:
            logger.info("Watchdog arranque: %s run(s) huérfanos reconciliados", n)
    finally:
        db.close()

    interval = settings.control_watchdog_interval_sec
    scheduler.add_job(
        watchdog_tick,
        "interval",
        seconds=interval,
        id="control_watchdog",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        "Watchdog iniciado cada %s s (timeout ejecución %s min)",
        interval,
        settings.control_exec_timeout_min,
    )


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
