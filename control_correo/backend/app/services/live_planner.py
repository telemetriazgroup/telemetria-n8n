"""Planificación de franjas horarias para seguimiento en vivo (America/Lima)."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import fetch_live_slots
from app.services.dates import LIMA, now_lima, today_lima


@dataclass
class LiveSlotPlan:
    analyzed_date: date
    slot_index: int
    slot_start: datetime
    slot_end: datetime
    slot_start_epoch: int
    slot_end_epoch: int
    label: str


def slots_per_day() -> int:
    minutes = max(15, min(240, settings.live_slot_minutes))
    return max(1, 1440 // minutes)


def build_slots_for_day(day: date) -> list[LiveSlotPlan]:
    minutes = max(15, min(240, settings.live_slot_minutes))
    slot_count = slots_per_day()
    plans: list[LiveSlotPlan] = []

    for idx in range(slot_count):
        start_local = datetime(day.year, day.month, day.day, tzinfo=LIMA) + timedelta(
            minutes=idx * minutes
        )
        end_local = start_local + timedelta(minutes=minutes)
        if end_local.date() > day:
            end_local = datetime(day.year, day.month, day.day, tzinfo=LIMA) + timedelta(
                days=1
            )
        start_utc = start_local.astimezone(timezone.utc)
        end_utc = end_local.astimezone(timezone.utc)
        plans.append(
            LiveSlotPlan(
                analyzed_date=day,
                slot_index=idx,
                slot_start=start_utc,
                slot_end=end_utc,
                slot_start_epoch=int(start_utc.timestamp()),
                slot_end_epoch=int(end_utc.timestamp()),
                label=f"{start_local.strftime('%H:%M')}–{end_local.strftime('%H:%M')}",
            )
        )
    return plans


def completed_slot_indices(db: Session, day: date) -> set[int]:
    return {v["slot_index"] for v in build_live_slot_views(db, day) if v["status"] == "completed"}


def pending_slots_until_now(db: Session, day: date | None = None) -> list[LiveSlotPlan]:
    """Franjas cuyo inicio ya pasó y aún no están completed."""
    day = day or today_lima()
    now = now_lima()
    done = completed_slot_indices(db, day)
    pending: list[LiveSlotPlan] = []
    for slot in build_slots_for_day(day):
        if slot.slot_index in done:
            continue
        if slot.slot_start.astimezone(LIMA) <= now:
            pending.append(slot)
    return pending


def expected_slots_by_now(day: date | None = None) -> int:
    """Cuántas franjas deberían haber iniciado según la hora actual (Lima)."""
    day = day or today_lima()
    now = now_lima()
    count = 0
    for slot in build_slots_for_day(day):
        if slot.slot_start.astimezone(LIMA) <= now:
            count += 1
    return count


def next_live_slot(db: Session, day: date | None = None) -> LiveSlotPlan | None:
    """Primera franja pendiente del día (no completada y ya iniciada o en curso)."""
    day = day or today_lima()
    now = now_lima()
    done = completed_slot_indices(db, day)

    for slot in build_slots_for_day(day):
        if slot.slot_index in done:
            continue
        slot_start_local = slot.slot_start.astimezone(LIMA)
        # Solo franjas cuyo inicio ya pasó (correo que pudo llegar)
        if slot_start_local > now:
            continue
        return slot
    return None


def fetch_slot_counts_from_correos(db: Session, day: date) -> dict[int, dict[str, int]]:
    """Conteos match/procesados por franja desde correos_procesados (+ email_trace)."""
    rows = db.execute(
        text(
            """
            SELECT cp.slot_index,
                   COUNT(DISTINCT cp.message_id)::int AS processed,
                   COUNT(DISTINCT et.message_id)::int AS matches
            FROM correos_procesados cp
            LEFT JOIN email_trace et
                ON et.message_id = cp.message_id AND et.trace_status = 'active'
            WHERE cp.analyzed_date = :day
              AND cp.slot_index IS NOT NULL
              AND (cp.review_mode = 'incremental' OR cp.review_mode IS NULL)
            GROUP BY cp.slot_index
            """
        ),
        {"day": day},
    ).mappings().all()
    return {
        int(r["slot_index"]): {
            "processed": int(r["processed"] or 0),
            "matches": int(r["matches"] or 0),
        }
        for r in rows
    }


def build_live_slot_views(db: Session, day: date) -> list[dict]:
    """Une plan horario + email_history_slot + correos_procesados para la UI."""
    now = now_lima()
    slot_rows = {s["slot_index"]: s for s in fetch_live_slots(db, day)}
    correo_counts = fetch_slot_counts_from_correos(db, day)
    views: list[dict] = []

    for slot in build_slots_for_day(day):
        row = slot_rows.get(slot.slot_index)
        from_correos = correo_counts.get(slot.slot_index, {})
        listed = int(row["emails_listed_count"]) if row else 0
        processed = max(
            int(row["emails_processed_count"]) if row else 0,
            int(from_correos.get("processed", 0)),
        )
        matches = max(
            int(row["emails_match_count"]) if row else 0,
            int(from_correos.get("matches", 0)),
        )
        slot_start_local = slot.slot_start.astimezone(LIMA)
        slot_end_local = slot.slot_end.astimezone(LIMA)

        if row and row.get("status"):
            status = row["status"]
        elif slot_end_local <= now:
            if listed == 0 and processed == 0:
                status = "completed"
            elif listed > 0 and processed >= listed:
                status = "completed"
            elif processed > 0 or matches > 0:
                status = "partial"
            else:
                status = "pending"
        elif slot_start_local <= now:
            status = "partial" if processed > 0 or matches > 0 else "pending"
        else:
            status = "pending"

        views.append(
            {
                "slot_index": slot.slot_index,
                "label": slot.label,
                "status": status,
                "emails_listed": listed,
                "emails_processed": processed,
                "emails_match": matches,
            }
        )
    return views


def live_day_summary(db: Session, day: date) -> dict:
    views = build_live_slot_views(db, day)
    total = slots_per_day()
    completed = sum(1 for v in views if v["status"] == "completed")
    listed = sum(v["emails_listed"] for v in views)
    processed = sum(v["emails_processed"] for v in views)
    matches = sum(v["emails_match"] for v in views)
    expected = expected_slots_by_now(day)
    pending_list = pending_slots_until_now(db, day)
    now = now_lima()
    return {
        "analyzed_date": day,
        "slots_total": total,
        "slots_completed": completed,
        "slots_expected_by_now": expected,
        "slots_pending_now": len(pending_list),
        "current_time_lima": now.strftime("%H:%M"),
        "emails_listed": listed,
        "emails_processed": processed,
        "emails_match": matches,
        "percent": round(100.0 * completed / total, 1) if total else 0.0,
        "percent_expected": round(100.0 * completed / expected, 1) if expected else 0.0,
    }
