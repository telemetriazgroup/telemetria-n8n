from datetime import date, datetime, timedelta
from typing import Generator, Optional, TypedDict

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Integer,
    SmallInteger,
    String,
    Text,
    create_engine,
    text,
)
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import settings
from app.services.dates import today_lima, yesterday_lima

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()


class ControlSchedule(Base):
    __tablename__ = "control_schedule"

    year = Column(SmallInteger, primary_key=True)
    month = Column(SmallInteger, primary_key=True)
    enabled = Column(Boolean, nullable=False, default=True)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class ControlRun(Base):
    __tablename__ = "control_run"

    id = Column(Integer, primary_key=True, autoincrement=True)
    started_at = Column(DateTime(timezone=True), nullable=False)
    finished_at = Column(DateTime(timezone=True))
    n8n_execution_id = Column(Text)
    window_start = Column(Date, nullable=False)
    window_end = Column(Date, nullable=False)
    days_completed_before = Column(Integer, nullable=False, default=0)
    days_completed_after = Column(Integer)
    action = Column(String(32), nullable=False)
    status = Column(String(32), nullable=False)
    note = Column(Text)


class ControlState(Base):
    __tablename__ = "control_state"

    id = Column(SmallInteger, primary_key=True)
    paused = Column(Boolean, nullable=False, default=False)
    last_poll_at = Column(DateTime(timezone=True))
    last_completed_date = Column(Date)
    current_window_start = Column(Date)
    current_window_end = Column(Date)
    active_n8n_execution_id = Column(Text)
    program_range_start = Column(Date, nullable=False)
    program_range_end = Column(Date, nullable=False)
    live_today_date = Column(Date)
    live_last_slot_index = Column(SmallInteger)
    live_last_poll_at = Column(DateTime(timezone=True))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def parse_date(value: str | date) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def program_range() -> tuple[date, date]:
    start = parse_date(settings.program_range_start)
    if settings.program_range_end_override.strip():
        end = parse_date(settings.program_range_end_override)
    else:
        end = yesterday_lima()
    if end < start:
        end = start
    return start, end


def ensure_schedule_months(db: Session, start: date, end: date) -> None:
    """Inserta meses faltantes en control_schedule (habilitados por defecto)."""
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        db.execute(
            text(
                """
                INSERT INTO control_schedule (year, month, enabled)
                VALUES (:y, :m, true)
                ON CONFLICT (year, month) DO NOTHING
                """
            ),
            {"y": y, "m": m},
        )
        if m == 12:
            y += 1
            m = 1
        else:
            m += 1


def count_scheduled_days(db: Session) -> int:
    start, end = program_range()
    ensure_schedule_months(db, start, end)
    row = db.execute(
        text(
            """
            WITH days AS (
                SELECT generate_series(:start::date, :end::date, '1 day'::interval)::date AS d
            )
            SELECT COUNT(*)::int
            FROM days
            JOIN control_schedule cs
              ON cs.year = EXTRACT(YEAR FROM days.d)::int
             AND cs.month = EXTRACT(MONTH FROM days.d)::int
             AND cs.enabled = true
            """
        ),
        {"start": start, "end": end},
    ).scalar_one()
    return int(row)


def fetch_completed_dates(db: Session) -> set[date]:
    start, end = program_range()
    rows = db.execute(
        text(
            """
            SELECT analyzed_date::date AS d
            FROM email_history_day
            WHERE status = 'completed'
              AND analyzed_date >= :start AND analyzed_date <= :end
            """
        ),
        {"start": start, "end": end},
    ).fetchall()
    return {row.d for row in rows}


def count_completed(db: Session) -> int:
    start, end = program_range()
    return db.execute(
        text(
            """
            SELECT COUNT(*)::int
            FROM email_history_day
            WHERE status = 'completed'
              AND analyzed_date >= :start AND analyzed_date <= :end
            """
        ),
        {"start": start, "end": end},
    ).scalar_one()


class DayProgress(TypedDict):
    analyzed_date: date
    status: str
    emails_listed_count: int
    emails_processed_count: int
    emails_match_count: int
    analyzed_at: Optional[datetime]


def fetch_day_progress(db: Session, day: date) -> DayProgress:
    row = db.execute(
        text(
            """
            SELECT analyzed_date, status, emails_listed_count,
                   emails_processed_count, emails_match_count, analyzed_at
            FROM email_history_day
            WHERE analyzed_date = :day
            """
        ),
        {"day": day},
    ).mappings().first()
    if row:
        return DayProgress(
            analyzed_date=row["analyzed_date"],
            status=row["status"],
            emails_listed_count=row["emails_listed_count"] or 0,
            emails_processed_count=row["emails_processed_count"] or 0,
            emails_match_count=row["emails_match_count"] or 0,
            analyzed_at=row["analyzed_at"],
        )
    return DayProgress(
        analyzed_date=day,
        status="pending",
        emails_listed_count=0,
        emails_processed_count=0,
        emails_match_count=0,
        analyzed_at=None,
    )


