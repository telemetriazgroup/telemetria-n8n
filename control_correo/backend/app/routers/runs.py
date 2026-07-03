from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import (
    count_completed,
    get_db,
    get_or_create_state,
    month_enabled,
    program_range,
)
from app.schemas import N8nTestOut, RunOut
from app.services.n8n_client import N8nClient
from app.services.sync_manager import (
    evaluate_active_run,
    finalize_run,
    get_active_running_run,
    launch_window,
    log_control_event,
    reconcile_orphan_runs,
    stop_n8n_executions,
    try_launch_next,
)

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])
_n8n = N8nClient()


class TriggerRequest(BaseModel):
    start_date: date
    end_date: date | None = None


def _window_for_log(state, db: Session) -> tuple[date, date]:
    start, end = program_range()
    ws = state.current_window_start or start
    we = state.current_window_end or min(ws + timedelta(days=1), end)
    return ws, we


@router.get("/current")
def current_run(db: Session = Depends(get_db)) -> dict:
    state = get_or_create_state(db)
    running = _n8n.list_running_executions() if _n8n.configured() else []
    active = get_active_running_run(db)
    return {
        "paused": state.paused,
        "active_n8n_execution_id": state.active_n8n_execution_id,
        "active_run_id": active.id if active else None,
        "current_window_start": state.current_window_start,
        "current_window_end": state.current_window_end,
        "last_poll_at": state.last_poll_at,
        "n8n_running": running,
    }


@router.get("", response_model=list[RunOut])
def list_runs(limit: int = 100, db: Session = Depends(get_db)) -> list[RunOut]:
    from app.database import ControlRun

    rows = (
        db.query(ControlRun)
        .order_by(ControlRun.started_at.desc())
        .limit(limit)
        .all()
    )
    return [
        RunOut(
            id=r.id,
            started_at=r.started_at,
            finished_at=r.finished_at,
            window_start=r.window_start,
            window_end=r.window_end,
            action=r.action,
            status=r.status,
            n8n_execution_id=r.n8n_execution_id,
            days_completed_before=r.days_completed_before,
            days_completed_after=r.days_completed_after,
            note=r.note,
        )
        for r in rows
    ]


@router.post("/test-n8n", response_model=N8nTestOut)
def test_n8n(db: Session = Depends(get_db)) -> N8nTestOut:
    state = get_or_create_state(db)
    result = _n8n.test_connection()
    ws, we = _window_for_log(state, db)
    summary = "OK" if result["overall_ok"] else "FALLÓ"
    parts = []
    if result["health_ok"]:
        parts.append("health OK")
    else:
        parts.append(f"health: {result['health_detail']}")
    if result["webhook_ok"]:
        parts.append("webhook OK")
    else:
        parts.append(f"webhook: {result['webhook_detail']}")
    if result.get("api_detail"):
        parts.append(result["api_detail"])
    log_control_event(
        db,
        action="wait",
        status="completed" if result["overall_ok"] else "failed",
        note=f"Prueba enlace n8n — {summary}: {'; '.join(parts)}",
        window_start=ws,
        window_end=we,
    )
    db.commit()
    return N8nTestOut(**result)


@router.post("/pause")
def pause(db: Session = Depends(get_db)) -> dict:
    state = get_or_create_state(db)
    ws, we = _window_for_log(state, db)
    state.paused = True
    log_control_event(
        db,
        action="stop",
        status="completed",
        note="Sincronización pausada desde la interfaz",
        window_start=ws,
        window_end=we,
    )
    db.commit()
    return {"paused": True}


@router.post("/resume")
def resume(db: Session = Depends(get_db)) -> dict:
    state = get_or_create_state(db)
    ws, we = _window_for_log(state, db)
    state.paused = False
    log_control_event(
        db,
        action="launch",
        status="completed",
        note="Sincronización reanudada — watchdog cada 2 min",
        window_start=ws,
        window_end=we,
    )
    db.commit()
    return {"paused": False}


@router.post("/trigger")
def trigger_manual(body: TriggerRequest, db: Session = Depends(get_db)) -> dict:
    state = get_or_create_state(db)
    if not state.paused:
        raise HTTPException(
            400,
            "Pausa la sincronización automática antes de elegir fechas manuales",
        )

    active = get_active_running_run(db)
    if active:
        raise HTTPException(
            409,
            f"Ya hay una sincronización en curso (ventana {active.window_start}→"
            f"{active.window_end}). Cancélala antes de lanzar otra.",
        )

    prog_start, prog_end = program_range()
    start = body.start_date
    end = body.end_date or min(start + timedelta(days=1), prog_end)

    if start < prog_start or end > prog_end or start >= end:
        raise HTTPException(400, f"Ventana inválida; rango permitido {prog_start}–{prog_end}")
    if not month_enabled(db, start) or not month_enabled(db, end):
        raise HTTPException(400, "Mes no habilitado en el calendario de control")

    if not _n8n.configured():
        raise HTTPException(503, "n8n no configurado (webhook o API key + workflow id)")

    before = count_completed(db)
    run = launch_window(
        db,
        state,
        start,
        end,
        "launch",
        f"Inicio manual de sincronización {start} → {end}",
    )
    if not run or run.status != "running":
        db.commit()
        raise HTTPException(502, run.note if run else "No se pudo lanzar")

    db.commit()
    return {
        "started": True,
        "window_start": start.isoformat(),
        "window_end": end.isoformat(),
        "n8n_execution_id": run.n8n_execution_id,
        "run_id": run.id,
        "days_completed_before": before,
    }


@router.post("/cancel")
def cancel_sync(db: Session = Depends(get_db)) -> dict:
    state = get_or_create_state(db)
    ws, we = _window_for_log(state, db)
    active = get_active_running_run(db)
    stopped = stop_n8n_executions(state)

    if active:
        ids_note = ", ".join(stopped) if stopped else "sin detener en n8n"
        finalize_run(
            db,
            active,
            status="cancelled",
            note=f"Sincronización cancelada desde la interfaz (n8n: {ids_note})",
        )
    else:
        ids_note = ", ".join(stopped) if stopped else "ninguna activa"
        log_control_event(
            db,
            action="stop",
            status="cancelled",
            note=f"Cancelación solicitada (n8n: {ids_note})",
            window_start=ws,
            window_end=we,
            execution_id=state.active_n8n_execution_id,
        )

    db.commit()
    return {"cancelled": True, "stopped_executions": stopped}


@router.post("/reconcile")
def reconcile_runs(db: Session = Depends(get_db)) -> dict:
    """Cierra runs «en curso» huérfanos y reevalúa la ventana activa."""
    state = get_or_create_state(db)
    fixed = reconcile_orphan_runs(db)
    result = evaluate_active_run(db, state)
    launched = False
    if not state.paused:
        if result == "completed":
            launched = try_launch_next(db, state) is not None
        elif result == "timeout":
            ws, we = state.current_window_start, state.current_window_end
            if ws and we and not get_active_running_run(db):
                launched = (
                    launch_window(
                        db,
                        state,
                        ws,
                        we,
                        "retry_same",
                        f"Reconcile: reintento {ws}–{we} tras timeout",
                    )
                    is not None
                )
        elif result is None:
            launched = try_launch_next(db, state) is not None
    db.commit()
    active = get_active_running_run(db)
    return {
        "orphans_closed": fixed,
        "evaluation": result,
        "launched": launched,
        "active_run_id": active.id if active else None,
    }
