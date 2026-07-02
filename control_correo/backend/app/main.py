import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db_migrate import ensure_control_schema
from app.routers import dashboard, history, runs, schedule, trace
from app.services.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_control_schema()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="Control Correo — Telemetría",
    version="0.1.0",
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router)
app.include_router(history.router)
app.include_router(trace.router)
app.include_router(schedule.router)
app.include_router(runs.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "control-correo-api"}
