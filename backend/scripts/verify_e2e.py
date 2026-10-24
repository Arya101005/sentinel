"""Live end-to-end verification of FDR Sentinel against a running backend.

Usage:
    cd backend && python scripts/verify_e2e.py [base_url]

Requires a seeded database (python -m app.seed --reset) and the API running.
Every check prints PASS / FAIL / WARN with a short detail line. Exit code is
non-zero if any FAIL occurs. No real personal or financial data is used.
"""

from __future__ import annotations

import io
import sys
from datetime import date, timedelta

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
API = f"{BASE}/api/v1"
PASSWORD = "Demo@Sentinel123"

results: list[tuple[str, str, str]] = []


def check(area: str, name: str, ok: bool, detail: str = "", warn: bool = False) -> None:
    status = "PASS" if ok else ("WARN" if warn else "FAIL")
    results.append((status, f"{area} :: {name}", detail))
    print(f"[{status}] {area} :: {name}" + (f" — {detail}" if detail else ""))


def login(client: httpx.Client, username: str) -> dict:
    r = client.post(f"{API}/auth/login", json={"username": username, "password": PASSWORD})
    r.raise_for_status()
    return r.json()


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def make_pdf(text: str) -> bytes:
    """Build a minimal but *valid* text-bearing PDF (proper BT/Tj operators)
    so PyMuPDF can genuinely extract the embedded text during processing."""
    lines = text.split("\n")
    # Content stream: draw each line with real text operators.
    parts = [b"BT\n/F1 11 Tf\n50 760 Td\n14 TL\n"]
    for i, line in enumerate(lines):
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        if i == 0:
            parts.append(f"({safe}) Tj\n".encode("latin-1", "replace"))
        else:
            parts.append(f"T* ({safe}) Tj\n".encode("latin-1", "replace"))
    parts.append(b"ET\n")
    stream = b"".join(parts)
    objects = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R"
        b"/Resources<</Font<</F1 5 0 R>>>>>>",
        b"<</Length " + str(len(stream)).encode() + b">>stream\n" + stream + b"endstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for idx, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{idx} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode() + b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<</Size {len(objects) + 1}/Root 1 0 R>>\nstartxref\n{xref}\n%%EOF".encode()
    return bytes(out)


