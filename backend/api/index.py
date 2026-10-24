"""Vercel serverless entrypoint.

@vercel/python imports this module and uses the exported ASGI ``app``. The
project Root Directory on Vercel must be ``backend`` (so that ``app/`` and
``requirements.txt`` are at the function root). ``vercel.json`` rewrites every
incoming path here; the original request path is preserved so FastAPI's
``/api/v1/...`` routes match normally.

Serverless note: the ASGI lifespan (which runs ``init_db`` / seeding / the
scheduler locally) is not guaranteed to run on every serverless invocation, so
we create the schema eagerly at import. ``create_all`` is idempotent
(``CREATE TABLE IF NOT EXISTS``). Seeding demo data is a one-off step run
against Supabase (see README); the in-process scheduler is replaced by the
``/api/v1/monitoring/cron`` endpoint driven by Vercel Cron.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

log = logging.getLogger("fdr-sentinel.serverless")

# Make the backend root importable no matter how the runtime seeds sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.main import app  # noqa: E402,F401  (exposed ASGI application)

# Fail fast on serverless startup when the Postgres/Supabase connection is
# unreachable. SQLite is the local-only demo path and should never be deployed
# to production, so a missing/garbage DATABASE_URL is treated as a hard error
# that surfaces in the Vercel deployment logs instead of surfacing as random
# 500s later.
if settings.is_sqlite:
    raise RuntimeError(
        "Serverless deploy forbids SQLite. Set DATABASE_URL to a writable"
        " PostgreSQL connection string (e.g. Supabase) in the Vercel project"
        " environment variables before deploying the backend."
    )

if not settings.database_url:
    raise RuntimeError(
        "DATABASE_URL is empty. Configure a writable PostgreSQL connection"
        " string in the Vercel project environment and redeploy the backend."
    )

try:
    if settings.run_db_create:
        init_db()  # idempotent CREATE TABLE IF NOT EXISTS against the serverless DB
except Exception as exc:  # noqa: BLE001
    log.exception("serverless init_db failed")
    raise RuntimeError(f"serverless database init failed: {exc}") from exc
