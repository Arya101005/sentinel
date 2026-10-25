# FDR Sentinel

**Monitor Smarter. Verify Better. Act on Time.**

AI-assisted monitoring and verification of security deposit Fixed Deposit Receipts (FDRs) for the
**All India Council for Technical Education (AICTE), Regulation Bureau** — Smart India Hackathon prototype,
problem statement **26265**, theme **Smart Automation**.

> **Honesty note.** FDR Sentinel is a complementary monitoring and decision-support prototype. It is **not**
> connected to AICTE's production portal, to any bank's infrastructure, or to any bank verification API. OCR
> output is a *candidate value for human review*, never proof of authenticity. A matured FDR is a follow-up
> item, never a finding of non-compliance. No record is auto-approved and no funds are ever moved.

---

## 1. What this repository contains

A single deployable web application:

| Layer | Implementation |
| --- | --- |
| Frontend | React 18 + Vite 5 + TypeScript + Tailwind CSS + shadcn-style UI kit, React Router, TanStack Query, React Hook Form, Zod, Recharts, Lucide |
| Database & services | PostgreSQL via **Supabase**, Supabase Auth, private Supabase Storage bucket, Row Level Security, SQL migrations |
| OCR | **pdf.js** text-layer extraction + rendered-page OCR with **Tesseract.js**, entirely in the browser |
| Server-side | **Vercel Functions** (`/api`) for privileged operations only: bootstrap, user/role management, demo data, scheduled monitoring scan, diagnostics |
| Tests | Vitest unit tests (96) + a live integration suite (`npm run verify:live`) + browser end-to-end checks |

### Relationship to the previous code in this repository

The repository previously held a FastAPI + SQLite prototype with a separate React frontend, plus an
incompatible, integer-keyed Supabase schema (password hashes in `public.users`, **zero RLS policies**, no Auth
users). The requested architecture explicitly rules out a separately deployed FastAPI server and MySQL-style
credentials in the database, so the backend was replaced with Supabase + Vercel Functions, and the interface was
rebuilt on the same domain model.

Nothing was destroyed silently:

- A JSON export of every legacy table (101 KB) was taken before migration.
- `supabase/migrations/0000_legacy_cleanup.sql` removes the legacy objects **only** when the legacy marker
  (`public.users.password_hash`) still exists, so re-running migrations is safe.
- The legacy rows were synthetic demo rows and are **not** referenced by this implementation.
- All business rules that the old prototype encoded (role model, workflow stages, maturity classification,
  discrepancy rules) were carried forward and reimplemented, with tests.

---

## 2. Feature modules

| Module | What is implemented | Where the rule is enforced |
| --- | --- | --- |
| **A. Dashboard** | Live counts (total, active, approaching, maturing today, matured, matured-without-release, pending verification, flagged, renewals/releases in progress), maturity buckets chart, verification pie, pending-action lists, recent records, institution table, empty state with one-click demo data | `fn_dashboard_summary()` (SECURITY INVOKER → RLS applies) |
| **B. FDR registry** | Create / read / update / archive, pagination, sorting, filters, search, CSV export, per-institution duplicate reference index, likely-duplicate detection | RLS + `fdr_records` constraints + `fn_guard_fdr_changes()` |
| **C. Documents & OCR** | Private upload (PDF/PNG/JPEG/WebP ≤ 10 MB), replacement history, signed-URL viewing, browser OCR, extracted-value review with per-field confidence, manual fallback on OCR failure, reprocessing | Storage bucket policies + `fdr_documents` RLS + `fn_log_event()` |
| **D. Discrepancy detection** | 13 deterministic rules (required fields, invalid amount, date order, implausible tenure, duplicate suspect, missing document, OCR reference/bank/amount/date/branch mismatch, low confidence, unreadable fields), each with field, submitted value, comparison value and explanation; review with observation | Pure TS rules (`src/lib/discrepancies.ts`) persisted through `fn_upsert_discrepancy_flags()`; review through `fn_review_discrepancy()` |
| **E. Maturity monitoring** | IST policy timezone, configurable 30/15/7-day windows (editable), upcoming / today / matured / matured-without-application queues, daily idempotent alert scan, alert history | `src/lib/maturity.ts` + `/api/monitoring/scan` + unique `notifications.dedupe_key` |
| **F. Release & renewal workflow** | draft → submitted → under review → info required → resubmitted → approved/rejected → completed, notes required for consequential steps, timeline, no step skipping, no self-approval, mirrored onto the FDR | `fn_transition_application()` — the UI only renders actions the database will accept |
| **G. Notifications** | In-app notifications with read/unread, categories, links to records, recipient scoping; email explicitly reported as not configured | `notifications` RLS + generated only by trusted server-side code |
| **H. Audit trail** | Create/update/document/OCR/discrepancy/verification/workflow/user-role/report-export events, append-only, automatic row triggers | `fn_audit_row()` triggers + `fn_block_audit_mutation()`; browser has **no** INSERT/UPDATE/DELETE grant |
| **I. Reports** | Active, upcoming, matured, matured-without-release, pending verification, discrepancies, renewals, releases, institution-wise; filters and permission-scoped CSV export with audit entry | Queries run under RLS; export logged via `fn_log_event()` |

