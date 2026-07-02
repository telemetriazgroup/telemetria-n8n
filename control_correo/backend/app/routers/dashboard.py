from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.database import count_completed, fetch_completed_dates, get_db, get_or_create_state, program_range
from app.schemas import DashboardOut
from app.services.n8n_client import N8nClient
from app.services.planner import decide_window

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])
_n8n = N8nClient()


@router.get("", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db)) -> DashboardOut:
    state = get_or_create_state(db)
    completed = fetch_completed_dates(db)
    plan = decide_window(
        db,
        completed=completed,
        current_start=state.current_window_start,
        current_end=state.current_window_end,
        total_days=settings.total_program_days,
    )
    start, end = program_range()
    done = count_completed(db)
    total = settings.total_program_days
    running = _n8n.list_running_executions() if _n8n.monitor_configured() else []
    return DashboardOut(
        days_completed=done,
        days_total=total,
        percent=round(100.0 * done / total, 2) if total else 0,
        active_year=plan.active_year,
        active_month=plan.active_month,
        current_window_start=state.current_window_start or plan.window_start,
        current_window_end=state.current_window_end or plan.window_end,
        first_pending=plan.first_pending,
        paused=state.paused,
        last_poll_at=state.last_poll_at,
        n8n_configured=_n8n.configured(),
        active_n8n_execution_id=state.active_n8n_execution_id,
        n8n_running_count=len(running),
        program_range_start=start,
        program_range_end=end,
        poll_interval_sec=settings.control_poll_interval_sec,
        scheduler_enabled=settings.scheduler_enabled,
    )
