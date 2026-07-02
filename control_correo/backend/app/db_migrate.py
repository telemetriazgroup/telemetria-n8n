"""Aplica migraciones control_* (idempotentes)."""

import logging
from pathlib import Path

from sqlalchemy import text

from app.database import engine

logger = logging.getLogger(__name__)

MIGRATION_FILES = (
    "06-control-correo.sql",
    "07-control-correo-range-2025.sql",
)


def _migration_paths(name: str) -> tuple[Path, ...]:
    return (
        Path("/app/migrations") / name,
        Path(__file__).resolve().parents[3] / "infra" / "postgres" / name,
    )


def _load_migration_sql(name: str) -> str:
    for path in _migration_paths(name):
        if path.is_file():
            return path.read_text(encoding="utf-8")
    raise FileNotFoundError(f"No se encontró {name}")


def _statements(sql: str):
    lines = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        lines.append(line)
    for chunk in "\n".join(lines).split(";"):
        stmt = chunk.strip()
        if stmt:
            yield stmt


def _apply_sql_file(conn, name: str) -> None:
    sql = _load_migration_sql(name)
    for stmt in _statements(sql):
        conn.execute(text(stmt))


def ensure_control_schema() -> None:
    """Crea tablas control_* y aplica parches de rango/planificación."""
    with engine.begin() as conn:
        exists = conn.execute(
            text("SELECT to_regclass('public.control_run') IS NOT NULL AS ok")
        ).scalar_one()
        if not exists:
            logger.warning("Tablas control_* no encontradas; aplicando 06-control-correo.sql")
            _apply_sql_file(conn, "06-control-correo.sql")
            logger.info("Migración 06 aplicada")

        _apply_sql_file(conn, "07-control-correo-range-2025.sql")
        logger.debug("Rango 2025–jun 2026 verificado")
