from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import ControlSchedule, get_db, get_or_create_state
from app.schemas import ScheduleMonthOut

router = APIRouter(prefix="/api/v1/schedule", tags=["schedule"])


class ScheduleUpdate(BaseModel):
    enabled: bool


@router.get("", response_model=list[ScheduleMonthOut])
def list_schedule(db: Session = Depends(get_db)) -> list[ScheduleMonthOut]:
    rows = db.query(ControlSchedule).order_by(ControlSchedule.year, ControlSchedule.month).all()
    return [
        ScheduleMonthOut(year=r.year, month=r.month, enabled=r.enabled) for r in rows
    ]


@router.put("/{year}/{month}", response_model=ScheduleMonthOut)
def update_month(
    year: int, month: int, enabled: bool = True, db: Session = Depends(get_db)
) -> ScheduleMonthOut:
    row = db.query(ControlSchedule).filter_by(year=year, month=month).first()
    if not row:
        row = ControlSchedule(year=year, month=month, enabled=enabled)
        db.add(row)
    else:
        row.enabled = enabled
    db.commit()
    db.refresh(row)
    return ScheduleMonthOut(year=row.year, month=row.month, enabled=row.enabled)
