"""Gestión de ventanas n8n, cierre de runs y un solo proceso en curso."""

import logging
import re
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import settings
from app.database import (
    ControlRun,
    ControlState,
    DayProgress,
    count_completed,
    fetch_completed_dates,
    fetch_day_progress,
    first_incomplete_day_in_window,
    get_or_create_state,
)
from app.services.n8n_client import N8nClient
from app.services.planner import decide_window

logger = logging.getLogger(__name__)
_n8n = N8nClient()

_PROC_START_RE = re.compile(r"proc_start=(\d+)")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def run_age_seconds(run: ControlRun, now: datetime | None = None) -> float:
    now = now or utcnow()
    started = run.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return (now - started).total_seconds()


def days_in_window(w_start: date, w_end: date) -> list[date]:
    days: list[date] = []
    d = w_start
    while d <= w_end:
        days.append(d)
        d += timedelta(days=1)
    return days


def window_is_complete(completed: set[date], w_start: date, w_end: date) -> bool:
    return all(d in completed for d in days_in_window(w_start, w_end))


def parse_proc_start(note: str | None) -> int:
    m = _PROC_START_RE.search(note or "")
    return int(m.group(1)) if m else 0


def batch_note_suffix(target: date, prog: DayProgress) -> str:
    return (
        f"| día={target.isoformat()} proc_start={prog['emails_processed_count']} "
        f"listed={prog['emails_listed_count']}"
    )


def batch_progress_detected(
    run: ControlRun, prog: DayProgress, proc_start: int, now: datetime
) -> bool:
    if prog["emails_processed_count"] > proc_start:
        return True
    analyzed_at = prog["analyzed_at"]
    if not analyzed_at:
        return False
    if analyzed_at.tzinfo is None:
        analyzed_at = analyzed_at.replace(tzinfo=timezone.utc)
    started = run.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return analyzed_at >= started and prog["emails_processed_count"] >= proc_start


def n8n_execution_finished(state: ControlState, age_sec: float, progressed: bool) -> bool:
    if _n8n.monitor_configured():
        sync_n8n_execution_state_standalone(state)
        return not _n8n.workflow_is_running()
    return age_sec >= 45 and progressed


def sync_n8n_execution_state_standalone(state: ControlState) -> None:
    if not _n8n.monitor_configured() or not state.active_n8n_execution_id:
        return
    eid = str(state.active_n8n_execution_id)
    if eid == "webhook-accepted":
        if not _n8n.workflow_is_running():
            state.active_n8n_execution_id = None
        return
    running_ids = {str(e.get("id")) for e in _n8n.list_running_executions()}
    if eid not in running_ids:
        state.active_n8n_execution_id = None


def get_active_running_run(db: Session) -> ControlRun | None:
    return (
        db.query(ControlRun)
        .filter(ControlRun.status == "running")
        .order_by(ControlRun.started_at.desc())
        .first()
    )


def close_duplicate_running_runs(db: Session, keep: ControlRun | None) -> int:
    """Cierra runs «running» duplicados; deja solo `keep`."""
    running = (
        db.query(ControlRun)
        .filter(ControlRun.status == "running")
        .order_by(ControlRun.started_at.desc())
        .all()
    )
    closed = 0
    for run in running:
        if keep and run.id == keep.id:
            continue
        finalize_run(
            db,
            run,
            status="failed",
            note=(run.note or "") + " — Watchdog: duplicado cerrado (solo una sync en curso)",
        )
        closed += 1
    return closed


def finalize_run(
    db: Session,
    run: ControlRun,
    *,
    status: str,
    note: str,
    action: str | None = None,
) -> None:
    run.status = status
    run.finished_at = utcnow()
    run.days_completed_after = count_completed(db)
    run.note = note
    if action:
        run.action = action


def log_control_event(
    db: Session,
    *,
    action: str,
    status: str,
    note: str,
    window_start: date,
    window_end: date,
    execution_id: str | None = None,
    finished: bool = True,
) -> ControlRun:
    now = utcnow()
    before = count_completed(db)
    run = ControlRun(
        started_at=now,
        finished_at=now if finished else None,
        window_start=window_start,
        window_end=window_end,
        days_completed_before=before,
        days_completed_after=before if finished else None,
        action=action,
        status=status,
        n8n_execution_id=execution_id,
        note=note,
    )
    db.add(run)
    return run


