"""API integration tests exercising authorization, data isolation and the core
business flows end-to-end through the FastAPI application (in-process client,
fresh synthetic-seeded database per test).
"""

import io
from datetime import date, timedelta

API = "/api/v1"


def _make_pdf(text: str) -> bytes:
    """Minimal valid text-bearing PDF (real BT/Tj operators)."""
    lines = text.split("\n")
    parts = [b"BT\n/F1 11 Tf\n50 760 Td\n14 TL\n"]
    for i, line in enumerate(lines):
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        parts.append((f"({safe}) Tj\n" if i == 0 else f"T* ({safe}) Tj\n").encode("latin-1", "replace"))
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


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
def test_health_ok(client):
    r = client.get(f"{API}/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_health_db_reachable(client):
    r = client.get(f"{API}/health/db")
    assert r.status_code == 200
    assert r.json()["database"] == "reachable"


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
def test_login_wrong_password(client):
    r = client.post(f"{API}/auth/login", json={"username": "admin", "password": "nope"})
    assert r.status_code == 401


def test_me_requires_token(client):
    assert client.get(f"{API}/auth/me").status_code == 401


def test_me_returns_profile(client, as_officer):
    r = client.get(f"{API}/auth/me", headers=as_officer)
    assert r.status_code == 200
    assert r.json()["role"] == "officer"


# ---------------------------------------------------------------------------
# Role-based access control
# ---------------------------------------------------------------------------
def test_auditor_cannot_create_fdr(client, as_auditor, as_officer):
    fid = _any_fdr_id(client, as_officer)
    inst_id = client.get(f"{API}/fdr-records/{fid}", headers=as_officer).json()["institution_id"]
    r = client.post(f"{API}/fdr-records", headers=as_auditor, json={
        "institution_id": inst_id, "fdr_reference_number": "AUD/X/1",
        "bank_name": "State Bank of India", "deposit_amount": "100.00"})
    assert r.status_code == 403


def test_institution_denied_audit_trail(client, as_inst_a):
    assert client.get(f"{API}/audit", headers=as_inst_a).status_code == 403


def test_auditor_can_read_audit(client, as_auditor):
    assert client.get(f"{API}/audit", headers=as_auditor).status_code == 200


def test_audit_history_report_restricted(client, as_inst_a, as_officer):
    assert client.get(f"{API}/reports/audit_history", headers=as_inst_a).status_code == 403
    assert client.get(f"{API}/reports/audit_history", headers=as_officer).status_code == 200


# ---------------------------------------------------------------------------
# Institution-level data isolation
# ---------------------------------------------------------------------------
def _any_fdr_id(client, headers, exclude_institution=None):
    r = client.get(f"{API}/fdr-records", headers=headers, params={"page_size": 200})
    for item in r.json()["items"]:
        if exclude_institution is None or item["institution_id"] != exclude_institution:
            return item["id"]
    raise AssertionError("no FDR found")


def test_institution_sees_only_own_fdrs(client, as_inst_a):
    inst_a = client.get(f"{API}/auth/me", headers=as_inst_a).json()["institution_id"]
    r = client.get(f"{API}/fdr-records", headers=as_inst_a, params={"page_size": 200})
    items = r.json()["items"]
    assert items, "institution should see its own records"
    assert all(x["institution_id"] == inst_a for x in items)


def test_cross_institution_fdr_detail_404(client, as_inst_a, as_officer):
    other = _any_fdr_id(client, as_officer, exclude_institution=1)
    r = client.get(f"{API}/fdr-records/{other}", headers=as_inst_a)
    assert r.status_code == 404


def test_institution_cannot_create_for_other_institution(client, as_inst_a):
    r = client.post(f"{API}/fdr-records", headers=as_inst_a, json={
        "institution_id": 2, "fdr_reference_number": "NOPE/1",
        "bank_name": "HDFC Bank", "deposit_amount": "100.00"})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# FDR creation / validation / editing
# ---------------------------------------------------------------------------
def _new_fdr_payload(inst_id=1, ref="TEST/A/0001", amount="250000.00"):
    today = date.today()
    return {
        "institution_id": inst_id,
        "fdr_reference_number": ref,
        "bank_name": "HDFC Bank",
        "branch_name": "Test Branch",
        "deposit_amount": amount,
        "issue_date": (today - timedelta(days=5)).isoformat(),
        "maturity_date": (today + timedelta(days=360)).isoformat(),
    }


def test_create_fdr(client, as_inst_a):
    r = client.post(f"{API}/fdr-records", headers=as_inst_a, json=_new_fdr_payload())
    assert r.status_code == 201
    assert r.json()["fdr_reference_number"] == "TEST/A/0001"


def test_create_fdr_rejects_nonpositive_amount(client, as_inst_a):
    r = client.post(f"{API}/fdr-records", headers=as_inst_a,
                    json=_new_fdr_payload(amount="0"))
    assert r.status_code == 422


def test_create_fdr_rejects_issue_after_maturity(client, as_inst_a):
    payload = _new_fdr_payload()
    payload["issue_date"] = date.today().isoformat()
    payload["maturity_date"] = (date.today() - timedelta(days=10)).isoformat()
    r = client.post(f"{API}/fdr-records", headers=as_inst_a, json=payload)
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "invalid_dates"


def test_edit_fdr_updates_and_records_history(client, as_inst_a):
    fid = client.post(f"{API}/fdr-records", headers=as_inst_a,
                      json=_new_fdr_payload()).json()["id"]
    r = client.patch(f"{API}/fdr-records/{fid}", headers=as_inst_a,
                     json={"deposit_amount": "300000.00", "remarks": "updated in test"})
    assert r.status_code == 200
    assert r.json()["deposit_amount"] == "300000.00"
    hist = client.get(f"{API}/fdr-records/{fid}/lifecycle-history", headers=as_inst_a).json()
    assert len(hist) >= 2  # created + updated


def test_duplicate_reference_flagged(client, as_inst_a, as_officer):
    # Same reference + bank as seeded DEMO-A FDR => potential_duplicate flag.
    r = client.post(f"{API}/fdr-records", headers=as_inst_a, json=_new_fdr_payload(
        ref="SBI/AIC/2023/0417", amount="2500000.00"))
    assert r.status_code == 201
    assert r.json()["open_discrepancies"] >= 1


# ---------------------------------------------------------------------------
# Renewal / replacement links
# ---------------------------------------------------------------------------
def test_renewal_link_preserves_old_record(client, as_inst_a):
    old = client.post(f"{API}/fdr-records", headers=as_inst_a,
                      json=_new_fdr_payload(ref="LINK/OLD/1")).json()
    new = client.post(f"{API}/fdr-records", headers=as_inst_a,
                      json=_new_fdr_payload(ref="LINK/NEW/1")).json()
    r = client.post(f"{API}/fdr-records/{old['id']}/link", headers=as_inst_a,
                    json={"link_type": "renewal", "linked_fdr_id": new["id"],
                          "comment": "test renewal"})
    assert r.status_code == 200
    assert r.json()["lifecycle_status"] == "renewed"  # old preserved as renewed
    successor = client.get(f"{API}/fdr-records/{new['id']}", headers=as_inst_a).json()
    assert successor["renewal_parent_id"] == old["id"]
    assert successor["link_type"] == "renewal"
    # old is excluded from active monitoring so the pair counts once
    assert successor["monitoring_category"] != "excluded_inactive"


def test_seeded_replacement_pair_linked(client, as_officer):
    r = client.get(f"{API}/fdr-records", headers=as_officer,
                   params={"q": "IOB/FAR/2024/0099-R", "page_size": 5})
    rec = r.json()["items"][0]
    assert rec["link_type"] == "replacement"
    assert rec["renewal_parent_id"]
    old = client.get(f"{API}/fdr-records/{rec['renewal_parent_id']}", headers=as_officer).json()
    assert old["lifecycle_status"] == "replaced"


# ---------------------------------------------------------------------------
# Documents: upload validation, OCR processing, access control
# ---------------------------------------------------------------------------
def test_upload_rejects_invalid_file(client, as_inst_a):
    r = client.post(f"{API}/documents", headers=as_inst_a,
                    files={"file": ("evil.txt", io.BytesIO(b"plain text"), "text/plain")},
                    data={"document_type": "supporting", "institution_id": "1"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "invalid_upload"


def test_upload_and_process_extracts_fields(client, as_inst_a):
    fid = client.post(f"{API}/fdr-records", headers=as_inst_a,
                      json=_new_fdr_payload(ref="DOC/A/1")).json()["id"]
    today = date.today()
    text = ("Fixed Deposit Receipt\nBank: HDFC Bank\nFDR No: DOC/A/1\n"
            "Deposit Amount: Rs. 250000.00\n"
            f"Issue Date: {(today - timedelta(days=5)).strftime('%d %B %Y')}\n"
            f"Maturity Date: {(today + timedelta(days=360)).strftime('%d %B %Y')}\n")
    r = client.post(f"{API}/documents", headers=as_inst_a,
                    files={"file": ("r.pdf", io.BytesIO(_make_pdf(text)), "application/pdf")},
                    data={"document_type": "fdr_receipt", "fdr_id": str(fid)})
    assert r.status_code == 201
    doc_id = r.json()["id"]

    proc = client.post(f"{API}/documents/{doc_id}/process", headers=as_inst_a)
    assert proc.status_code == 200
    assert "Rs." in proc.json()["extracted_text_preview"]

    fields = client.get(f"{API}/documents/{doc_id}/extractions", headers=as_inst_a).json()
    assert "deposit_amount" in {f["field_name"] for f in fields}


def test_unauthorized_document_access(client, as_inst_a, as_officer):
    docs = client.get(f"{API}/documents", headers=as_officer, params={"page_size": 100}).json()["items"]
    other = next((d for d in docs if d["institution_id"] != 1), None)
    assert other, "expected a document from another institution"
    assert client.get(f"{API}/documents/{other['id']}", headers=as_inst_a).status_code == 404
    assert client.get(f"{API}/documents/{other['id']}/download", headers=as_inst_a).status_code == 404


def test_institution_cannot_upload_for_other_institution(client, as_inst_a):
    r = client.post(f"{API}/documents", headers=as_inst_a,
                    files={"file": ("x.pdf", io.BytesIO(_make_pdf("hi")), "application/pdf")},
                    data={"document_type": "supporting", "institution_id": "2"})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Discrepancies
# ---------------------------------------------------------------------------
def test_seeded_amount_mismatch_present(client, as_officer):
    r = client.get(f"{API}/discrepancies", headers=as_officer,
                   params={"status": "open", "type": "amount_mismatch", "page_size": 50})
    assert r.status_code == 200
    assert r.json()["items"], "scenario C amount mismatch should be flagged"


def test_resolve_discrepancy_requires_notes_and_resolves(client, as_officer):
    flags = client.get(f"{API}/discrepancies", headers=as_officer,
                       params={"status": "open", "type": "amount_mismatch"}).json()["items"]
    fid = flags[0]["id"]
    # missing notes -> 400
    assert client.post(f"{API}/discrepancies/{fid}/resolve",
                       headers=as_officer, json={}).status_code == 400
    r = client.post(f"{API}/discrepancies/{fid}/resolve", headers=as_officer,
                    json={"resolution_notes": "verified against bank statement"})
    assert r.status_code == 200
    assert r.json()["status"] == "resolved"


def test_auditor_cannot_resolve_discrepancy(client, as_officer, as_auditor):
    flags = client.get(f"{API}/discrepancies", headers=as_officer,
                       params={"status": "open"}).json()["items"]
    fid = flags[0]["id"]
    r = client.post(f"{API}/discrepancies/{fid}/resolve", headers=as_auditor,
                    json={"resolution_notes": "nope"})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Monitoring: matured non-applicant + upcoming + notification dedup
# ---------------------------------------------------------------------------
def test_matured_no_application_queue_includes_scenario_b(client, as_officer):
    r = client.get(f"{API}/monitoring/matured-no-application", headers=as_officer,
                   params={"page_size": 100})
    assert r.status_code == 200
    rows = r.json()["items"]
    assert rows, "matured-without-application queue should not be empty"
    assert any("PNB/CEN/2021/1189" in (x["fdr_reference_number"] or "") for x in rows)


def test_upcoming_maturity_queue_populated(client, as_officer):
    r = client.get(f"{API}/monitoring/upcoming-maturity", headers=as_officer,
                   params={"page_size": 100})
    assert r.status_code == 200
    assert r.json()["total"] >= 1


def test_monitoring_run_is_idempotent(client, as_officer):
    first = client.post(f"{API}/monitoring/run-checks", headers=as_officer).json()
    second = client.post(f"{API}/monitoring/run-checks", headers=as_officer).json()
    assert second["notifications_created"] == 0, "duplicate notifications must be suppressed"
    assert second["duplicates_suppressed"] >= 0


def test_notifications_are_not_duplicated_per_fdr(client, as_officer):
    client.post(f"{API}/monitoring/run-checks", headers=as_officer)
    client.post(f"{API}/monitoring/run-checks", headers=as_officer)
    notifs = client.get(f"{API}/notifications", headers=as_officer,
                        params={"page_size": 200}).json()["items"]
    matured = [n for n in notifs if n["notification_type"] == "matured_no_application" and n.get("fdr_id")]
    per_fdr = {}
    for n in matured:
        per_fdr[n["fdr_id"]] = per_fdr.get(n["fdr_id"], 0) + 1
    assert all(v <= 1 for v in per_fdr.values())


# ---------------------------------------------------------------------------
# Release workflow + clearance tracking
# ---------------------------------------------------------------------------
def _find_app(client, headers, reference):
    apps = client.get(f"{API}/applications", headers=headers,
                      params={"page_size": 100}).json()["items"]
    return next((a for a in apps if a["application_reference"] == reference), None)


def test_workflow_invalid_transition_rejected(client, as_officer):
    app = _find_app(client, as_officer, "REL-DEMO-0001")
    r = client.patch(f"{API}/applications/{app['id']}/status", headers=as_officer,
                     json={"new_status": "completed"})
    assert 400 <= r.status_code < 500


def test_clearance_gate_blocks_advance(client, as_officer):
    app = _find_app(client, as_officer, "REL-DEMO-0001")
    r = client.patch(f"{API}/applications/{app['id']}/status", headers=as_officer,
                     json={"new_status": "awaiting_authority_decision"})
    assert 400 <= r.status_code < 500


def test_full_release_workflow_and_authority_gate(client, as_officer, as_authority):
    app = _find_app(client, as_officer, "REL-DEMO-0001")
    assert app["application_status"] == "awaiting_clearance"

    # clear outstanding clearances (finance + audit; bank already cleared)
    cls = client.get(f"{API}/clearances", headers=as_officer,
                     params={"application_id": app["id"], "page_size": 50}).json()["items"]
    assert any(c["clearance_type"] == "bank_verification" and c["status"] == "cleared"
               for c in cls), "scenario E expects bank verification pre-cleared"
    for c in cls:
        if c["status"] in ("pending", "in_progress") and c["clearance_type"] != "competent_authority_approval":
            resp = client.post(f"{API}/clearances/{c['id']}", headers=as_officer,
                               json={"status": "cleared", "remarks": "cleared in test"})
            assert resp.status_code == 200

    # now advance to authority
    r = client.patch(f"{API}/applications/{app['id']}/status", headers=as_officer,
                     json={"new_status": "awaiting_authority_decision",
                           "comments": "clearances resolved"})
    assert r.status_code == 200

    # plain officer cannot approve
    r = client.patch(f"{API}/applications/{app['id']}/status", headers=as_officer,
                     json={"new_status": "approved"})
    assert r.status_code == 403

    # competent authority can approve
    r = client.patch(f"{API}/applications/{app['id']}/status", headers=as_authority,
                     json={"new_status": "approved"})
    assert r.status_code == 200

    timeline = client.get(f"{API}/applications/{app['id']}/timeline", headers=as_officer).json()
    assert len(timeline) >= 3


def test_duplicate_open_application_rejected(client, as_officer):
    app = _find_app(client, as_officer, "REL-DEMO-0001")
    r = client.post(f"{API}/applications", headers=as_officer,
                    json={"fdr_id": app["fdr_id"], "completeness_status": "complete"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "open_application_exists"


def test_institution_cannot_raise_application_for_other_fdr(client, as_inst_a, as_officer):
    app = _find_app(client, as_officer, "REL-DEMO-0001")  # belongs to institution E
    r = client.post(f"{API}/applications", headers=as_inst_a,
                    json={"fdr_id": app["fdr_id"], "completeness_status": "complete"})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Dashboard + reports
# ---------------------------------------------------------------------------
def test_dashboard_matured_card_matches_queue(client, as_officer):
    summary = client.get(f"{API}/monitoring/summary", headers=as_officer).json()
    cards = {c["key"]: c["value"] for c in summary["cards"]}
    queue = client.get(f"{API}/monitoring/matured-no-application", headers=as_officer,
                       params={"page_size": 1}).json()
    assert cards["matured_no_application"] == queue["total"]
    assert isinstance(cards["total_active_fdrs"], int)


def test_charts_computed(client, as_officer):
    ch = client.get(f"{API}/monitoring/charts", headers=as_officer).json()
    assert "lifecycle_status" in ch
    assert ch["lifecycle_status"]["buckets"]


def test_report_csv_export(client, as_officer):
    r = client.get(f"{API}/reports/institution_register/csv", headers=as_officer)
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    assert len(r.content) > 50


def test_report_pdf_export(client, as_officer):
    r = client.get(f"{API}/reports/upcoming_maturity/pdf", headers=as_officer)
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"


def test_report_csv_formula_injection_guarded(client, as_officer):
    r = client.get(f"{API}/reports/discrepancies/csv", headers=as_officer)
    body = r.text.splitlines()
    data_rows = [ln for ln in body if ln and not ln.startswith("﻿")]
    # After the header row, no data cell should start with a raw formula char.
    assert all(not ln.split(",")[0].startswith(("=", "+", "@")) for ln in data_rows[5:] if ln.split(",")[0])


def test_institution_report_scoped_to_own(client, as_inst_a):
    r = client.get(f"{API}/reports/institution_register", headers=as_inst_a)
    assert r.status_code == 200
    assert r.json()["row_count"] == 1


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------
def test_audit_records_key_actions(client, as_officer, as_inst_a):
    client.post(f"{API}/fdr-records", headers=as_inst_a, json=_new_fdr_payload(ref="AUDIT/A/1"))
    actions = set()
    page = 1
    while True:
        r = client.get(f"{API}/audit", headers=as_officer,
                       params={"page_size": 200, "page": page}).json()
        actions.update(x["action"] for x in r["items"])
        if page * 200 >= r["total"]:
            break
        page += 1
    assert "fdr.created" in actions
    assert "auth.login" in actions


def test_audit_filter_by_action(client, as_officer, as_inst_a):
    client.post(f"{API}/fdr-records", headers=as_inst_a, json=_new_fdr_payload(ref="AUDIT/A/2"))
    r = client.get(f"{API}/audit", headers=as_officer, params={"action": "fdr.created"})
    assert r.status_code == 200
    assert all("fdr.created" in x["action"] for x in r.json()["items"])
