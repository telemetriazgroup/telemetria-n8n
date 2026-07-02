from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db, month_enabled, program_range
from app.schemas import HistoryDayOut, HistoryPlanDay, HistorySummaryMonth

router = APIRouter(prefix="/api/v1/history", tags=["history"])


@router.get("/days", response_model=list[HistoryDayOut])
def list_days(
    date_from: Optional[date] = Query(None, alias="from"),
    date_to: Optional[date] = Query(None, alias="to"),
    db: Session = Depends(get_db),
) -> list[HistoryDayOut]:
    start, end = program_range()
    df = date_from or start
    dt = date_to or end
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
    start, end = program_range()
    df = date_from or start
    dt = date_to or end
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
    d = max(df, start)
    last = min(dt, end)
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
    year: int = Query(..., ge=2020, le=2030),
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
