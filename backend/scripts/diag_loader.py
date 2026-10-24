import os, sys, json, urllib.request, urllib.error, ssl, socket, time, logging
import asyncio

from app.main import app
from app.config import settings
from app.database import init_db, migrate_to_postgres
from sqlalchemy import text

r = {}
r["settings"] = {
    k: getattr(settings, k)
    for k in [
        "app_name","app_env","debug","api_prefix","database_url",
        "jwt_secret","auth_provider","supabase_url","supabase_service_role_key",
        "storage_root","ocr_engine","scheduler_enabled","run_db_create",
        "run_jobs_on_startup","cron_secret",
    ]
    if hasattr(settings, k)
}
r["db_is_sqlite"] = settings.is_sqlite
r["db_url_empty"] = not bool(settings.database_url)
r["ready"] = {}
try:
    init_db()
    r["init_db_ok"] = True
except Exception as e:
    r["init_db_ok"] = False
    r["init_db_err"] = repr(e)[:300]

try:
    if app.state.engine is None:
        r["engine"] = "none"
    else:
        with app.state.engine.connect() as conn:
            rows = conn.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema='public'"))
            r["tables"] = [str(t) for t in rows.scalars()]
except Exception as e:
    r["tables"] = None
    r["tables_err"] = repr(e)[:300]

print(json.dumps(r, ensure_ascii=False))
