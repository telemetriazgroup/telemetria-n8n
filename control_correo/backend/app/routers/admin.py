from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.admin_service import reset_mail_data, verify_reset_password
from app.services.match_config import get_match_config, update_match_config

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


class MatchConfigOut(BaseModel):
    telemetria_variants: list[str]
    person_keywords: list[str]
    updated_at: Optional[datetime] = None


class MatchConfigUpdate(BaseModel):
    telemetria_variants: list[str] = Field(..., min_length=1)
    person_keywords: list[str] = Field(..., min_length=1)


class ResetRequest(BaseModel):
    password: str


class ResetResult(BaseModel):
    ok: bool
    cleared: dict[str, int]
    control_state_reset: bool


@router.get("/match-config", response_model=MatchConfigOut)
def read_match_config(db: Session = Depends(get_db)) -> MatchConfigOut:
    cfg = get_match_config(db)
    return MatchConfigOut(**cfg)


@router.put("/match-config", response_model=MatchConfigOut)
def save_match_config(
    body: MatchConfigUpdate,
    db: Session = Depends(get_db),
) -> MatchConfigOut:
    cfg = update_match_config(
        db,
        telemetria_variants=body.telemetria_variants,
        person_keywords=body.person_keywords,
    )
    db.commit()
    return MatchConfigOut(**cfg)


@router.post("/reset-mail-data", response_model=ResetResult)
def reset_mail_data_endpoint(
    body: ResetRequest,
    db: Session = Depends(get_db),
) -> ResetResult:
    if not verify_reset_password(body.password):
        raise HTTPException(status_code=403, detail="Contraseña incorrecta")
    result = reset_mail_data(db)
    db.commit()
    return ResetResult(ok=True, **result)
