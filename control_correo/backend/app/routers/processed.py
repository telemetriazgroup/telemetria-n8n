from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import ProcessedDetailOut, ProcessedOut

router = APIRouter(prefix="/api/v1/processed", tags=["processed"])

_LIST_SELECT = """
SELECT
    cp.message_id,
    cp.thread_id,
    cp.subject,
    cp.from_address,
    cp.email_date,
    cp.snippet,
    cp.gmail_link,
    cp.processed_at,
    cp.analyzed_date,
    cp.review_mode,
    (et.message_id IS NOT NULL) AS is_match,
    et.match_telemetria_keyword,
    et.match_person_keyword,
    et.match_telemetria_excerpt,
    et.match_person_excerpt
FROM correos_procesados cp
LEFT JOIN email_trace et
    ON et.message_id = cp.message_id AND et.trace_status = 'active'
"""


@router.get("", response_model=list[ProcessedOut])
def list_processed(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    date_from: Optional[date] = Query(None, alias="from"),
    date_to: Optional[date] = Query(None, alias="to"),
    datetime_from: Optional[datetime] = Query(None, alias="from_dt"),
    datetime_to: Optional[datetime] = Query(None, alias="to_dt"),
    review_mode: Optional[str] = Query(None, description="historical, incremental o vacío=todos"),
    match_only: Optional[bool] = Query(None, description="true=solo match, false=solo sin match"),
    db: Session = Depends(get_db),
) -> list[ProcessedOut]:
    offset = (page - 1) * page_size
    clauses: list[str] = []
    params: dict = {"limit": page_size, "offset": offset}

    if review_mode:
        clauses.append("cp.review_mode = :review_mode")
        params["review_mode"] = review_mode
    if datetime_from:
        clauses.append("cp.email_date >= :dt_from")
        params["dt_from"] = datetime_from
    elif date_from:
        clauses.append("cp.email_date >= :df")
        params["df"] = date_from
    if datetime_to:
        clauses.append("cp.email_date <= :dt_to")
        params["dt_to"] = datetime_to
    elif date_to:
        clauses.append("cp.email_date < (CAST(:dt AS date) + INTERVAL '1 day')")
        params["dt"] = date_to
    if match_only is True:
        clauses.append("et.message_id IS NOT NULL")
    elif match_only is False:
        clauses.append("et.message_id IS NULL")

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = db.execute(
        text(
            f"""
            {_LIST_SELECT}
            {where}
            ORDER BY cp.email_date DESC NULLS LAST, cp.processed_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()
    return [ProcessedOut(**dict(r)) for r in rows]


@router.get("/{message_id}", response_model=ProcessedDetailOut)
def processed_detail(message_id: str, db: Session = Depends(get_db)) -> ProcessedDetailOut:
    row = db.execute(
        text(
            f"""
            SELECT
                cp.message_id,
                cp.thread_id,
                cp.subject,
                cp.from_address,
                cp.to_addresses,
                cp.cc_addresses,
                cp.email_date,
                cp.body_text,
                cp.snippet,
                cp.gmail_link,
                cp.processed_at,
                cp.analyzed_date,
                cp.review_mode,
                cp.search_query,
                cp.search_after,
                cp.search_before,
                cp.has_attachments,
                (et.message_id IS NOT NULL) AS is_match,
                et.match_telemetria_keyword,
                et.match_person_keyword,
                et.match_telemetria_excerpt,
                et.match_person_excerpt
            FROM correos_procesados cp
            LEFT JOIN email_trace et
                ON et.message_id = cp.message_id AND et.trace_status = 'active'
            WHERE cp.message_id = :id
            """
        ),
        {"id": message_id},
    ).mappings().first()
    if not row:
        raise HTTPException(404, "Correo no encontrado")
    atts = db.execute(
        text(
            """
            SELECT filename, mime_type, size_bytes, attachment_id, gmail_link
            FROM email_attachment_ref
            WHERE message_id = :id
            """
        ),
        {"id": message_id},
    ).mappings().all()
    data = dict(row)
    data["attachments"] = [dict(a) for a in atts]
    return ProcessedDetailOut(**data)
