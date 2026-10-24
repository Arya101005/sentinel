"""Shared pytest fixtures.

The environment MUST be configured before any ``app.*`` import because
``app.config.settings`` is a module-level singleton built at import time.
A dedicated SQLite database and storage root are used so tests never touch
development data. Each test gets a fresh, synthetic-seeded database.
"""

import os
import shutil

# --- Configure test environment BEFORE importing the application -------------
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = "sqlite:///./test_fdr_sentinel.db"
os.environ["STORAGE_ROOT"] = "./test_storage"
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["RUN_DB_CREATE"] = "true"
os.environ["DEBUG"] = "false"
os.environ["JWT_SECRET"] = "test-only-secret-do-not-use"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings as app_settings  # noqa: E402
from app.database import Base, engine, session_scope  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import build_seed  # noqa: E402
from app.services.settings_service import ensure_default_settings  # noqa: E402

API = "/api/v1"
DEMO_PASSWORD = "Demo@Sentinel123"


@pytest.fixture()
def client():
    """Fresh synthetic-seeded database + an HTTP client bound to it."""
    shutil.rmtree(app_settings.storage_path, ignore_errors=True)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with session_scope() as db:
        ensure_default_settings(db)
        build_seed(db)
    with TestClient(app) as test_client:
        yield test_client
    shutil.rmtree(app_settings.storage_path, ignore_errors=True)


def login(client, username: str, password: str = DEMO_PASSWORD) -> dict:
    resp = client.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture()
def as_admin(client):
    return login(client, "admin")


@pytest.fixture()
def as_officer(client):
    return login(client, "officer")


@pytest.fixture()
def as_authority(client):
    return login(client, "authority")


@pytest.fixture()
def as_auditor(client):
    return login(client, "auditor")


@pytest.fixture()
def as_inst_a(client):
    """Institution user for DEMO-A (institution_id 1)."""
    return login(client, "userdemoa")


@pytest.fixture()
def as_inst_b(client):
    """Institution user for DEMO-B (institution_id 2)."""
    return login(client, "userdemob")
