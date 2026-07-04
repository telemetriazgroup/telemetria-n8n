"""Auditoría y reparación de días con IDs en email_history_day pero sin fila en email_trace."""

import logging
from datetime import date, datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.services.n8n_client import N8nClient

logger = logging.getLogger(__name__)
_n8n = N8nClient()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def audit_day_gaps(db: Session, day: date) -> dict:
    """Compara message_ids_match con email_trace (review_mode historical)."""
    row = db.execute(
        text(
            """
            SELECT status,
                   COALESCE(jsonb_array_length(message_ids_match), 0)::int AS match_count,
                   COALESCE(jsonb_array_length(message_ids_processed), 0)::int AS proc_count,
                   message_ids_match,
                   message_ids_processed
            FROM email_history_day
            WHERE analyzed_date = :day
            """
        ),
        {"day": day},
    ).mappings().first()

    if not row:
        return {
            "analyzed_date": day.isoformat(),
            "found": False,
            "status": None,
            "match_ids_total": 0,
            "processed_ids_total": 0,
            "trace_ids_found": 0,
            "missing_match_ids": [],
            "missing_count": 0,
        }

    match_ids = [str(x) for x in (row["message_ids_match"] or [])]
    proc_ids = [str(x) for x in (row["message_ids_processed"] or [])]

    missing: list[str] = []
    if match_ids:
        existing = db.execute(
            text(
                """
                SELECT message_id FROM email_trace
                WHERE trace_status = 'active'
                  AND review_mode = 'historical'
                  AND message_id = ANY(:ids)
                """
            ),
            {"ids": match_ids},
        ).scalars().all()
        existing_set = {str(x) for x in existing}
        missing = [mid for mid in match_ids if mid not in existing_set]

    return {
        "analyzed_date": day.isoformat(),
        "found": True,
        "status": row["status"],
        "match_ids_total": len(match_ids),
        "processed_ids_total": len(proc_ids),
        "trace_ids_found": len(match_ids) - len(missing),
        "missing_match_ids": missing,
        "missing_count": len(missing),
    }


def prepare_day_repair(db: Session, day: date, message_ids: list[str]) -> int:
    """
    Quita IDs de message_ids_processed / message_ids_match para que n8n los vuelva a leer.
    Marca el día como partial.
    """
    if not message_ids:
        return 0

    db.execute(
        text(
            """
            UPDATE email_history_day
            SET message_ids_processed = (
                    SELECT COALESCE(jsonb_agg(to_jsonb(elem)), '[]'::jsonb)
                    FROM jsonb_array_elements_text(message_ids_processed) AS elem
                    WHERE NOT (elem = ANY(:ids))
                ),
                message_ids_match = (
                    SELECT COALESCE(jsonb_agg(to_jsonb(elem)), '[]'::jsonb)
                    FROM jsonb_array_elements_text(message_ids_match) AS elem
                    WHERE NOT (elem = ANY(:ids))
                ),
                status = CASE WHEN status = 'completed' THEN 'partial' ELSE status END,
                emails_match_count = GREATEST(0, emails_match_count - :n)
            WHERE analyzed_date = :day
            """
        ),
        {"day": day, "ids": message_ids, "n": len(message_ids)},
    )
    return len(message_ids)


def repair_day(
    db: Session,
    day: date,
    *,
    only_missing: bool = True,
    dry_run: bool = False,
) -> dict:
    audit = audit_day_gaps(db, day)
    if not audit["found"]:
        return {"ok": False, "error": "Día no encontrado en email_history_day", **audit}

    ids = audit["missing_match_ids"] if only_missing else audit["missing_match_ids"]
    if only_missing and not ids:
        return {"ok": True, "repaired": 0, "message": "Sin IDs match faltantes en email_trace", **audit}

    if dry_run:
        return {"ok": True, "dry_run": True, "would_repair": len(ids), **audit}

    if not _n8n.configured():
        return {"ok": False, "error": "n8n no configurado", **audit}

    prepare_day_repair(db, day, ids)
    execution_id = _n8n.trigger_repair(
        process_date=day.isoformat(),
        message_ids=ids,
    )

    db.execute(
        text(
            """
            INSERT INTO control_run (
                started_at, window_start, window_end,
                days_completed_before, action, status,
                n8n_execution_id, note
            ) VALUES (
                :now, :day, :day, 0, 'launch', 'running',
                :eid, :note
            )
            """
        ),
        {
            "now": _utcnow(),
            "day": day,
            "eid": execution_id,
            "note": f"repair día {day} — {len(ids)} ID(s) match faltantes en email_trace",
        },
    )

    logger.info("Repair lanzado para %s: %s IDs", day, len(ids))
    return {
        "ok": True,
        "repaired": len(ids),
        "message_ids": ids,
        "n8n_execution_id": execution_id,
        **audit,
    }


def scan_days_with_gaps(
    db: Session,
    date_from: date,
    date_to: date,
    *,
    limit: int = 50,
) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT analyzed_date
            FROM email_history_day
            WHERE analyzed_date >= :df AND analyzed_date <= :dt
              AND COALESCE(jsonb_array_length(message_ids_match), 0) > 0
            ORDER BY analyzed_date
            LIMIT :lim
            """
        ),
        {"df": date_from, "dt": date_to, "lim": limit * 3},
    ).scalars().all()

    out: list[dict] = []
    for d in rows:
        audit = audit_day_gaps(db, d)
        if audit["missing_count"] > 0:
            out.append(audit)
        if len(out) >= limit:
            break
    return out
