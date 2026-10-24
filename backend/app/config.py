"""Central configuration loaded from environment variables (see `.env.example`)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Application
    app_name: str = "FDR Sentinel"
    app_env: str = "development"
    debug: bool = True
    api_prefix: str = "/api/v1"
    app_timezone: str = "Asia/Kolkata"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Database
    database_url: str = "sqlite:///./fdr_sentinel.db"
    run_db_create: bool = True

    # Auth
    auth_provider: str = "local"
    jwt_secret: str = "dev-only-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    # Storage
    storage_root: str = "./storage"
    max_upload_mb: int = 10
    allowed_file_types: str = "application/pdf,image/png,image/jpeg"

    # OCR
    ocr_engine: str = "auto"  # auto | tesseract | none
    ocr_languages: str = "eng"
    min_embedded_text_chars: int = 20

    # Email (optional)
    smtp_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = True

    # Scheduler
    scheduler_enabled: bool = True
    maturity_check_interval_minutes: int = 360
    run_jobs_on_startup: bool = True

    # Supabase (Postgres is set via DATABASE_URL; Storage used for document blobs)
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "fdr-documents"

    # Vercel Cron / protected job trigger
    cron_secret: str = ""

    @field_validator("cors_origins", mode="after")
    @classmethod
    def _split_origins(cls, value: str) -> str:
        return value.strip()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def allowed_mime_types(self) -> list[str]:
        return [t.strip().lower() for t in self.allowed_file_types.split(",") if t.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def storage_path(self) -> Path:
        root = Path(self.storage_root)
        if not root.is_absolute():
            root = BACKEND_DIR / root
        return root

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def supabase_storage_enabled(self) -> bool:
        """Store document blobs in Supabase Storage when configured (e.g. serverless)."""
        return bool(self.supabase_url and self.supabase_service_role_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
