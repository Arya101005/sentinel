# FDR SENTINEL

**AI-Assisted Security Deposit Monitoring, Verification and Lifecycle Management Platform** (Smart India Hackathon prototype).

FDR Sentinel is a full-stack application for tracking AICTE-related Fixed Deposit Receipts (FDRs): a central
registry, OCR-assisted document verification, maturity & matured-non-applicant monitoring, a release workflow
with clearances, notifications, reports and an audit trail.

> **Important honesty note.** This is a *complementary monitoring and decision-support prototype*. It is **not**
> connected to AICTE's production portal or to any bank's infrastructure. OCR output is a candidate value for
> human review, never proof of authenticity. A maturity date alone does **not** mean a deposit is eligible for
> release. No record is auto-approved or auto-released. All seeded data is clearly labelled synthetic DEMO data.

---

## 1. Project overview

Five modules:

- **A. Centralized FDR Registry** — institution-wise and FDR-wise records with lifecycle history.
- **B. Document Intelligence** — private uploads, PDF text extraction (PyMuPDF), Tesseract OCR fallback, field
  parsing/normalisation and comparison against submitted values to flag potential discrepancies.
- **C. Maturity & Non-Applicant Intelligence** — upcoming maturity, matured FDRs with no recorded release
  application, and renewal/replacement linkage.
- **D. Verification & Release Workflow** — configurable workflow states, required clearances, assignment,
  competent-authority gate and timelines.
- **E. Analytics, Notifications & Audit** — KPI dashboard, charts, reports/CSV+PDF export, deduplicated
  notifications with escalation, and an append-only audit log.

Roles: **System Administrator**, **AICTE Officer**, **Institution User**, **Read-Only Auditor** (plus a
*competent authority* flag that only permits release approval at the authority stage).

## 2. Architecture

```
fdr_sentinel/
├── backend/                 # FastAPI + SQLAlchemy 2.x (Python 3.11/3.12)
│   ├── app/
│   │   ├── api/             # REST routers (auth, fdrs, documents, monitoring, ...)
│   │   ├── services/        # maturity, extraction, discrepancy, workflow, reports, ...
│   │   ├── schemas/         # Pydantic models
│   │   ├── models.py        # SQLAlchemy ORM models
│   │   ├── enums.py         # Roles, workflow matrix, constants
│   │   ├── security.py      # PBKDF2 passwords, JWT, role dependencies
│   │   └── seed.py          # Synthetic DEMO dataset (6 scenarios)
│   ├── tests/               # pytest suite
│   └── scripts/verify_e2e.py# Live end-to-end API audit script
└── frontend/                # React 18 + Vite + TypeScript + Tailwind
    └── src/
        ├── lib/             # API client, auth context, formatting
        ├── components/      # Design system + app shell
        └── pages/           # 20 routed pages
```

- **Backend:** FastAPI, SQLAlchemy 2.x, Pydantic v2, APScheduler (maturity job). OpenAPI docs at `/docs`.
- **Database:** SQLite by default for a zero-dependency local demo; set `DATABASE_URL` to PostgreSQL for
  production (no code changes needed).
- **Frontend:** React + Vite + TanStack Query + React Hook Form/Zod + Recharts. In development the Vite dev
  server proxies `/api` → `http://127.0.0.1:8000`, so no CORS setup is needed locally.

## 3. Prerequisites

- **Python 3.11+** (tested on 3.12)
- **Node.js 18+** and npm (tested on Node 20)
- Optional: **PostgreSQL 14+** for production, **Tesseract OCR** binary for scanned/image documents.

## 4. Environment configuration

Copy the template and adjust values as needed (the local SQLite demo works with the defaults):

```bash
cp .env.example .env
```

Key variables (see `.env.example` for the full list):

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./fdr_sentinel.db` or `postgresql+psycopg://…` | SQLite |
| `JWT_SECRET` | Secret for access tokens | dev value (change in prod) |
| `STORAGE_ROOT` | Private directory for uploaded files | `./storage` |
| `CORS_ORIGINS` | Allowed browser origins | `http://localhost:5173` |
| `OCR_ENGINE` | `auto` \| `tesseract` \| `none` | `auto` |
| `SMTP_*` | Optional e-mail delivery | disabled |
| `SCHEDULER_ENABLED` | Run the maturity monitoring job | `true` |

**Secrets are never committed.** Put real secrets in `.env` (local) or your host's secret store — never in the
frontend. No privileged database key is exposed to the browser.

## 5. Database setup

For the local demo the schema is created automatically on startup (`init_db` → `create_all`) and seeded if empty.
To (re)create the synthetic dataset explicitly:

```bash
cd backend
python -m app.seed --reset      # drops & recreates all tables, then seeds DEMO data
```

