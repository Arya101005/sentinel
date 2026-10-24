"""Seed entrypoint that works from `python -m app.services.seed`."""

from __future__ import annotations

import argparse
import sys

# Ensure the backend package is importable from the repo root.
sys.path.insert(0, __file__.rsplit("/", 2)[0] if "/" in __file__ else "..")

from .seed import reset_and_seed, seed_if_empty
from app.database import session_scope, init_db
from app.services.settings_service import ensure_default_settings

def main() -> None:
    parser = argparse.ArgumentParser(description="Seed FDR Sentinel demo data")
    parser.add_argument("--reset", action="store_true", help="Drop and recreate all tables first")
    args = parser.parse_args()
    if args.reset:
        reset_and_seed()
    else:
        with session_scope() as db:
            ensure_default_settings(db)
            if seed_if_empty(db) is None:
                print("Database already contains data; use --reset to reseed.")
            else:
                print("Seeded fresh data.")

if __name__ == "__main__":
    main()