def count_days_with_match(db: Session) -> int:
    start, end = program_range()
    return db.execute(
        text(
            """
            SELECT COUNT(*)::int
            FROM email_history_day
            WHERE analyzed_date >= :start AND analyzed_date <= :end
              AND emails_match_count > 0
            """
        ),
        {"start": start, "end": end},
    ).scalar_one()


def sum_match_emails(db: Session) -> int:
    start, end = program_range()
    return db.execute(
        text(
            """
            SELECT COALESCE(SUM(emails_match_count), 0)::int
            FROM email_history_day
            WHERE analyzed_date >= :start AND analyzed_date <= :end
            """
        ),
        {"start": start, "end": end},
    ).scalar_one()


def first_incomplete_day_in_window(
    w_start: date, w_end: date, completed: set[date]
) -> Optional[date]:
    d = w_start
    while d <= w_end:
        if d not in completed:
            return d
        d += timedelta(days=1)
    return None


def month_enabled(db: Session, d: date) -> bool:
    row = db.execute(
        text(
            """
            SELECT enabled FROM control_schedule
            WHERE year = :y AND month = :m
            """
        ),
        {"y": d.year, "m": d.month},
    ).fetchone()
    return bool(row.enabled) if row else False


def get_or_create_state(db: Session) -> ControlState:
    state = db.get(ControlState, 1)
    if state:
        return state
    start, end = program_range()
    state = ControlState(
        id=1,
        paused=False,
        program_range_start=start,
        program_range_end=end,
    )
    db.add(state)
    db.commit()
    db.refresh(state)
    return state


class LiveSlotProgress(TypedDict):
    slot_index: int
    slot_start: datetime
    slot_end: datetime
    status: str
    emails_listed_count: int
    emails_processed_count: int
    emails_match_count: int


def fetch_live_slots(db: Session, day: date) -> list[LiveSlotProgress]:
    rows = db.execute(
        text(
            """
            SELECT slot_index, slot_start, slot_end, status,
                   emails_listed_count, emails_processed_count, emails_match_count
            FROM email_history_slot
            WHERE analyzed_date = :day
            ORDER BY slot_index
            """
        ),
        {"day": day},
    ).mappings().all()
    return [
        LiveSlotProgress(
            slot_index=r["slot_index"],
            slot_start=r["slot_start"],
            slot_end=r["slot_end"],
            status=r["status"],
            emails_listed_count=r["emails_listed_count"] or 0,
            emails_processed_count=r["emails_processed_count"] or 0,
            emails_match_count=r["emails_match_count"] or 0,
        )
        for r in rows
    ]


def rollup_live_day_to_history(db: Session, day: date) -> None:
    """Consolida franjas del día en email_history_day (archivo histórico)."""
    db.execute(
        text(
            """
            INSERT INTO email_history_day (
                analyzed_date, range_start, range_end, gmail_query,
                emails_listed_count, emails_processed_count, emails_match_count,
                message_ids_processed, message_ids_match, status, analyzed_at
            )
            SELECT
                :day,
                :day,
                :day + 1,
                string_agg(gmail_query, ' | ' ORDER BY slot_index),
                COALESCE(SUM(emails_listed_count), 0),
                COALESCE(SUM(emails_processed_count), 0),
                COALESCE(SUM(emails_match_count), 0),
                COALESCE(
                    (SELECT jsonb_agg(DISTINCT v)
                     FROM email_history_slot s,
                          LATERAL jsonb_array_elements_text(s.message_ids_processed) v
                     WHERE s.analyzed_date = :day),
                    '[]'::jsonb
                ),
                COALESCE(
                    (SELECT jsonb_agg(DISTINCT v)
                     FROM email_history_slot s,
                          LATERAL jsonb_array_elements_text(s.message_ids_match) v
                     WHERE s.analyzed_date = :day),
                    '[]'::jsonb
                ),
                CASE WHEN bool_and(status = 'completed') THEN 'completed' ELSE 'partial' END,
                now()
            FROM email_history_slot
            WHERE analyzed_date = :day
            ON CONFLICT (analyzed_date) DO UPDATE SET
                emails_listed_count = EXCLUDED.emails_listed_count,
                emails_processed_count = EXCLUDED.emails_processed_count,
                emails_match_count = EXCLUDED.emails_match_count,
                message_ids_processed = EXCLUDED.message_ids_processed,
                message_ids_match = EXCLUDED.message_ids_match,
                status = EXCLUDED.status,
                analyzed_at = EXCLUDED.analyzed_at
            """
        ),
        {"day": day},
    )