Also included: institutions master data, user & role administration, system settings, deployment diagnostics,
forgot/reset password, and a one-time administrator bootstrap page.

---

## 3. Architecture

```
/
├── api/                          # Vercel Functions (Node, server-only)
│   ├── bootstrap.ts              # one-time first administrator
│   ├── diagnostics.ts            # deployment health checks (admin)
│   ├── admin/users.ts            # create/list/update users & roles
│   ├── admin/demo-data.ts        # seed / remove synthetic dataset
│   ├── monitoring/scan.ts        # daily + on-demand maturity alerts (cron or admin)
│   └── _lib/                     # shared HTTP, auth, alert and seed logic
├── src/
│   ├── lib/
│   │   ├── maturity.ts           # pure maturity classification (IST policy)
│   │   ├── discrepancies.ts      # pure deterministic rules
│   │   ├── duplicates.ts         # likely-duplicate detection
│   │   ├── workflow.ts           # lifecycle transitions & role gates
│   │   ├── permissions.ts        # UI capability matrix
│   │   ├── validation.ts         # Zod schemas (shared with API)
│   │   ├── csv.ts                # formula-injection-safe CSV
│   │   ├── ocr/                  # pdf.js + Tesseract pipeline and field parsing
│   │   ├── supabase.ts / auth.tsx / queries.ts / api.ts
│   ├── components/               # layout, UI kit, document & discrepancy panels
│   └── pages/                    # dashboard, registry, maturity, discrepancies,
│                                 # applications, reports, notifications, audit,
│                                 # users, institutions, settings, auth pages
├── supabase/migrations/          # version-controlled SQL (schema, RLS, RPCs, seed defaults)
├── scripts/
│   ├── apply-migrations.mjs      # migration runner (server-side connection)
│   └── verify-live.mjs           # live integration test suite
└── vercel.json                   # Vite build, SPA rewrite, cron schedule, security headers
```

There is **no** separate backend server, no MySQL, and no second deployment. `/api/*` functions live in the same
project and are routed by Vercel; locally they run through a Vite dev middleware that loads the same handler files,
so `/api/...` behaves the same in development and production.

---

## 4. Quick start (local development)

Prerequisites: Node.js 20+, a Supabase project.

```bash
git clone https://github.com/Arya101005/sentinel.git
cd sentinel
npm install

cp .env.example .env          # then fill in the values
npm run migrate               # applies supabase/migrations/*.sql
npm run dev                   # http://localhost:5173
```

Then open `/bootstrap` and create the first System Administrator. That page stops working permanently once an
administrator exists.

### Environment variables

