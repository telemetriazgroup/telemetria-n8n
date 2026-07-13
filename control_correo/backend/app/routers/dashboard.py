from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.database import (
    count_completed,
    count_days_with_match,
    count_scheduled_days,
    ensure_schedule_months,
    fetch_completed_dates,
    fetch_day_progress,
    first_incomplete_day_in_window,
    get_db,
    get_or_create_state,
    history_range_end,
    program_range,
    sum_match_emails,
    view_range_end,
)
from app.schemas import DashboardOut, LiveSlotOut, LiveTodayOut
from app.services.dates import today_lima, yesterday_lima
from app.services.live_planner import build_live_slot_views, live_day_summary
from app.services.n8n_client import N8nClient
from app.services.planner import decide_window
from app.services.sync_manager import (
    get_active_running_run,
    historical_blocks_live,
)

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])
_n8n = N8nClient()


@router.get("", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db)) -> DashboardOut:
    state = get_or_create_state(db)
    completed = fetch_completed_dates(db)
    start, end = program_range()
    ensure_schedule_months(db, start, end)
    total = count_scheduled_days(db)
    plan = decide_window(
        db,
        completed=completed,
        current_start=state.current_window_start,
        current_end=state.current_window_end,
        total_days=total,
    )
    done = count_completed(db)
    running = _n8n.list_running_executions() if _n8n.monitor_configured() else []
    n8n_flow = (
        _n8n.workflow_is_running()
        if _n8n.monitor_configured()
        else bool(state.active_n8n_execution_id)
    )

    ws = state.current_window_start or plan.window_start
    we = state.current_window_end or plan.window_end
    processing_date: Optional[date] = None
    day_status: Optional[str] = None
    day_listed = 0
    day_processed = 0
    day_match = 0
    day_percent = 0.0

    if ws and we:
        processing_date = first_incomplete_day_in_window(ws, we, completed)
    if not processing_date:
        processing_date = plan.first_pending

    if processing_date:
        prog = fetch_day_progress(db, processing_date)
        day_status = prog["status"]
        day_listed = prog["emails_listed_count"]
        day_processed = prog["emails_processed_count"]
        day_match = prog["emails_match_count"]
        if day_listed > 0:
            day_percent = round(100.0 * day_processed / day_listed, 1)

    active_run = get_active_running_run(db)
    sync_in_progress = bool(active_run) or n8n_flow

    today = today_lima()
    live_summary = live_day_summary(db, today)
    live_suspended, live_suspend_reason = historical_blocks_live(db)
    live_slots = [
        LiveSlotOut(**view)
        for view in build_live_slot_views(db, today)
    ]

    return DashboardOut(
        days_completed=done,
        days_total=total,
        percent=round(100.0 * done / total, 2) if total else 0,
        days_with_match=count_days_with_match(db),
        total_match_emails=sum_match_emails(db),
        active_year=plan.active_year,
        active_month=plan.active_month,
        current_window_start=ws,
        current_window_end=we,
        first_pending=plan.first_pending,
        paused=state.paused,
        last_poll_at=state.last_poll_at,
        n8n_configured=_n8n.configured(),
        active_n8n_execution_id=state.active_n8n_execution_id,
        n8n_running_count=len(running),
        n8n_flow_active=n8n_flow,
        sync_in_progress=sync_in_progress,
        active_run_id=active_run.id if active_run else None,
        active_run_started_at=active_run.started_at if active_run else None,
        processing_date=processing_date,
        day_status=day_status,
        day_listed=day_listed,
        day_processed=day_processed,
        day_match=day_match,
        day_percent=day_percent,
        batch_size=settings.n8n_batch_size,
        program_range_start=start,
        program_range_end=end,
        program_view_end=view_range_end(),
        program_history_end=history_range_end(),
        poll_interval_sec=settings.control_poll_interval_sec,
        watchdog_interval_sec=settings.control_watchdog_interval_sec,
        stall_timeout_min=settings.control_stall_timeout_min,
        exec_timeout_min=settings.control_exec_timeout_min,
        scheduler_enabled=settings.scheduler_enabled,
        sync_end_dynamic=True,
        yesterday_date=yesterday_lima(),
        live_today=LiveTodayOut(
            enabled=settings.live_today_enabled,
            today_date=today,
            interval_sec=settings.live_today_interval_sec,
            slot_minutes=settings.live_slot_minutes,
            slots_total=live_summary["slots_total"],
            slots_completed=live_summary["slots_completed"],
            slots_expected_by_now=live_summary["slots_expected_by_now"],
            slots_pending_now=live_summary["slots_pending_now"],
            current_time_lima=live_summary["current_time_lima"],
            percent=live_summary["percent"],
            percent_expected=live_summary["percent_expected"],
            emails_listed=live_summary["emails_listed"],
            emails_match=live_summary["emails_match"],
            last_poll_at=state.live_last_poll_at,
            suspended=live_suspended,
            suspend_reason=live_suspend_reason or None,
            slots=live_slots,
        ),
        historical_auto_sync_enabled=state.historical_auto_sync_enabled,
    )


@router.get("/live-today", response_model=LiveTodayOut)
def live_today_status(db: Session = Depends(get_db)) -> LiveTodayOut:
    state = get_or_create_state(db)
    today = today_lima()
    summary = live_day_summary(db, today)
    live_suspended, live_suspend_reason = historical_blocks_live(db)
    slots = [LiveSlotOut(**view) for view in build_live_slot_views(db, today)]
    return LiveTodayOut(
        enabled=settings.live_today_enabled,
        today_date=today,
        interval_sec=settings.live_today_interval_sec,
        slot_minutes=settings.live_slot_minutes,
        slots_total=summary["slots_total"],
        slots_completed=summary["slots_completed"],
        slots_expected_by_now=summary["slots_expected_by_now"],
        slots_pending_now=summary["slots_pending_now"],
        current_time_lima=summary["current_time_lima"],
        percent=summary["percent"],
        percent_expected=summary["percent_expected"],
        emails_listed=summary["emails_listed"],
        emails_match=summary["emails_match"],
        last_poll_at=state.live_last_poll_at,
        suspended=live_suspended,
        suspend_reason=live_suspend_reason or None,
        slots=slots,
    )
