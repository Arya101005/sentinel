"""Non-interactive dependency pre-flight check.

Run with:  python scripts/assert_deps.py
Exits 0 when every pinned library in requirements.txt can be imported.
Exits non-zero and prints MISSING: ... when something is absent.

Intended for verification and CI gates only — it never prompts, never
mutates anything, and never touches the network.
"""

from __future__ import annotations

import os
import subprocess
import sys

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")


def _importable(req: str) -> bool:
    # requirements.txt uses pkg-spec pins; extract the leading package name.
    pkg = req.split("==")[0].split(">=")[0].split("<=")[0].split("~=")[0].split("!=")[0].split(";")[0].strip()
    return pkg and _can_import(pkg)


def _can_import(pkg: str) -> bool:
    try:
        result = subprocess.run(
            [sys.executable, "-c", f"import {pkg}"],
            check=False,
            capture_output=True,
            text=True,
        )
        return result.returncode == 0
    except Exception:
        return False


def main() -> None:
    reqs_path = os.path.join(os.path.dirname(__file__), "..", "requirements.txt")
    reqs = [line.strip() for line in open(reqs_path) if line.strip() and not line.strip().startswith("#")]
    missing = [r for r in reqs if not _importable(r)]
    if missing:
        print("MISSING:", ", ".join(missing))
        sys.exit(1)
    print("ALL_DEPS_OK")


if __name__ == "__main__":
    main()