| Variable | Visibility | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | browser (public) | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser (public) | Publishable/anon key — safe to ship, all access is governed by RLS |
| `SUPABASE_URL` | server only | Used by Vercel Functions |
| `SUPABASE_SECRET_KEY` | **server only** | Service-role equivalent, used *after* re-authorising the caller. Never prefix with `VITE_` |
| `SUPABASE_DB_URL` | server only, optional | Only for the migration script (pooler host, IPv4) |
| `CRON_SECRET` | server only | Authorises the scheduled `/api/monitoring/scan` call |
| `VERIFY_ADMIN_EMAIL` / `VERIFY_ADMIN_PASSWORD` | local only, optional | Used by `npm run verify:live` |

`.env`, `.env.local`, `.env.production` and `.vercel/` are git-ignored. `.env.example` contains placeholders only.
**The credentials that were shared in plain text during development must be rotated** — see §11.

> **Supabase Auth note.** If "Confirm email" is enabled in the project, self-registered users must confirm their
> address before signing in. Administrator-created users are created pre-confirmed through the Admin API, so a demo
> never depends on outbound mail. Email delivery is **not** configured, and the UI never claims an email was sent.

### Database migrations

Migrations are ordered SQL files under `supabase/migrations/`:

| File | Contents |
| --- | --- |
| `0000_legacy_cleanup.sql` | One-time, guarded removal of the abandoned prototype schema |
| `0001_schema.sql` | 12 tables, foreign keys, CHECK constraints, unique partial index on live FDR references, indexes |
| `0002_functions.sql` | Identity helpers, profile/escalation guards, audit triggers, discrepancy/verification/workflow RPCs, dashboard aggregate, setup status |
| `0003_rls.sql` | RLS on every table, 37 policies, 4 private-bucket storage policies, audit immutability, settings defaults |
| `0004_application_requester.sql` | Forces every application to record its real requester |

Run with `npm run migrate` (uses `SUPABASE_DB_URL`) or paste the files into the Supabase SQL editor in order.
Every file is written to be re-runnable; `0000` only acts while the legacy marker exists.

---

## 5. Roles and access control

Authentication is Supabase Auth (email + password). The role lives in `public.profiles` and is **only** writable
by the service-role API: `fn_guard_profile_changes()` rejects any browser attempt to change `role`,
`institution_id`, `is_active` or `email`, so no user can promote themselves.

| Capability | System Administrator | AICTE Officer | Institution User | Read-only Auditor |
| --- | :-: | :-: | :-: | :-: |
| View records | all | all | own institution | all |
| Create / edit FDR | ✔ | ✔ | own institution | — |
| Upload documents / run OCR | ✔ | ✔ | own institution | — |
| Set verification status | ✔ | ✔ | — | — |
| Review discrepancy flags | ✔ | ✔ | — | — |
| Submit release/renewal request | ✔ | — | own institution | — |
| Decide (review/approve/reject/complete) | ✔ | ✔ | — | — |
| Export reports | ✔ | ✔ | own institution | ✔ |
| Audit trail | full | full | own actions | full |
| Manage users / institutions / settings | ✔ | — | — | — |

Additional database rules:

- Institution isolation is applied to `fdr_records`, `fdr_documents`, `ocr_extractions`, `discrepancy_flags`,
  `verification_events`, `release_applications`, `application_events` **and** `storage.objects`.
- Verified status requires all unresolved flags to be resolved or accepted first.
- Self-approval is blocked in `fn_transition_application()` unless `system_settings.workflow.allow_self_approval`
  is explicitly enabled (default `false`).
- Auditors have no write policy anywhere and no insert/update/delete grants on the audit trail.

Bootstrap of the first administrator is a one-time endpoint that double-checks (before and after user creation)
that no administrator exists; concurrent attempts are rejected and the extra account is deleted.

---

## 6. Data model