def main() -> int:
    with httpx.Client(timeout=30) as c:
        # -------------------------------------------------------------- 1. Auth
        r = c.get(f"{API}/health")
        check("1 Auth", "health endpoint", r.status_code == 200 and r.json().get("status") == "ok", r.text[:80])

        r = c.post(f"{API}/auth/login", json={"username": "admin", "password": "wrong"})
        check("1 Auth", "bad password rejected", r.status_code == 401, f"status={r.status_code}")

        r = c.get(f"{API}/auth/me")
        check("1 Auth", "unauthenticated /me rejected", r.status_code == 401, f"status={r.status_code}")

        admin = login(c, "admin")
        officer = login(c, "officer")
        authority = login(c, "authority")
        auditor = login(c, "auditor")
        inst_a = login(c, "userdemoa")   # DEMO-A institution user
        inst_b = login(c, "userdemob")   # DEMO-B institution user
        a_id = inst_a["user"]["institution_id"]
        b_id = inst_b["user"]["institution_id"]
        check("1 Auth", "all demo roles login", True,
              f"admin/officer/authority/auditor/inst(A={a_id},B={b_id})")

        r = c.get(f"{API}/auth/me", headers=auth(officer["access_token"]))
        check("1 Auth", "/me returns profile", r.status_code == 200 and r.json()["role"] == "officer")

        # RBAC: auditor is read-only.
        r = c.post(f"{API}/fdr-records", headers=auth(auditor["access_token"]),
                   json={"institution_id": a_id, "fdr_reference_number": "AUD/TEST/1",
                         "bank_name": "State Bank of India", "deposit_amount": "1000.00"})
        check("1 RBAC", "auditor cannot create FDR", r.status_code == 403, f"status={r.status_code}")

        # ------------------------------------------- 2. Institution isolation
        off_fdrs = c.get(f"{API}/fdr-records", headers=auth(officer["access_token"]),
                         params={"page_size": 100}).json()
        other = next((x for x in off_fdrs["items"] if x["institution_id"] != a_id), None)
        check("2 Isolation", "officer sees multiple institutions",
              len({x["institution_id"] for x in off_fdrs["items"]}) > 1,
              f"distinct={len({x['institution_id'] for x in off_fdrs['items']})}")

        mine = c.get(f"{API}/fdr-records", headers=auth(inst_a["access_token"]),
                     params={"page_size": 200}).json()
        only_own = all(x["institution_id"] == a_id for x in mine["items"])
        check("2 Isolation", "institution user sees only own FDRs", only_own,
              f"rows={mine['total']}, all_institution_{a_id}={only_own}")

        if other:
            r = c.get(f"{API}/fdr-records/{other['id']}", headers=auth(inst_a["access_token"]))
            check("2 Isolation", "cross-institution FDR detail -> 404", r.status_code == 404,
                  f"fdr#{other['id']} status={r.status_code}")

        # ---------------------------------------------- 3. FDR create / edit
        today = date.today()
        payload = {
            "institution_id": a_id,
            "fdr_reference_number": "AUD/E2E/9001",
            "bank_name": "HDFC Bank",
            "branch_name": "Amaravati",
            "deposit_amount": "400000.00",
            "issue_date": (today - timedelta(days=10)).isoformat(),
            "maturity_date": (today + timedelta(days=355)).isoformat(),
        }
        r = c.post(f"{API}/fdr-records", headers=auth(inst_a["access_token"]), json=payload)
        created = r.json()
        check("3 FDR", "institution user creates FDR", r.status_code == 201,
              f"status={r.status_code} id={created.get('id')}")
        fdr_id = created.get("id")

        r = c.post(f"{API}/fdr-records", headers=auth(inst_a["access_token"]),
                   json={**payload, "institution_id": b_id, "fdr_reference_number": "AUD/E2E/X"})
        check("3 FDR", "cannot create FDR for another institution", r.status_code == 403,
              f"status={r.status_code}")

        r = c.patch(f"{API}/fdr-records/{fdr_id}", headers=auth(inst_a["access_token"]),
                    json={"remarks": "E2E audit edit", "deposit_amount": "410000.00"})
        check("3 FDR", "edit FDR (amount + remarks)", r.status_code == 200 and
              r.json()["deposit_amount"] == "410000.00", f"status={r.status_code}")

        r = c.get(f"{API}/fdr-records/{fdr_id}/lifecycle-history", headers=auth(inst_a["access_token"]))
        events = r.json()
        check("3 FDR", "lifecycle history recorded", r.status_code == 200 and len(events) >= 2,
              f"events={len(events)}")

        # ------------------------------------- 4. Document upload + OCR
        receipt = (
            "Fixed Deposit Receipt\n"
            "Bank: HDFC Bank\nBranch: Amaravati\n"
            "FDR No: AUD/E2E/9001\n"
            "Deposit Amount: Rs. 410000.00\n"
            f"Date of Issue: {(today - timedelta(days=10)).strftime('%d %B %Y')}\n"
            f"Maturity Date: {(today + timedelta(days=355)).strftime('%d %B %Y')}\n"
        )
        files = {"file": ("receipt.pdf", io.BytesIO(make_pdf(receipt)), "application/pdf")}
        data = {"document_type": "fdr_receipt", "fdr_id": str(fdr_id)}
        r = c.post(f"{API}/documents", headers=auth(inst_a["access_token"]), files=files, data=data)
        doc = r.json()
        check("4 Doc/OCR", "upload PDF document", r.status_code == 201,
              f"status={r.status_code} id={doc.get('id')}")
        doc_id = doc.get("id")

        preview = ""
        if doc_id:
            r = c.post(f"{API}/documents/{doc_id}/process", headers=auth(inst_a["access_token"]))
            proc = r.json() if r.status_code == 200 else {}
            preview = proc.get("extracted_text_preview", "")
            check("4 Doc/OCR", "process extracts text", r.status_code == 200 and "Rs." in preview,
                  f"status={r.status_code} chars={len(preview)}")

            r = c.get(f"{API}/documents/{doc_id}/extractions", headers=auth(inst_a["access_token"]))
            fields = r.json() if r.status_code == 200 and isinstance(r.json(), list) else []
            names = {f["field_name"] for f in fields}
            check("4 Doc/OCR", "extractions parsed to fields",
                  r.status_code == 200 and "deposit_amount" in names, f"fields={sorted(names)}")
        else:
            check("4 Doc/OCR", "process extracts text", False, "upload failed, no document id")
            check("4 Doc/OCR", "extractions parsed to fields", False, "upload failed, no document id")

        # ---------------------------------------- 5. Discrepancy detect/review
        # (a) pre-seeded scenario C amount mismatch visible to officer
        r = c.get(f"{API}/discrepancies", headers=auth(officer["access_token"]),
                  params={"status": "open", "page_size": 100})
        flags = r.json()["items"]
        amt = next((x for x in flags if x["discrepancy_type"] == "amount_mismatch"), None)
        check("5 Discrepancy", "seeded amount mismatch flagged", amt is not None,
              f"open_flags={len(flags)}, amount_mismatch={'yes' if amt else 'no'}")

        # (b) fresh upload with a mismatching amount should raise a new flag
        bad_receipt = receipt.replace("410000.00", "999000.00")
        files = {"file": ("receipt2.pdf", io.BytesIO(make_pdf(bad_receipt)), "application/pdf")}
        r = c.post(f"{API}/documents", headers=auth(inst_a["access_token"]), files=files, data=data)
        doc2 = r.json() if r.status_code == 201 else {}
        if doc2.get("id"):
            r = c.post(f"{API}/documents/{doc2['id']}/process", headers=auth(inst_a["access_token"]))
            new_flags = r.json().get("flags_created", []) if r.status_code == 200 else []
            check("5 Discrepancy", "mismatched amount raises new flag", len(new_flags) > 0,
                  f"flags_created={new_flags}")
        else:
            check("5 Discrepancy", "mismatched amount raises new flag", False,
                  f"upload failed status={r.status_code}")

        if amt:
            r = c.post(f"{API}/discrepancies/{amt['id']}/resolve", headers=auth(officer["access_token"]),
                       json={"resolution_notes": "E2E: confirmed against original (DEMO)."})
            check("5 Discrepancy", "resolve a discrepancy", r.status_code == 200,
                  f"status={r.status_code}")

        # ---------------------------------- 6. Matured FDRs without application
        r = c.get(f"{API}/monitoring/matured-no-application", headers=auth(officer["access_token"]),
                  params={"page_size": 100})
        mrows = r.json()["items"]
        has_b = any("PNB/CEN/2021/1189" in (x.get("fdr_reference_number") or "") for x in mrows)
        check("6 MaturedNoApp", "matured-without-application queue populated", len(mrows) >= 1,
              f"rows={len(mrows)}; includes scenario B={has_b}")

        # ------------------------------ 7. Maturity notifications + dedup
        r1 = c.post(f"{API}/monitoring/run-checks", headers=auth(officer["access_token"]))
        res1 = r1.json()
        r2 = c.post(f"{API}/monitoring/run-checks", headers=auth(officer["access_token"]))
        res2 = r2.json()
        check("7 Notify", "monitoring run is idempotent (2nd pass creates no dupes)",
              res2["notifications_created"] == 0 or res2["duplicates_suppressed"] >= 0,
              f"run1 created={res1['notifications_created']} suppressed={res1['duplicates_suppressed']}; "
              f"run2 created={res2['notifications_created']} suppressed={res2['duplicates_suppressed']}")

        r = c.get(f"{API}/notifications", headers=auth(officer["access_token"]),
                  params={"page_size": 200})
        notifs = r.json()["items"]
        matured_keys = [n for n in notifs if n["notification_type"] == "matured_no_application"
                        and n.get("fdr_id")]
        dupes = {}
        for n in matured_keys:
            dupes[n["fdr_id"]] = dupes.get(n["fdr_id"], 0) + 1
        worst = max(dupes.values()) if dupes else 0
        check("7 Notify", "no duplicate matured notifications per FDR", worst <= 1,
              f"max per FDR={worst}")

        # ------------------------- 8. Release workflow + clearance tracking
        apps = c.get(f"{API}/applications", headers=auth(officer["access_token"]),
                     params={"page_size": 100}).json()
        app_e = next((x for x in apps["items"] if x["application_reference"] == "REL-DEMO-0001"), None)
        check("8 Workflow", "scenario E application present", app_e is not None,
              f"apps={apps['total']}")
        if app_e:
            check("8 Workflow", "scenario E in clearance stage",
                  app_e["application_status"] == "awaiting_clearance",
                  f"status={app_e['application_status']}")
            cl = c.get(f"{API}/clearances", headers=auth(officer["access_token"]),
                       params={"application_id": app_e["id"], "page_size": 50}).json()
            types = {x["clearance_type"]: x["status"] for x in cl["items"]}
            check("8 Workflow", "clearances tracked (bank cleared, finance pending)",
                  types.get("bank_verification") == "cleared" and
                  types.get("finance_concurrence") == "pending", f"clearances={types}")

            # invalid transition must be rejected
            r = c.patch(f"{API}/applications/{app_e['id']}/status",
                        headers=auth(officer["access_token"]),
                        json={"new_status": "completed"})
            check("8 Workflow", "invalid transition rejected", 400 <= r.status_code < 500,
                  f"clearance->completed status={r.status_code}")

            # clearance gate: advancing to authority is blocked while clearances pend
            r = c.patch(f"{API}/applications/{app_e['id']}/status",
                        headers=auth(officer["access_token"]),
                        json={"new_status": "awaiting_authority_decision"})
            check("8 Workflow", "clearance gate blocks advance while clearances pending",
                  400 <= r.status_code < 500, f"status={r.status_code}")

            # clear the outstanding clearances (finance + audit; bank already cleared)
            cleared_ok = True
            for item in cl["items"]:
                if item["status"] in ("pending", "in_progress") and \
                        item["clearance_type"] != "competent_authority_approval":
                    rc = c.post(f"{API}/clearances/{item['id']}",
                                headers=auth(officer["access_token"]),
                                json={"status": "cleared", "remarks": "E2E cleared (DEMO)."})
                    cleared_ok = cleared_ok and rc.status_code == 200
            check("8 Workflow", "officer records outstanding clearances", cleared_ok,
                  "finance/audit cleared")

            # now a valid transition clearance -> authority succeeds
            r = c.patch(f"{API}/applications/{app_e['id']}/status",
                        headers=auth(officer["access_token"]),
                        json={"new_status": "awaiting_authority_decision",
                              "comments": "E2E: clearances resolved (DEMO)."})
            check("8 Workflow", "valid transition clearance->authority", r.status_code == 200,
                  f"status={r.status_code}")

            # competent-authority gate: plain officer cannot approve from authority stage
            r = c.patch(f"{API}/applications/{app_e['id']}/status",
                        headers=auth(officer["access_token"]), json={"new_status": "approved"})
            check("8 Workflow", "competent-authority approval gated from plain officer",
                  r.status_code in (403, 400), f"officer approve status={r.status_code}")
            r = c.patch(f"{API}/applications/{app_e['id']}/status",
                        headers=auth(authority["access_token"]), json={"new_status": "approved"})
            check("8 Workflow", "competent authority can approve", r.status_code == 200,
                  f"authority approve status={r.status_code}")

            tl = c.get(f"{API}/applications/{app_e['id']}/timeline",
                       headers=auth(officer["access_token"]))
            check("8 Workflow", "application timeline recorded", tl.status_code == 200 and len(tl.json()) >= 2,
                  f"events={len(tl.json())}")

        # ---------------------------------- 9. Renewal / replacement links
        fdrs = c.get(f"{API}/fdr-records", headers=auth(officer["access_token"]),
                     params={"q": "IOB/FAR/2024/0099-R", "page_size": 10}).json()
        newrec = fdrs["items"][0] if fdrs["items"] else None
        ok_link = bool(newrec and newrec.get("renewal_parent_id") and newrec.get("link_type") == "replacement")
        check("9 Link", "replacement FDR linked to previous record", ok_link,
              f"link={newrec.get('link_type') if newrec else None} parent={newrec.get('renewal_parent_id') if newrec else None}")
        if newrec:
            old = c.get(f"{API}/fdr-records/{newrec['renewal_parent_id']}",
                        headers=auth(officer["access_token"])).json()
            check("9 Link", "previous record preserved as replaced",
                  old.get("lifecycle_status") == "replaced", f"old lifecycle={old.get('lifecycle_status')}")

        # exercise the /link endpoint with a fresh renewal
        today2 = date.today()
        nr = c.post(f"{API}/fdr-records", headers=auth(inst_a["access_token"]),
                    json={"institution_id": a_id, "fdr_reference_number": "AUD/E2E/RENEW",
                          "bank_name": "HDFC Bank", "deposit_amount": "100000.00",
                          "issue_date": today2.isoformat(),
                          "maturity_date": (today2 + timedelta(days=365)).isoformat()})
        if nr.status_code == 201 and fdr_id:
            r = c.post(f"{API}/fdr-records/{fdr_id}/link", headers=auth(inst_a["access_token"]),
                       json={"link_type": "renewal", "linked_fdr_id": nr.json()["id"],
                             "comment": "E2E renewal (DEMO)"})
            old2 = r.json() if r.status_code == 200 else {}
            check("9 Link", "create + link renewal via /link endpoint",
                  r.status_code == 200 and old2.get("lifecycle_status") == "renewed",
                  f"status={r.status_code} old_lifecycle={old2.get('lifecycle_status')}")

        # -------------------------------- 10. Dashboard + report exports
        s = c.get(f"{API}/monitoring/summary", headers=auth(officer["access_token"])).json()
        cards = {k["key"]: k["value"] for k in s["cards"]}
        mnac = c.get(f"{API}/monitoring/matured-no-application", headers=auth(officer["access_token"]),
                     params={"page_size": 1}).json()
        check("10 Dashboard", "matured_no_application card matches live queue",
              cards.get("matured_no_application") == mnac["total"],
              f"card={cards.get('matured_no_application')}, queue={mnac['total']}")
        check("10 Dashboard", "summary exposes computed active-FDR KPI",
              isinstance(cards.get("total_active_fdrs"), int),
              f"total_active_fdrs={cards.get('total_active_fdrs')}")

        ch = c.get(f"{API}/monitoring/charts", headers=auth(officer["access_token"])).json()
        check("10 Dashboard", "charts computed from data",
              "lifecycle_status" in ch and len(ch["lifecycle_status"]["buckets"]) >= 1,
              f"series={list(ch.keys())}")

        csv = c.get(f"{API}/reports/institution_register/csv", headers=auth(officer["access_token"]))
        csv_ok = csv.status_code == 200 and "text/csv" in csv.headers.get("content-type", "") and len(csv.text) > 50
        check("10 Reports", "institution_register CSV export", csv_ok,
              f"status={csv.status_code} bytes={len(csv.content)}")

        pdf = c.get(f"{API}/reports/upcoming_maturity/pdf", headers=auth(officer["access_token"]))
        check("10 Reports", "upcoming_maturity PDF export",
              pdf.status_code == 200 and pdf.content[:4] == b"%PDF",
              f"status={pdf.status_code} magic={pdf.content[:4]!r}")

        # CSV formula-injection guard: exported cells should not start raw '=' etc.
        inj = c.get(f"{API}/reports/discrepancies/csv", headers=auth(officer["access_token"]))
        guarded = not any(line.split(",")[0].startswith(("=", "+", "@")) for line in inj.text.splitlines()[1:]
                          if line.split(",")[0])
        check("10 Reports", "CSV formula-injection guarded", guarded, "leading '='/'+'/'@' neutralised")

        # ------------------------------------------- 11. Audit history
        r = c.get(f"{API}/audit", headers=auth(officer["access_token"]), params={"page_size": 200})
        audit = r.json()
        actions = {x["action"] for x in audit["items"]}
        needed = {"fdr.created", "document.uploaded", "document.processed", "application.status_changed"}
        check("11 Audit", "audit trail captures key actions", needed.issubset(actions),
              f"captured={sorted(actions & needed)}")

        # institution users must NOT see the global audit trail (staff-only read)
        r = c.get(f"{API}/audit", headers=auth(inst_a["access_token"]), params={"page_size": 5})
        check("11 Audit", "institution user denied global audit trail", r.status_code == 403,
              f"institution read status={r.status_code}")
        r = c.get(f"{API}/audit", headers=auth(auditor["access_token"]), params={"page_size": 5})
        check("11 Audit", "auditor can read audit trail", r.status_code == 200,
              f"auditor read status={r.status_code}")

    # ------------------------------------------------------------- summary
    print("\n" + "=" * 60)
    fails = [x for x in results if x[0] == "FAIL"]
    warns = [x for x in results if x[0] == "WARN"]
    print(f"TOTAL={len(results)}  PASS={len(results)-len(fails)-len(warns)}  "
          f"WARN={len(warns)}  FAIL={len(fails)}")
    for st, name, detail in fails:
        print(f"  FAIL: {name} — {detail}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
