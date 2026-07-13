from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class DashboardOut(BaseModel):
    days_completed: int
    days_total: int
    percent: float
    days_with_match: int
    total_match_emails: int
    active_year: Optional[int]
    active_month: Optional[int]
    current_window_start: Optional[date]
    current_window_end: Optional[date]
    first_pending: Optional[date]
    paused: bool
    last_poll_at: Optional[datetime]
    n8n_configured: bool
    active_n8n_execution_id: Optional[str] = None
    n8n_running_count: int = 0
    n8n_flow_active: bool = False
    sync_in_progress: bool = False
    active_run_id: Optional[int] = None
    active_run_started_at: Optional[datetime] = None
    processing_date: Optional[date] = None
    day_status: Optional[str] = None
    day_listed: int = 0
    day_processed: int = 0
    day_match: int = 0
    day_percent: float = 0.0
    batch_size: int = 5
    program_range_start: date
    program_range_end: date
    program_view_end: date
    program_history_end: date
    poll_interval_sec: int
    watchdog_interval_sec: int
    exec_timeout_min: int
    scheduler_enabled: bool
    historical_auto_sync_enabled: bool = False
    sync_end_dynamic: bool = True
    yesterday_date: Optional[date] = None
    live_today: Optional["LiveTodayOut"] = None


class LiveSlotOut(BaseModel):
    slot_index: int
    label: str
    status: str
    emails_listed: int = 0
    emails_processed: int = 0
    emails_match: int = 0


class LiveTodayOut(BaseModel):
    enabled: bool
    today_date: date
    interval_sec: int
    slot_minutes: int
    slots_total: int
    slots_completed: int
    slots_expected_by_now: int = 0
    slots_pending_now: int = 0
    current_time_lima: str = ""
    percent: float
    percent_expected: float = 0.0
    emails_listed: int
    emails_match: int
    last_poll_at: Optional[datetime] = None
    slots: list[LiveSlotOut] = []


class HistoryDayOut(BaseModel):
    analyzed_date: date
    status: str
    emails_listed_count: int
    emails_processed_count: int
    emails_match_count: int
    analyzed_at: Optional[datetime] = None
    gmail_query: Optional[str] = None


class HistoryPlanDay(BaseModel):
    analyzed_date: date
    status: str
    emails_listed_count: int
    emails_processed_count: int
    emails_match_count: int
    analyzed_at: Optional[datetime] = None
    scheduled: bool = True


class HistorySummaryMonth(BaseModel):
    year: int
    month: int
    days_in_month: int
    days_completed: int
    total_matches: int


class DayAuditOut(BaseModel):
    analyzed_date: str
    found: bool
    status: Optional[str] = None
    match_ids_total: int = 0
    processed_ids_total: int = 0
    trace_ids_found: int = 0
    missing_match_ids: list[str] = []
    missing_count: int = 0


class DayRepairOut(BaseModel):
    ok: bool
    analyzed_date: Optional[str] = None
    repaired: int = 0
    message_ids: list[str] = []
    n8n_execution_id: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None
    missing_count: int = 0


class TraceOut(BaseModel):
    message_id: str
    thread_id: str
    subject: Optional[str]
    from_address: Optional[str]
    email_date: Optional[datetime]
    match_telemetria_keyword: Optional[str]
    match_person_keyword: Optional[str]
    match_telemetria_excerpt: Optional[str] = None
    match_person_excerpt: Optional[str] = None
    snippet: Optional[str] = None
    gmail_link: Optional[str]
    reviewed_at: Optional[datetime] = None


class TraceDetailOut(TraceOut):
    to_addresses: Optional[str]
    cc_addresses: Optional[str]
    body_text: Optional[str]
    snippet: Optional[str]
    match_telemetria_excerpt: Optional[str]
    match_person_excerpt: Optional[str]
    search_query: Optional[str]
    attachments: list[dict]


class ProcessedOut(BaseModel):
    message_id: str
    thread_id: str
    subject: Optional[str]
    from_address: Optional[str]
    email_date: Optional[datetime]
    snippet: Optional[str] = None
    gmail_link: Optional[str]
    processed_at: Optional[datetime] = None
    analyzed_date: Optional[date] = None
    review_mode: Optional[str] = None
    is_match: bool = False
    match_telemetria_keyword: Optional[str] = None
    match_person_keyword: Optional[str] = None
    match_telemetria_excerpt: Optional[str] = None
    match_person_excerpt: Optional[str] = None


class ProcessedDetailOut(ProcessedOut):
    to_addresses: Optional[str]
    cc_addresses: Optional[str]
    body_text: Optional[str]
    search_query: Optional[str]
    search_after: Optional[datetime] = None
    search_before: Optional[datetime] = None
    has_attachments: bool = False
    attachments: list[dict] = []


class ScheduleMonthOut(BaseModel):
    year: int
    month: int
    enabled: bool


class RunOut(BaseModel):
    id: int
    started_at: datetime
    finished_at: Optional[datetime]
    window_start: date
    window_end: date
    action: str
    status: str
    n8n_execution_id: Optional[str]
    days_completed_before: int
    days_completed_after: Optional[int]
    note: Optional[str]


class N8nTestOut(BaseModel):
    base_url: str
    webhook_path: str
    health_ok: bool
    health_detail: str = ""
    webhook_ok: bool
    webhook_detail: str = ""
    api_ok: bool
    api_detail: str = ""
    workflow_active: Optional[bool] = None
    trigger_configured: bool
    monitor_configured: bool
    overall_ok: bool