| Table | Purpose |
| --- | --- |
| `institutions` | Institution master data (code, type, region, contacts, active flag, demo marker) |
| `profiles` | One row per Auth user: email, name, role, institution, active flag |
| `fdr_records` | FDR registry: reference, bank, branch, amount (`numeric(14,2)`), issue/maturity dates, validity/renewal/administrative/verification state, notes, archive + demo markers |
| `fdr_documents` | Private storage path, MIME type, size, type, current/replaced history, OCR status |
| `ocr_extractions` | Raw text, extracted candidate fields, per-field confidence, engine, failure reason |
| `discrepancy_flags` | Rule code, field, severity, submitted vs compared value, explanation, review status/notes |
| `verification_events` | Officer verification decisions with previous/new status and observations |
| `release_applications` | Release/renewal lifecycle, requester, claimed amount, decision metadata |
| `application_events` | Append-only transition log with actor, role, note |
| `notifications` | Per-recipient in-app alerts with unique `dedupe_key` |
| `audit_events` | Append-only audit trail (`jsonb` metadata) |
| `system_settings` | Warning intervals, channels, workflow policy, timezone, organisation, demo/verification notes |

Amounts are `numeric(14,2)` — never floating point. Dates are `date`; all maturity arithmetic uses the
`Asia/Kolkata` calendar date. `maturity_date > issue_date` and positive amounts are database CHECK constraints.

---

## 7. Maturity monitoring and notifications

- **Policy timezone:** `Asia/Kolkata`, stored in `system_settings.timezone`. "Today" is always computed from that
  timezone, never the server's local clock.
- **Warning intervals:** configurable in Settings (default `30, 15, 7`), enforced to be unique and 1–365 days.
- **Classification:** archived → closed; maturity passed with a recorded release application → *matured, application
  recorded*; without one → *matured, no release application* (follow-up item); today → *maturing today*; inside the
  widest window → *approaching*; otherwise *active*.
- **Scan:** `/api/monitoring/scan`, scheduled daily by `vercel.json` (`0 2 * * *` UTC) with
  `Authorization: Bearer $CRON_SECRET`, and runnable by an administrator from Settings or the Maturity page.
  It runs with no user session and does not depend on the browser.
- **Idempotency:** every candidate alert has a deterministic `dedupe_key`
  (`maturity-upcoming:<fdr>:<recipient>:<date>:<threshold>` etc.) protected by a UNIQUE constraint, and inserts use
  `ON CONFLICT DO NOTHING`. A second run creates zero duplicates (verified by the live suite).
- **Recipients:** administrators and officers are alerted for every institution; an institution user only for their
  own institution; auditors receive none.

Email delivery is **not** configured. The interface states this explicitly and the scan only writes in-app
notifications; no success is ever shown for an email that was not sent.

---

## 8. OCR and verification boundaries

1. The upload is validated (MIME, size, non-empty) and stored in the **private** `fdr-documents` bucket under
   `<institution_id>/<fdr_id>/<uuid>.<ext>`.
2. Text extraction prefers the PDF text layer (pdf.js); scanned PDFs/images are rendered and OCR'd with Tesseract.js
   **in the browser**. Nothing is sent to a third-party OCR service.
3. Extracted candidates are stored with per-field and average confidence and displayed next to the submitted values.
4. Applying a candidate only fills the form — nothing is saved until the user saves the record, and nothing is ever
   marked "verified" by OCR.
5. Deterministic rules create explainable flags. An officer's `verified` decision means *"an officer compared this
   record with the uploaded document"* — the UI says so and never claims bank attestation.
6. If OCR fails, the document is kept, the failure is stored with a readable reason, manual entry remains possible,
   and OCR can be retried.

Known parser limits: printed receipts are parsed with heuristics (Indian date formats, lakh/crore, label-based field
detection). Handwriting, skew, low-resolution scans and multi-column layouts reduce accuracy; low confidence is
flagged instead of being trusted silently.

---

## 9. Demonstration data

`POST /api/admin/demo-data` (administrator) creates a refreshable synthetic dataset: 8 institutions, 14 FDRs covering
all seven required scenarios (active, approaching, maturing today, matured without an application, OCR amount
mismatch, missing information, renewal in progress, release awaiting review), synthetic PDF "receipts", OCR
extractions, flags, applications, verification events and notifications. Every row is marked `is_demo` and rendered
with a *Demonstration data* badge. `DELETE /api/admin/demo-data` removes only `is_demo` rows and their demo
notifications. The dataset was created with synthetic bank names and fake institutions; nothing is claimed to be
bank- or AICTE-verified.