> **Migrations:** the schema is managed declaratively through SQLAlchemy metadata for this prototype (Alembic is
> included as a dependency). A versioned Alembic migration chain is a documented limitation — see
> *Known limitations*. For production, generate an initial Alembic revision from `app.models.Base`.

## 6. Running the backend

```bash
cd backend
python -m venv .venv                       # Windows: .venv\Scripts\activate
source .venv/bin/activate                  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m app.seed --reset                 # optional: fresh synthetic dataset
uvicorn app.main:app --reload --port 8000
```

- API base: `http://127.0.0.1:8000/api/v1`
- Health: `GET /api/v1/health`, DB check: `GET /api/v1/health/db`
- Swagger UI: `http://127.0.0.1:8000/docs`

## 7. Running the frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173  (proxies /api → 127.0.0.1:8000)
```

Start the backend first (or set `VITE_BACKEND_URL` to point the proxy elsewhere). Build for production with
`npm run build` (outputs `frontend/dist`).

## 8. Seeding synthetic data

```bash
cd backend && python -m app.seed --reset
```

This creates 8 synthetic institutions, 12 users, 23 FDRs, documents and 3 release applications — all marked
`is_demo = true`. Login password for every demo account is `Demo@Sentinel123`.

| Username | Role |
|---|---|
| `admin` | System Administrator |
| `officer` | AICTE Officer |
| `authority` | Competent Authority (can approve releases) |
| `auditor` | Read-Only Auditor |
| `userdemoa` … `userdemoh` | Institution users (one per institution) |

## 9. Running tests

```bash
# Backend (pytest) — 86 tests
cd backend && python -m pytest

# Backend live end-to-end API audit (backend must be running) — 44 checks
cd backend && python scripts/verify_e2e.py

# Frontend (Vitest + React Testing Library) — 20 tests
cd frontend && npm test

# Frontend type-check + build
cd frontend && npm run build
```

## 10. Deployment

Two containers are provided (see *Docker*) — or deploy the pieces separately:

- **Frontend:** build (`npm run build`) and host `frontend/dist` on any static host (Vercel, Netlify, Cloudflare
  Pages). Set `VITE_API_BASE` at build time to the backend's public origin if the API is on another domain.
- **Backend:** run behind a WSGI/ASGI process (`uvicorn app.main:app --workers …`) on a Python-capable host, **or**
  deploy serverless to Vercel (a serverless entrypoint, Vercel Cron trigger and Supabase Storage are wired up — see
  below). Set `APP_ENV=production`, a strong `JWT_SECRET`, `DATABASE_URL=postgresql://…`, and configure `CORS_ORIGINS`.
- **Database:** PostgreSQL (Supabase or any managed Postgres).
- **Files:** keep `STORAGE_ROOT` on persistent private storage with restricted access, **or** set the `SUPABASE_*`
  variables to store document blobs in Supabase Storage (required on serverless).

> On a long-running host the background maturity job runs inside the backend process (APScheduler). On a serverless
> host set `SCHEDULER_ENABLED=false` and let Vercel Cron call `/api/v1/monitoring/cron` instead (already configured in
> `backend/vercel.json`).

### Deploying to Vercel + Supabase (recommended split)

**Frontend → Vercel** (static Vite build):

1. Push this repository to GitHub and import it in Vercel.
2. Set the project **Root Directory** to `frontend` (framework auto-detected as Vite; config in `frontend/vercel.json`).
3. Set the environment variable **`VITE_API_BASE`** = the deployed backend origin (e.g. `https://<backend>.vercel.app`).
4. Deploy. Client-side routes fall back to `index.html` automatically.

**Database → Supabase Postgres:**

1. Create a Supabase project and copy its connection string (use the **Transaction pooler**, port `6543`, for a
   hosted/serverless backend).
2. Set `DATABASE_URL` on the backend to the pooler URI with `?sslmode=require`.
3. `psycopg2-binary` is already in `backend/requirements.txt`. On the first run against an empty database the app
   creates its schema (`RUN_DB_CREATE=true`) and seeds demo data when `APP_ENV != production`.
4. Add the frontend's URL to the backend's `CORS_ORIGINS`.

**Backend → Vercel (Python serverless):** the backend is now serverless-ready. `backend/api/index.py` exports the
FastAPI ASGI app, and `backend/vercel.json` rewrites every path to it and schedules the maturity job via Vercel Cron.
Deploy it as a second Vercel project from the same repo:

1. Create a second Vercel project and set its **Root Directory** to `backend` (Python runtime; `backend/requirements.txt`
   is auto-detected).
