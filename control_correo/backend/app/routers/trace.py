from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import TraceDetailOut, TraceOut

router = APIRouter(prefix="/api/v1/trace", tags=["trace"])


@router.get("", response_model=list[TraceOut])
def list_trace(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    date_from: Optional[date] = Query(None, alias="from"),
    date_to: Optional[date] = Query(None, alias="to"),
    db: Session = Depends(get_db),
) -> list[TraceOut]:
    offset = (page - 1) * page_size
    clauses = ["trace_status = 'active'", "review_mode = 'historical'"]
    params: dict = {"limit": page_size, "offset": offset}
    if date_from:
        clauses.append("email_date >= :df")
        params["df"] = date_from
    if date_to:
        clauses.append("email_date < (:dt::date + INTERVAL '1 day')")
        params["dt"] = date_to
    where = " AND ".join(clauses)
    rows = db.execute(
        text(
            f"""
            SELECT message_id, thread_id, subject, from_address, email_date,
                   match_telemetria_keyword, match_person_keyword,
                   gmail_link, reviewed_at
            FROM email_trace
            WHERE {where}
            ORDER BY email_date DESC NULLS LAST, reviewed_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()
    return [TraceOut(**dict(r)) for r in rows]


@router.get("/{message_id}", response_model=TraceDetailOut)
def trace_detail(message_id: str, db: Session = Depends(get_db)) -> TraceDetailOut:
    row = db.execute(
        text(
            """
            SELECT message_id, thread_id, subject, from_address, to_addresses,
                   cc_addresses, email_date, body_text, snippet,
                   match_telemetria_keyword, match_person_keyword,
                   match_telemetria_excerpt, match_person_excerpt,
                   search_query, gmail_link, reviewed_at
            FROM email_trace
            WHERE message_id = :id
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
    return TraceDetailOut(**data)
