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

import sys
from pathlib import Path

# Make the backend root importable no matter how the runtime seeds sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.database import init_db  # noqa: E402
from app.main import app  # noqa: E402,F401  (exposed ASGI application)

if settings.run_db_create:
    init_db()  # idempotent CREATE TABLE IF NOT EXISTS against the serverless DB
