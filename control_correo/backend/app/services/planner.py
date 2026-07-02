from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal, Optional

from sqlalchemy.orm import Session

from app.database import fetch_completed_dates, month_enabled, program_range

Action = Literal["launch", "retry_same", "slide_window", "wait", "done"]


@dataclass
class WindowPlan:
    action: Action
    window_start: Optional[date]
    window_end: Optional[date]
    first_pending: Optional[date]
    active_year: Optional[int]
    active_month: Optional[int]
    days_completed: int
    days_total: int
    message: str


def _is_scheduled(db: Session, d: date) -> bool:
    start, end = program_range()
    if d < start or d > end:
        return False
    return month_enabled(db, d)


def first_pending_day(db: Session, completed: set[date]) -> Optional[date]:
    start, end = program_range()
    d = start
    while d <= end:
        if _is_scheduled(db, d) and d not in completed:
            return d
        d += timedelta(days=1)
    return None


def completed_in_window(completed: set[date], w_start: date, w_end: date) -> set[date]:
    return {d for d in (w_start, w_end) if d in completed}


def decide_window(
    db: Session,
    completed: Optional[set[date]] = None,
    current_start: Optional[date] = None,
    current_end: Optional[date] = None,
    total_days: int = 546,
) -> WindowPlan:
    completed = completed if completed is not None else fetch_completed_dates(db)
    days_done = len(completed)
    D = first_pending_day(db, completed)

    if D is None:
        return WindowPlan(
            action="done",
            window_start=None,
            window_end=None,
            first_pending=None,
            active_year=None,
            active_month=None,
            days_completed=days_done,
            days_total=total_days,
            message="Rango programado completado",
        )

    start, end = program_range()

    if current_start and current_end:
        w_start, w_end = current_start, current_end
        done_w = completed_in_window(completed, w_start, w_end)

        if not done_w:
            return WindowPlan(
                action="retry_same",
                window_start=w_start,
                window_end=w_end,
                first_pending=D,
                active_year=D.year,
                active_month=D.month,
                days_completed=days_done,
                days_total=total_days,
                message=f"Reintento ventana {w_start}–{w_end}",
            )

        if w_start in done_w and w_end not in done_w:
            ns, ne = w_end, min(w_end + timedelta(days=1), end)
            return WindowPlan(
                action="slide_window",
                window_start=ns,
                window_end=ne,
                first_pending=D,
                active_year=D.year,
                active_month=D.month,
                days_completed=days_done,
                days_total=total_days,
                message=f"Avance parcial; nueva ventana {ns}–{ne}",
            )

        if w_start in done_w and w_end in done_w:
            ns = w_end + timedelta(days=1)
            if ns > end or not _is_scheduled(db, ns):
                D2 = first_pending_day(db, completed)
                if D2 is None:
                    return WindowPlan(
                        action="done",
                        window_start=None,
                        window_end=None,
                        first_pending=None,
                        active_year=None,
                        active_month=None,
                        days_completed=days_done,
                        days_total=total_days,
                        message="Completado",
                    )
                ns = D2
            ne = min(ns + timedelta(days=1), end)
            return WindowPlan(
                action="launch",
                window_start=ns,
                window_end=ne,
                first_pending=D,
                active_year=ns.year,
                active_month=ns.month,
                days_completed=days_done,
                days_total=total_days,
                message=f"Ventana cumplida; siguiente {ns}–{ne}",
            )

    ne = min(D + timedelta(days=1), end)
    return WindowPlan(
        action="launch",
        window_start=D,
        window_end=ne,
        first_pending=D,
        active_year=D.year,
        active_month=D.month,
        days_completed=days_done,
        days_total=total_days,
        message=f"Nueva ventana {D}–{ne}",
    )