def stop_n8n_executions(state: ControlState) -> list[str]:
    stopped: list[str] = []
    if state.active_n8n_execution_id:
        eid = str(state.active_n8n_execution_id)
        if eid != "webhook-accepted":
            try:
                _n8n.stop_execution(eid)
            except Exception as exc:
                logger.warning("No se pudo detener ejecución %s: %s", eid, exc)
        stopped.append(eid)
    if _n8n.monitor_configured():
        for ex in _n8n.list_running_executions():
            eid = str(ex.get("id", ""))
            if eid and eid not in stopped:
                try:
                    _n8n.stop_execution(eid)
                    stopped.append(eid)
                except Exception as exc:
                    logger.warning("No se pudo detener ejecución %s: %s", eid, exc)
    state.active_n8n_execution_id = None
    return stopped


def sync_n8n_execution_state(db: Session, state: ControlState) -> None:
    sync_n8n_execution_state_standalone(state)


def advance_window_after_success(db: Session, state: ControlState) -> None:
    completed = fetch_completed_dates(db)
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
    else:
        state.current_window_start = plan.window_start
        state.current_window_end = plan.window_end
    if completed:
        state.last_completed_date = max(completed)


def launch_window(
    db: Session,
    state: ControlState,
    w_start: date,
    w_end: date,
    action: str,
    note: str,
) -> ControlRun | None:
    if get_active_running_run(db):
        logger.info("Launch omitido: ya hay una sync en curso")
        return None

    before = count_completed(db)
    completed = fetch_completed_dates(db)
    target = first_incomplete_day_in_window(w_start, w_end, completed)
    prog = fetch_day_progress(db, target) if target else None
    suffix = batch_note_suffix(target, prog) if target and prog else ""
    execution_id: str | None = None
    status = "running"
    final_note = f"{note} {suffix}".strip()

    if _n8n.configured():
        try:
            execution_id = _n8n.trigger_historical(w_start.isoformat(), w_end.isoformat())
        except Exception as exc:
            logger.exception("Error al lanzar n8n")
            run = ControlRun(
                started_at=utcnow(),
                finished_at=utcnow(),
                window_start=w_start,
                window_end=w_end,
                days_completed_before=before,
                days_completed_after=before,
                action=action,
                status="failed",
                note=f"Lanzamiento fallido {w_start}–{w_end}: {exc}",
            )
            db.add(run)
            return run
    else:
        status = "failed"
        final_note = f"n8n no configurado — {note}"

    run = ControlRun(
        started_at=utcnow(),
        window_start=w_start,
        window_end=w_end,
        days_completed_before=before,
        action=action,
        status=status,
        n8n_execution_id=execution_id,
        note=final_note,
    )
    if status != "running":
        run.finished_at = utcnow()
        run.days_completed_after = before

    state.current_window_start = w_start
    state.current_window_end = w_end
    state.active_n8n_execution_id = execution_id
    db.add(run)
    logger.info("Lanzada ventana %s–%s (%s)", w_start, w_end, action)
    return run


def try_launch_next(db: Session, state: ControlState) -> ControlRun | None:
    if state.paused or get_active_running_run(db):
        return None

    completed = fetch_completed_dates(db)
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
        return None

    if plan.window_start is None or plan.window_end is None:
        return None

    action = plan.action if plan.action in ("launch", "retry_same", "slide_window") else "launch"
    return launch_window(
        db,
        state,
        plan.window_start,
        plan.window_end,
        action,
        f"Watchdog: {plan.message}",
    )


def _continue_after_batch(
    db: Session,
    state: ControlState,
    ws: date,
    we: date,
    target: date,
    prog: DayProgress,
) -> str:
    """Tras cerrar un lote: ventana completa, día completo o siguiente lote."""
    state.active_n8n_execution_id = None
    completed = fetch_completed_dates(db)
    listed = prog["emails_listed_count"]
    processed = prog["emails_processed_count"]
    match = prog["emails_match_count"]

    if window_is_complete(completed, ws, we):
        advance_window_after_success(db, state)
        return "completed"

    if prog["status"] == "completed":
        launch_window(
            db,
            state,
            ws,
            we,
            "retry_same",
            f"Día {target} completado ({processed}/{listed}, {match} match); continúa ventana",
        )
        return "batch_day_completed"

    launch_window(
        db,
        state,
        ws,
        we,
        "batch_partial",
        f"Lote parcial día {target}: {processed}/{listed} correos, {match} match",
    )
    return "batch_partial"


