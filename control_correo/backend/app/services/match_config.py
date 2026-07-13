"""Palabras de match configurables (persistidas en control_match_config)."""

from sqlalchemy import text
from sqlalchemy.orm import Session

DEFAULT_TELEMETRIA = [
    "telemetria",
    "telemetría",
    "telemtria",
    "telemetrai",
    "madurador",
    "ztrack",
    "api",
    "software",
    "plataforma",
]
DEFAULT_PERSON = ["Luis", "Eusebio"]


def _parse_json_list(raw) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    return []


def get_match_config(db: Session) -> dict:
    row = db.execute(
        text(
            """
            SELECT telemetria_variants, person_keywords, updated_at
            FROM control_match_config
            WHERE id = 1
            """
        )
    ).mappings().first()
    if not row:
        return {
            "telemetria_variants": DEFAULT_TELEMETRIA.copy(),
            "person_keywords": DEFAULT_PERSON.copy(),
            "updated_at": None,
        }
    tel = _parse_json_list(row["telemetria_variants"]) or DEFAULT_TELEMETRIA.copy()
    per = _parse_json_list(row["person_keywords"]) or DEFAULT_PERSON.copy()
    return {
        "telemetria_variants": tel,
        "person_keywords": per,
        "updated_at": row["updated_at"],
    }


def update_match_config(
    db: Session,
    *,
    telemetria_variants: list[str],
    person_keywords: list[str],
) -> dict:
    tel = [s.strip() for s in telemetria_variants if s.strip()]
    per = [s.strip() for s in person_keywords if s.strip()]
    if not tel:
        tel = DEFAULT_TELEMETRIA.copy()
    if not per:
        per = DEFAULT_PERSON.copy()
    db.execute(
        text(
            """
            INSERT INTO control_match_config (id, telemetria_variants, person_keywords, updated_at)
            VALUES (1, CAST(:tel AS jsonb), CAST(:per AS jsonb), now())
            ON CONFLICT (id) DO UPDATE SET
                telemetria_variants = EXCLUDED.telemetria_variants,
                person_keywords = EXCLUDED.person_keywords,
                updated_at = now()
            """
        ),
        {"tel": __import__("json").dumps(tel), "per": __import__("json").dumps(per)},
    )
    return get_match_config(db)


def match_payload_for_n8n(db: Session) -> dict:
    cfg = get_match_config(db)
    return {
        "keywords": cfg["person_keywords"],
        "telemetriaVariants": cfg["telemetria_variants"],
    }
