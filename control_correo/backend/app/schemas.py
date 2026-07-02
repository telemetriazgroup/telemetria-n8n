from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class DashboardOut(BaseModel):
    days_completed: int
    days_total: int
    percent: float
    active_year: Optional[int]
    active_month: Optional[int]
    current_window_start: Optional[date]
    current_window_end: Optional[date]
    first_pending: Optional[date]
    paused: bool
    last_poll_at: Optional[datetime]
    n8n_configured: bool
    program_range_start: date
    program_range_end: date


class HistoryDayOut(BaseModel):
    analyzed_date: date
    status: str
    emails_listed_count: int
    emails_processed_count: int
    emails_match_count: int
    analyzed_at: datetime
    gmail_query: Optional[str] = None


class HistorySummaryMonth(BaseModel):
    year: int
    month: int
    days_in_month: int
    days_completed: int
    total_matches: int


class TraceOut(BaseModel):
    message_id: str
    thread_id: str
    subject: Optional[str]
    from_address: Optional[str]
    email_date: Optional[datetime]
    match_telemetria_keyword: Optional[str]
    match_person_keyword: Optional[str]
    gmail_link: Optional[str]
    reviewed_at: datetime


class TraceDetailOut(TraceOut):
    to_addresses: Optional[str]
    cc_addresses: Optional[str]
    body_text: Optional[str]
    snippet: Optional[str]
    match_telemetria_excerpt: Optional[str]
    match_person_excerpt: Optional[str]
    search_query: Optional[str]
    attachments: list[dict]


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
