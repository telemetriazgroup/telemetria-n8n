"""Aplica migraciones control_* (idempotentes)."""

import logging
from pathlib import Path

from sqlalchemy import text

from app.database import engine

logger = logging.getLogger(__name__)

# Fallback si la imagen Docker no incluye el archivo (p. ej. sin rebuild).
RANGE_2025_SQL = """
UPDATE control_state
SET program_range_start = '2025-01-01',
    program_range_end = '2026-06-30'
WHERE id = 1;

INSERT INTO control_schedule (year, month, enabled) VALUES
    (2025, 1, true), (2025, 2, true), (2025, 3, true), (2025, 4, true),
    (2025, 5, true), (2025, 6, true), (2025, 7, true), (2025, 8, true),
    (2025, 9, true), (2025, 10, true), (2025, 11, true), (2025, 12, true),
    (2026, 1, true), (2026, 2, true), (2026, 3, true), (2026, 4, true),
    (2026, 5, true), (2026, 6, true)
ON CONFLICT (year, month) DO UPDATE SET enabled = EXCLUDED.enabled;

DELETE FROM control_schedule WHERE year > 2026 OR (year = 2026 AND month > 6);
"""


def _candidate_paths(name: str) -> list[Path]:
    paths: list[Path] = [Path("/app/migrations") / name]
    for root in Path(__file__).resolve().parents:
        candidate = root / "infra" / "postgres" / name
        if candidate not in paths:
            paths.append(candidate)
        backend_migrations = root / "migrations" / name
        if backend_migrations not in paths:
            paths.append(backend_migrations)
    return paths


def _load_migration_sql(name: str, *, fallback: str | None = None) -> str:
    for path in _candidate_paths(name):
        if path.is_file():
            return path.read_text(encoding="utf-8")
    if fallback is not None:
        logger.warning("%s no encontrado en disco; usando SQL embebido", name)
        return fallback
    raise FileNotFoundError(
        f"No se encontró {name}. Ejecuta manualmente:\n"
        f"  docker exec -i postgres-telemetria psql -U telemetria_app -d telemetria "
        f"< infra/postgres/{name}"
    )


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


def _apply_sql(conn, sql: str) -> None:
    for stmt in _statements(sql):
        conn.execute(text(stmt))


def _apply_sql_file(conn, name: str, *, fallback: str | None = None) -> None:
    sql = _load_migration_sql(name, fallback=fallback)
    _apply_sql(conn, sql)


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

        _apply_sql_file(
            conn,
            "07-control-correo-range-2025.sql",
            fallback=RANGE_2025_SQL,
        )
        logger.debug("Rango 2025–jun 2026 verificado")
