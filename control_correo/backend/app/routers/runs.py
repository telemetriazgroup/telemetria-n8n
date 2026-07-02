from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import ControlRun, get_db, get_or_create_state
from app.schemas import RunOut
from app.services.n8n_client import N8nClient

router = APIRouter(prefix="/api/v1/runs", tags=["runs"])
_n8n = N8nClient()


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
def list_runs(limit: int = 50, db: Session = Depends(get_db)) -> list[RunOut]:
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


@router.post("/pause")
def pause(db: Session = Depends(get_db)) -> dict:
    state = get_or_create_state(db)
    state.paused = True
    db.commit()
    return {"paused": True}


@router.post("/resume")
def resume(db: Session = Depends(get_db)) -> dict:
    state = get_or_create_state(db)
    state.paused = False
    db.commit()
    return {"paused": False}