2. Set the environment variables:
   - `APP_ENV=production`, `DEBUG=false`
   - `JWT_SECRET` = a long random string
   - `DATABASE_URL` = the Supabase **pooler** URI (`:6543`) with `?sslmode=require`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only secret), `SUPABASE_STORAGE_BUCKET` — routes document
     uploads to Supabase Storage instead of the ephemeral serverless disk.
   - `CRON_SECRET` = a long random string (Vercel Cron sends it as `Authorization: Bearer …` to the cron endpoint)
   - `SCHEDULER_ENABLED=false` (the in-process scheduler is replaced by the Vercel Cron hit)
   - `CORS_ORIGINS` = the frontend's URL
3. Create a **private** Supabase Storage bucket named after `SUPABASE_STORAGE_BUCKET` (Supabase → Storage).
4. Deploy. `api/index.py` creates the DB schema on first import (idempotent `CREATE TABLE IF NOT EXISTS`, controlled by
   `RUN_DB_CREATE`).

**Seeding demo data on Supabase:** auto-seed runs only when `APP_ENV != production`. To populate the demo dataset in
Supabase, run the seed once from your machine against the production database (with the `SUPABASE_*` and `DATABASE_URL`
vars set, the sample documents are uploaded to Supabase Storage as well):

    cd backend && SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DATABASE_URL=… python -m app.seed --reset

## 11. Configuring OCR

- **Embedded-text PDFs** are extracted with PyMuPDF out of the box (no external service).
- **Scanned PDFs / images** need the Tesseract binary + `pytesseract`:
  - Install Tesseract and ensure it is on `PATH`.
  - `OCR_ENGINE=auto` (default) uses it when present; `OCR_ENGINE=none` forces manual review.
  - `OCR_LANGUAGES` controls the language pack (default `eng`).
- If no OCR engine is available, processing degrades gracefully to `manual_review_required` with an explicit
  reason — it never crashes and never invents values. The health endpoint reports `ocr_available`.

## 12. Configuring e-mail

E-mail is **optional**. In-app notifications always work without it.

- Set `SMTP_ENABLED=true`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`,
  `SMTP_USE_TLS`.
- Until configured, the notification centre states that delivery is in-app only — successful e-mail delivery is
  never fabricated.

## 13. Features that require external services

| Feature | External dependency | Without it |
|---|---|---|
| Scanned-document OCR | Tesseract binary | Manual review (documented) |
| E-mail notifications | SMTP server | In-app notifications only |
| Production persistence | PostgreSQL | SQLite demo database |
| Bank / AICTE verification | *(none — not integrated)* | **Never claimed.** No live bank or AICTE integration exists. |

The application runs a full local demonstration with **no** external services.

## 14. Using the demonstration scenarios

Seed the data (`python -m app.seed --reset`), start the backend + frontend, and sign in with the accounts above.

| Scenario | Where to look | Expected result |
|---|---|---|
| **A. Healthy record** (College A) | FDR Registry → `SBI/AIC/2023/0417` | Complete data, no mismatch, verified. |
| **B. Matured, no application** (College B) | *Matured non-applicants* → `PNB/CEN/2021/1189` | Appears in queue, counted on dashboard, notification created (de-duplicated). |
| **C. Amount mismatch** (College C) | *Discrepancy queue* → `BOB/COI/2022/0733` | Declared ₹500,000 vs extracted ₹750,000 flagged; can be resolved with an audit entry. |
| **D. Upcoming maturity** (College D) | *Upcoming maturity* | Deposit maturing inside the alert window; a notification is generated once (no duplicates). |
| **E. Pending clearance** (College E) | *Clearance tracking* / application `REL-DEMO-0001` | Bank verification pre-cleared, finance/audit pending, elapsed time shown; advance to authority is blocked until cleared. |
| **F. Replacement FDR** (College F) | FDR `IOB/FAR/2024/0099-R` | Previous record preserved as *replaced*, replacement linked, active counts updated (no double counting). |

Run the automated checks anytime: `python scripts/verify_e2e.py` (live) and `python -m pytest` (suite).

---

## Known limitations

- **No real integrations.** There is no connection to AICTE's production portal or to any bank. Bank
  verification is a tracked workflow step, not a live check. Nothing in this system should be read as a
  regulatory or compliance certification.
- **SQLite by default** for the local demo; use PostgreSQL for production durability and concurrency.
- **Schema via `create_all`, not a versioned Alembic chain** — sufficient for the prototype; generate an initial
  Alembic revision before production use.
- **OCR is best-effort.** Tesseract must be installed for image/scanned documents; otherwise those documents are
  routed to manual review. Extracted values are candidates, never proof of authenticity.
- **Local JWT sessions** stored in browser `localStorage` (prototype convenience). Swap in httpOnly cookies /
  an identity provider for production.
- **E-mail delivery** is unconfigured by default; notifications are in-app only.
- The maturity/escalation thresholds are **demonstration defaults**, not AICTE-mandated intervals.

## API documentation

Interactive OpenAPI/Swagger is served by the backend at `/docs` (and `/openapi.json`) once it is running.