def evaluate_active_run(db: Session, state: ControlState) -> str | None:
    """
    Evalúa el run en curso (watchdog cada ~2 min). Devuelve:
      'completed'           — ventana OK en BD
      'batch_partial'       — lote parcial registrado; siguiente lote lanzado
      'batch_day_completed' — día cerrado; continúa ventana
      'timeout'             — superó timeout; cancelado
      'waiting'             — n8n aún procesando el lote
      None                  — no hay run activo
    """
    now = utcnow()
    timeout_sec = settings.control_exec_timeout_min * 60
    completed = fetch_completed_dates(db)

    active = get_active_running_run(db)
    close_duplicate_running_runs(db, active)
    active = get_active_running_run(db)

    if not active:
        return None

    ws, we = active.window_start, active.window_end

    if window_is_complete(completed, ws, we):
        finalize_run(
            db,
            active,
            status="completed",
            action="completed",
            note=f"Watchdog: ventana {ws}–{we} completada en email_history_day",
        )
        stop_n8n_executions(state)
        advance_window_after_success(db, state)
        return "completed"

    sync_n8n_execution_state(db, state)
    age = run_age_seconds(active, now)
    target = first_incomplete_day_in_window(ws, we, completed)

    if target and age >= 30:
        prog = fetch_day_progress(db, target)
        proc_start = parse_proc_start(active.note)
        progressed = batch_progress_detected(active, prog, proc_start, now)
        n8n_done = n8n_execution_finished(state, age, progressed)

        if progressed and n8n_done:
            listed = prog["emails_listed_count"]
            processed = prog["emails_processed_count"]
            match = prog["emails_match_count"]
            if prog["status"] == "completed":
                finalize_run(
                    db,
                    active,
                    status="completed",
                    action="batch_day_completed",
                    note=(
                        f"Lote final día {target}: {processed}/{listed} correos, "
                        f"{match} match — día completado"
                    ),
                )
            else:
                finalize_run(
                    db,
                    active,
                    status="completed",
                    action="batch_partial",
                    note=(
                        f"Lote parcial día {target}: {processed}/{listed} correos, "
                        f"{match} match (sector {settings.n8n_batch_size})"
                    ),
                )
            return _continue_after_batch(db, state, ws, we, target, prog)

        if n8n_done and not progressed and age >= 120:
            finalize_run(
                db,
                active,
                status="failed",
                action="retry_same",
                note=f"Lote sin avance día {target} tras {int(age)}s — reintento",
            )
            state.active_n8n_execution_id = None
            launch_window(
                db,
                state,
                ws,
                we,
                "retry_same",
                f"Reintento tras lote sin avance ({target})",
            )
            return "batch_partial"

    if age >= timeout_sec:
        stopped = stop_n8n_executions(state)
        ids = ", ".join(stopped) if stopped else "sin id n8n"
        finalize_run(
            db,
            active,
            status="timeout",
            action="retry_same",
            note=(
                f"Watchdog: {settings.control_exec_timeout_min} min sin cerrar lote "
                f"({ws}–{we}); cancelado (n8n: {ids})"
            ),
        )
        log_control_event(
            db,
            action="retry_same",
            status="completed",
            note=f"Watchdog: reintento automático programado para {ws}–{we}",
            window_start=ws,
            window_end=we,
        )
        return "timeout"

    return "waiting"


def reconcile_orphan_runs(db: Session) -> int:
    """Al arrancar: cierra runs «running» antiguos según BD o timeout."""
    now = utcnow()
    timeout_sec = settings.control_exec_timeout_min * 60
    completed = fetch_completed_dates(db)
    state = get_or_create_state(db)

    running = (
        db.query(ControlRun)
        .filter(ControlRun.status == "running")
        .order_by(ControlRun.started_at.desc())
        .all()
    )
    if not running:
        return 0

    fixed = 0
    primary = running[0]
    for run in running[1:]:
        finalize_run(
            db,
            run,
            status="failed",
            note="Watchdog arranque: run huérfano duplicado cerrado",
        )
        fixed += 1

    ws, we = primary.window_start, primary.window_end
    if window_is_complete(completed, ws, we):
        finalize_run(
            db,
            primary,
            status="completed",
            note=f"Watchdog arranque: ventana {ws}–{we} ya estaba completada",
        )
        state.active_n8n_execution_id = None
        advance_window_after_success(db, state)
        fixed += 1
    elif run_age_seconds(primary, now) >= timeout_sec:
        stop_n8n_executions(state)
        finalize_run(
            db,
            primary,
            status="failed",
            note=f"Watchdog arranque: run expirado ({ws}–{we}) marcado fallido",
        )
        fixed += 1

    return fixed
