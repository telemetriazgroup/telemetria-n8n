"""Planificación de franjas horarias para seguimiento en vivo (America/Lima)."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

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
    rows = fetch_live_slots(db, day)
    return {r["slot_index"] for r in rows if r["status"] == "completed"}


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


def live_day_summary(db: Session, day: date) -> dict:
    slots = fetch_live_slots(db, day)
    total = slots_per_day()
    completed = sum(1 for s in slots if s["status"] == "completed")
    listed = sum(s["emails_listed_count"] for s in slots)
    processed = sum(s["emails_processed_count"] for s in slots)
    matches = sum(s["emails_match_count"] for s in slots)
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
