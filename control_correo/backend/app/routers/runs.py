from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import (
    ControlRun,
    count_completed,
    get_db,
    get_or_create_state,
    month_enabled,
    program_range,
)
from app.schemas import N8nTestOut, RunOut
from app.services.n8n_client import N8nClient

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


def _log_event(
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
    now = datetime.now(timezone.utc)
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


@router.get("/current")
def current_run(db: Session = Depends(get_db)) -> dict:
    state = get_or_create_state(db)
    running = _n8n.list_running_executions() if _n8n.configured() else []
    return {
        "paused": state.paused,
        "active_n8n_execution_id": state.active_n8n_execution_id,
        "current_window_start": state.current_window_start,
        "current_window_end": state.current_window_end,
        "last_poll_at": state.last_poll_at,
        "n8n_running": running,
    }


@router.get("", response_model=list[RunOut])
def list_runs(limit: int = 100, db: Session = Depends(get_db)) -> list[RunOut]:
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
    _log_event(
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
    _log_event(
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
    _log_event(
        db,
        action="launch",
        status="completed",
        note="Sincronización reanudada — ciclo automático cada 10 min",
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
    try:
        execution_id = _n8n.trigger_historical(start.isoformat(), end.isoformat())
    except Exception as exc:
        _log_event(
            db,
            action="launch",
            status="failed",
            note=f"Inicio manual fallido {start}→{end}: {exc}",
            window_start=start,
            window_end=end,
        )
        db.commit()
        raise HTTPException(502, f"Error al lanzar n8n: {exc}") from exc

    _log_event(
        db,
        action="launch",
        status="running",
        note=f"Inicio manual de sincronización {start} → {end}",
        window_start=start,
        window_end=end,
        execution_id=execution_id,
        finished=False,
    )
    state.current_window_start = start
    state.current_window_end = end
    state.active_n8n_execution_id = execution_id
    db.commit()
    return {
        "started": True,
        "window_start": start.isoformat(),
        "window_end": end.isoformat(),
        "n8n_execution_id": execution_id,
        "days_completed_before": before,
    }


@router.post("/cancel")
def cancel_sync(db: Session = Depends(get_db)) -> dict:
    state = get_or_create_state(db)
    ws, we = _window_for_log(state, db)
    stopped: list[str] = []

    if state.active_n8n_execution_id:
        try:
            _n8n.stop_execution(state.active_n8n_execution_id)
            stopped.append(state.active_n8n_execution_id)
        except Exception as exc:
            _log_event(
                db,
                action="stop",
                status="failed",
                note=f"Error al cancelar ejecución n8n: {exc}",
                window_start=ws,
                window_end=we,
                execution_id=state.active_n8n_execution_id,
            )
            db.commit()
            raise HTTPException(502, str(exc)) from exc

    for ex in _n8n.list_running_executions():
        eid = str(ex.get("id", ""))
        if eid and eid not in stopped:
            try:
                _n8n.stop_execution(eid)
                stopped.append(eid)
            except Exception:
                pass

    prev_id = state.active_n8n_execution_id
    state.active_n8n_execution_id = None
    ids_note = ", ".join(stopped) if stopped else (prev_id or "ninguna activa")
    _log_event(
        db,
        action="stop",
        status="cancelled",
        note=f"Sincronización cancelada desde la interfaz (n8n: {ids_note})",
        window_start=ws,
        window_end=we,
        execution_id=prev_id,
    )
    db.commit()
    return {"cancelled": True, "stopped_executions": stopped}
