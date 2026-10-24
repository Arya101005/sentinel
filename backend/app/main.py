"""FDR Sentinel API — FastAPI application entrypoint."""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from .api import (
    applications,
    audit,
    auth,
    discrepancies,
    documents,
    fdrs,
    health,
    institutions,
    monitoring,
    notifications,
    reports,
    settings as settings_router,
    users,
)
from .config import settings
from .database import init_db, session_scope
from .services.scheduler import start_scheduler, stop_scheduler
from .services.settings_service import ensure_default_settings

logger = logging.getLogger("fdr_sentinel")
logging.basicConfig(level=logging.DEBUG if settings.debug else logging.INFO)

__version__ = "1.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Bootstrap: create tables (local demo), seed defaults, start the scheduler."""
    if settings.run_db_create:
        init_db()
    with session_scope() as db:
        ensure_default_settings(db)
        # Development/demo bootstrap: seed synthetic data on an empty database.
        if settings.app_env != "production":
            from .seed import seed_if_empty

            seed_if_empty(db)
    if settings.scheduler_enabled:
        start_scheduler()
        logger.info(
            "Maturity monitoring scheduler started (interval %s min)",
            settings.maturity_check_interval_minutes,
        )
    yield
    stop_scheduler()


app = FastAPI(
    title="FDR Sentinel API",
    description=(
        "AI-assisted security-deposit monitoring, verification and lifecycle management "
        "platform for AICTE Fixed Deposit Receipts (prototype). "
        "This system is a complementary monitoring and decision-support tool — it is NOT "
        "connected to AICTE production systems or any bank's infrastructure."
    ),
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    # Baseline hardening headers (the app is an authenticated admin tool).
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    logger.warning("IntegrityError on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={
            "detail": {
                "code": "conflict",
                "message": "The request conflicts with existing data (possible duplicate submission).",
            }
        },
    )


@app.exception_handler(SQLAlchemyError)
async def db_error_handler(request: Request, exc: SQLAlchemyError):
    # Internal details stay in the server logs only.
    logger.exception("Database error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": {
                "code": "database_unavailable",
                "message": "The database is temporarily unavailable. Please retry shortly.",
            }
        },
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": {
                "code": "internal_error",
                "message": "An unexpected error occurred. The incident has been logged.",
            }
        },
    )


API = settings.api_prefix
app.include_router(health.router, prefix=API)
app.include_router(auth.router, prefix=API)
app.include_router(users.router, prefix=API)
app.include_router(institutions.router, prefix=API)
app.include_router(fdrs.router, prefix=API)
app.include_router(documents.router, prefix=API)
app.include_router(discrepancies.router, prefix=API)
app.include_router(monitoring.router, prefix=API)
app.include_router(applications.router, prefix=API)
app.include_router(applications.clearances_router, prefix=API)
app.include_router(notifications.router, prefix=API)
app.include_router(reports.router, prefix=API)
app.include_router(audit.router, prefix=API)
app.include_router(settings_router.router, prefix=API)


@app.get("/", include_in_schema=False)
def root():
    return {
        "service": settings.app_name,
        "version": __version__,
        "docs": "/docs",
        "api": API,
        "note": "Prototype system; not connected to AICTE production infrastructure.",
    }