---

## 10. Testing

```bash
npm run typecheck     # TypeScript, app + API
npm run lint          # ESLint (no errors)
npm run test          # 96 unit tests
npm run build         # production build
npm run verify:live   # live integration suite (needs a running app + Supabase credentials)
```

Unit coverage (`src/**/*.test.ts(x)`, `api/_lib/alerts.test.ts`): IST date handling and invalid-date rejection,
maturity classification/buckets/warning thresholds, discrepancy rules (required fields, dates, amount/reference/date
mismatches, low confidence, duplicates, missing documents), duplicate detection and normalisation, workflow
transitions and role gates incl. self-approval, capability matrix, Zod form/document validation, OCR date/amount/field
parsing, CSV escaping and formula-injection prevention, alert scoping/idempotency, and status badge rendering.

`npm run verify:live` provisions temporary users and one temporary FDR in the real project, asserts 49 checks and
cleans up after itself. It covers: sign-in, administrator APIs, demo seeding, RLS isolation between institutions,
profile escalation attempts, audit-trail immutability, notification forgery, FDR creation with exact amounts,
duplicate/date/cross-institution rejection, institution inability to set verification status, private storage
upload/read isolation, OCR persistence, flag persistence/review authorisation, verification guard, full workflow
(including step-skipping and self-approval rejection), timeline/audit rows, notification read state, and scheduled
scan idempotency.

---

## 11. Deployment (Vercel)

1. Import the GitHub repository `Arya101005/sentinel` into Vercel, or run `vercel link` / `vercel --prod`.
   Framework preset: **Vite**; build `npm run build`; output `dist`. `vercel.json` already configures the SPA rewrite
   (`/((?!api/).*) → /index.html`), security headers and the daily cron.
2. Add environment variables in **Vercel → Project → Settings → Environment Variables** for Production and Preview:

   | Name | Value source |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Supabase project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key |
   | `SUPABASE_URL` | Supabase project URL |
   | `SUPABASE_SECRET_KEY` | Supabase secret/service-role key (**server only**) |
   | `CRON_SECRET` | long random string used by the cron header |

   `SUPABASE_DB_URL` is only needed locally for migrations; do not add it to the deployment.
3. Deploy, then verify `https://<deployment>/api/diagnostics` (as an administrator) reports every check as `ok`.
4. Run `/bootstrap` once on the new deployment if the project has no administrator yet.

### Security operational notes

- The service-role key is never sent to the browser, never appears in the client bundle and is only read inside
  `/api` handlers, after the caller's JWT has been validated and their role loaded from the database.
- **Rotate the Supabase keys and database password that were shared in plain text during development.** Rotating a
  key does not rewrite git history: if any secret was ever committed, purge it with `git filter-repo`/BFG and
  invalidate it at the provider. `.gitignore` only prevents *future* commits.
- Supabase "Confirm email" and password recovery use Supabase Auth; the app stores no password hashes.
- No `console.log` prints tokens or environment values. Diagnostics reports only presence flags.

---

## 12. Known limitations

- No bank or AICTE verification API is connected. Every screen that mentions verification says what was actually
  checked. Any claim of authenticity would be false.
- Email notifications are not configured (in-app notifications work fully).
- OCR is heuristic and browser-based; large or image-heavy PDFs are OCR'd up to the first five pages.
- The CSV preview is capped at 200 rows and exports at 2,000 rows per file.
- Automated tests use synthetic data; no production data was touched.
- Demo records remain in the project until an administrator removes them from Settings.

---

## 13. Project metadata

- Problem statement: 26265 — AICTE, Regulation Bureau
- Theme: Smart Automation
- Tagline: *Monitor Smarter. Verify Better. Act on Time.*
- All India Council for Technical Education · Regulation Bureau
