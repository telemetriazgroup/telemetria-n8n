"""Watchdog cada 2 min: comprueba si el lote/día terminó y registra ciclos parciales."""

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_or_create_state
from app.services.live_sync import finalize_stale_live_runs, live_tick
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
        db.commit()

        result = evaluate_active_run(db, state)
        db.commit()

        if state.paused or not state.historical_auto_sync_enabled:
            if result:
                logger.info(
                    "Watchdog: ventana evaluada (%s); histórico manual o pausado",
                    result,
                )
            return

        if result == "completed":
            db.commit()
            run = try_launch_next(db, state)
            db.commit()
            if run:
                logger.info("Watchdog: siguiente ventana tras completar")
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


def live_today_tick() -> None:
    db: Session = SessionLocal()
    try:
        finalize_stale_live_runs(db)
        msg = live_tick(db)
        db.commit()
        if msg and "lanzado" in msg:
            logger.info("Live today: %s", msg)
    except Exception:
        logger.exception("Error en live_today_tick")
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
        if not state.paused and state.historical_auto_sync_enabled:
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
        "Watchdog iniciado cada %s s — histórico auto=%s (timeout %s min, batch %s)",
        interval,
        state.historical_auto_sync_enabled,
        settings.control_exec_timeout_min,
        settings.n8n_batch_size,
    )

    if settings.live_today_enabled:
        live_interval = max(60, settings.live_today_interval_sec)
        scheduler.add_job(
            live_today_tick,
            "interval",
            seconds=live_interval,
            id="control_live_today",
            replace_existing=True,
        )
        logger.info(
            "Live today iniciado cada %s s — franjas de %s min (GMT-5)",
            live_interval,
            settings.live_slot_minutes,
        )


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
