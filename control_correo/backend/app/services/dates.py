"""Fechas del programa en America/Lima (GMT-5)."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

LIMA = ZoneInfo("America/Lima")


def now_lima() -> datetime:
    return datetime.now(LIMA)


def today_lima() -> date:
    return now_lima().date()


def yesterday_lima() -> date:
    return today_lima() - timedelta(days=1)
