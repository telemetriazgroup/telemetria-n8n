from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import (
    ensure_schedule_months,
    get_db,
    history_range_end,
    month_enabled,
    program_range,
)
from app.schemas import HistoryDayOut, HistoryPlanDay, HistorySummaryMonth, DayAuditOut, DayRepairOut
from app.services.repair_service import audit_day_gaps, repair_day, scan_days_with_gaps

router = APIRouter(prefix="/api/v1/history", tags=["history"])


@router.get("/days", response_model=list[HistoryDayOut])
def list_days(
    date_from: Optional[date] = Query(None, alias="from"),
    date_to: Optional[date] = Query(None, alias="to"),
    db: Session = Depends(get_db),
) -> list[HistoryDayOut]:
    start, _ = program_range()
    hist_end = history_range_end()
    df = max(date_from or start, start)
    dt = date_to or hist_end
    rows = db.execute(
        text(
            """
            SELECT analyzed_date, status, emails_listed_count,
                   emails_processed_count, emails_match_count,
                   analyzed_at, gmail_query
            FROM email_history_day
            WHERE analyzed_date >= :df AND analyzed_date <= :dt
            ORDER BY analyzed_date
            """
        ),
        {"df": df, "dt": dt},
    ).mappings().all()
    return [HistoryDayOut(**dict(r)) for r in rows]


@router.get("/plan", response_model=list[HistoryPlanDay])
def plan_days(
    date_from: Optional[date] = Query(None, alias="from"),
    date_to: Optional[date] = Query(None, alias="to"),
    db: Session = Depends(get_db),
) -> list[HistoryPlanDay]:
    """Todos los días programados en el rango, con estado desde email_history_day o pending."""
    start, _ = program_range()
    hist_end = history_range_end()
    df = max(date_from or start, start)
    dt = date_to or hist_end
    ensure_schedule_months(db, df, dt)
    rows = db.execute(
        text(
            """
            SELECT analyzed_date, status, emails_listed_count,
                   emails_processed_count, emails_match_count, analyzed_at
            FROM email_history_day
            WHERE analyzed_date >= :df AND analyzed_date <= :dt
            """
        ),
        {"df": df, "dt": dt},
    ).mappings().all()
    by_date = {r["analyzed_date"]: r for r in rows}

    out: list[HistoryPlanDay] = []
    d = df
    last = dt
    while d <= last:
        if month_enabled(db, d):
            row = by_date.get(d)
            if row:
                out.append(
                    HistoryPlanDay(
                        analyzed_date=row["analyzed_date"],
                        status=row["status"],
                        emails_listed_count=row["emails_listed_count"],
                        emails_processed_count=row["emails_processed_count"],
                        emails_match_count=row["emails_match_count"],
                        analyzed_at=row["analyzed_at"],
                        scheduled=True,
                    )
                )
            else:
                out.append(
                    HistoryPlanDay(
                        analyzed_date=d,
                        status="pending",
                        emails_listed_count=0,
                        emails_processed_count=0,
                        emails_match_count=0,
                        scheduled=True,
                    )
                )
        d += timedelta(days=1)
    return out


@router.get("/days/{day}/audit", response_model=DayAuditOut)
def audit_day(day: date, db: Session = Depends(get_db)) -> DayAuditOut:
    return DayAuditOut(**audit_day_gaps(db, day))


@router.post("/days/{day}/repair", response_model=DayRepairOut)
def repair_day_endpoint(
    day: date,
    dry_run: bool = Query(False),
    db: Session = Depends(get_db),
) -> DayRepairOut:
    result = repair_day(db, day, only_missing=True, dry_run=dry_run)
    db.commit()
    return DayRepairOut(
        ok=result.get("ok", False),
        analyzed_date=result.get("analyzed_date"),
        repaired=result.get("repaired", 0),
        message_ids=result.get("message_ids", []),
        n8n_execution_id=result.get("n8n_execution_id"),
        message=result.get("message"),
        error=result.get("error"),
        missing_count=result.get("missing_count", 0),
    )


@router.get("/gaps", response_model=list[DayAuditOut])
def list_gaps(
    date_from: Optional[date] = Query(None, alias="from"),
    date_to: Optional[date] = Query(None, alias="to"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[DayAuditOut]:
    start, _ = program_range()
    hist_end = history_range_end()
    df = max(date_from or start, start)
    dt = date_to or hist_end
    rows = scan_days_with_gaps(db, df, dt, limit=limit)
    return [DayAuditOut(**r) for r in rows]


@router.get("/days/{day}", response_model=HistoryDayOut)
def get_day(day: date, db: Session = Depends(get_db)) -> HistoryDayOut:
    row = db.execute(
        text(
            """
            SELECT analyzed_date, status, emails_listed_count,
                   emails_processed_count, emails_match_count,
                   analyzed_at, gmail_query
            FROM email_history_day
            WHERE analyzed_date = :day
            """
        ),
        {"day": day},
    ).mappings().first()
    if not row:
        raise HTTPException(404, "Día no encontrado")
    return HistoryDayOut(**dict(row))


@router.get("/summary", response_model=list[HistorySummaryMonth])
def summary(
    year: int = Query(..., ge=2020, le=2100),
    db: Session = Depends(get_db),
) -> list[HistorySummaryMonth]:
    import calendar

    out = []
    for month in range(1, 13):
        dim = calendar.monthrange(year, month)[1]
        row = db.execute(
            text(
                """
                SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS done,
                       COALESCE(SUM(emails_match_count), 0)::int AS matches
                FROM email_history_day
                WHERE analyzed_date >= :s AND analyzed_date <= :e
                """
            ),
            {
                "s": date(year, month, 1),
                "e": date(year, month, dim),
            },
        ).one()
        out.append(
            HistorySummaryMonth(
                year=year,
                month=month,
                days_in_month=dim,
                days_completed=row.done or 0,
                total_matches=row.matches or 0,
            )
        )
    return out
