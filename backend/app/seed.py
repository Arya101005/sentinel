"""Development-only seed: clearly-labelled SYNTHETIC demo data.

Run `python -m app.seed --reset` to wipe and recreate the demo dataset.
All seeded institutions, users, FDRs, documents and applications carry
``is_demo=True``. No real personal or financial data is used.

Demo scenarios (see README):
  A. Healthy record — College A, complete data, no mismatch.
  B. Matured FDR without application — College B.
  C. Amount mismatch — College C declares ₹500,000, document says otherwise.
  D. Upcoming maturity — College D within the alert window.
  E. Pending clearance — College E awaiting a required clearance.
  F. Replacement FDR — College F replaces an existing deposit.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from . import enums as e
from .database import SessionLocal, init_db, session_scope
from .models import (
    ApplicationEvent,
    ClearanceRecord,
    DiscrepancyFlag,
    Document,
    ExtractedFdrField,
    FdrLifecycleEvent,
    FdrRecord,
    Institution,
    NotificationEvent,
    NotificationPreference,
    ReleaseApplication,
    User,
)
from .security import hash_password
from .services.settings_service import ensure_default_settings

DEMO_PASSWORD = "Demo@Sentinel123"  # synthetic, development-only credentials


def _has_data(db) -> bool:
    return db.execute(select(Institution.id).limit(1)).scalar_one_or_none() is not None


def seed_if_empty(db) -> None:
    if _has_data(db):
        return
    build_seed(db)


def build_seed(db) -> dict:
    """Create the full synthetic dataset. Caller controls the transaction."""
    from .services.extraction import store_upload
    from .services.workflow import ensure_clearances

    today = date.today()
    now = datetime.utcnow()

    # --- Institutions -----------------------------------------------------
    institutions_spec = [
        ("DEMO-A", "Demo Institute of Technology, Amaravati", "engineering college", "South", "Amaravati"),
        ("DEMO-B", "Demo Polytechnic, Bhopal", "polytechnic", "Central", "Bhopal"),
        ("DEMO-C", "Demo College of Engineering, Coimbatore", "engineering college", "South", "Coimbatore"),
        ("DEMO-D", "Demo Institute of Management, Dhanbad", "management institute", "East", "Dhanbad"),
        ("DEMO-E", "Demo Women's Polytechnic, Ernakulam", "polytechnic", "South", "Ernakulam"),
        ("DEMO-F", " Demo School of Architecture, Faridabad", "architecture college", "North", "Faridabad"),
        ("DEMO-G", "Demo Rural Institute, Guwahati", "engineering college", "North-East", "Guwahati"),
        ("DEMO-H", "Demo Institute of Pharmacy, Hubballi", "pharmacy college", "South", "Hubballi"),
    ]
    institutions = []
    for code, name, itype, region, city in institutions_spec:
        inst = Institution(
            institution_code=code,
            institution_name=name.strip(),
            institution_type=itype,
            region=region,
            address=f"12 Demo Road, {city}, India (SYNTHETIC)",
            contact_email=f"{code.lower().replace('-', '')}@demo.example.com",
            contact_phone="+91-9000000000",
            status="active",
            is_demo=True,
        )
        db.add(inst)
        institutions.append(inst)
    db.flush()

    # --- Users ------------------------------------------------------------
    users: dict[str, User] = {}

    def add_user(key, username, name, email, role, inst=None, authority=False):
        u = User(
            username=username,
            display_name=name,
            email=email,
            role=role,
            institution_id=inst.id if inst else None,
            password_hash=hash_password(DEMO_PASSWORD),
            auth_provider="local",
            is_active=True,
            is_competent_authority=authority,
        )
        db.add(u)
        users[key] = u
        return u

    add_user("admin", "admin", "System Administrator (DEMO)", "admin@demo.example.com", e.ROLE_ADMIN)
    add_user("officer", "officer", "AICTE Officer Meera Nair (DEMO)", "officer@demo.example.com", e.ROLE_OFFICER)
    add_user(
        "authority",
        "authority",
        "Competent Authority R. Sharma (DEMO)",
        "authority@demo.example.com",
        e.ROLE_OFFICER,
        authority=True,
    )
    add_user("auditor", "auditor", "Read-Only Auditor (DEMO)", "auditor@demo.example.com", e.ROLE_AUDITOR)
    for idx, inst in enumerate(institutions):
        add_user(
            f"inst_{idx}",
            f"user{inst.institution_code.lower().replace('-', '')}",
            f"Institution User, {inst.institution_name}",
            f"contact{idx}@demo.example.com",
            e.ROLE_INSTITUTION,
            inst,
        )
    db.flush()

    def inst_user(idx: int) -> User:
        return users[f"inst_{idx}"]

    # --- FDR records ------------------------------------------------------
    fdrs: dict[str, FdrRecord] = {}

    def add_fdr(
        key,
        inst_idx,
        ref,
        bank,
        amount,
        issue_days_ago,
        maturity_days,  # relative to today; negative = in the past
        *,
        lifecycle=e.LIFECYCLE_ACTIVE,
        verification=e.FDR_VERIFICATION_UNVERIFIED,
        release_status=e.REL_RELEASE_NONE,
        notes=None,
        branch=None,
    ):
        rec = FdrRecord(
            institution_id=institutions[inst_idx].id,
            fdr_reference_number=ref,
            bank_name=bank,
            branch_name=branch,
            deposit_amount=Decimal(amount),
            currency="INR",
            issue_date=today - timedelta(days=issue_days_ago),
            maturity_date=today + timedelta(days=maturity_days),
            lifecycle_status=lifecycle,
            verification_status=verification,
            release_application_status=release_status,
            eligibility_notes=notes,
            created_by=users[f"inst_{inst_idx}"].id,
            is_demo=True,
        )
        db.add(rec)
        db.flush()
        db.add(
            FdrLifecycleEvent(
                fdr_id=rec.id,
                event_type="created",
                new_value="Seeded synthetic demo record (DEMO DATA)",
                actor_user_id=users["admin"].id,
                comment="Synthetic seed data — not a real deposit.",
            )
        )
        fdrs[key] = rec
        return rec

    # Scenario A — healthy record (College A): complete, no mismatch.
    add_fdr("A", 0, "SBI/AIC/2023/0417", "State Bank of India", "2500000.00",
            700, 400, verification=e.FDR_VERIFICATION_VERIFIED, branch="Amaravati Main")
    # Scenario B — matured FDR, no application (College B).
    add_fdr("B", 1, "PNB/CEN/2021/1189", "Punjab National Bank", "1800000.00",
            1460, -45, lifecycle=e.LIFECYCLE_MATURED, branch="Bhopal MP Nagar")
    # Scenario C — amount mismatch (College C): declares 500000.
    add_fdr("C", 2, "BOB/COI/2022/0733", "Bank of Baroda", "500000.00",
            900, 265, verification=e.FDR_VERIFICATION_DISCREPANCY, branch="Coimbatore Peelamedu")
    # Scenario D — upcoming maturity (College D): 18 days out.
    add_fdr("D", 3, "UBI/DHA/2023/0921", "Union Bank of India", "1200000.00",
            712, 18, verification=e.FDR_VERIFICATION_VERIFIED, branch="Dhanbad Joda Road")
    # Scenario E — pending clearance (College E).
    add_fdr("E", 4, "CAN/ERN/2022/0654", "Canara Bank", "3400000.00",
            850, 120, verification=e.FDR_VERIFICATION_VERIFIED,
            release_status=e.REL_RELEASE_AWAITING_CLEARANCE, branch="Ernakulam North")
    # Scenario F — replacement pair (College F): old deposit replaced by new.
    old_f = add_fdr("F_old", 5, "IOB/FAR/2020/0099", "Indian Overseas Bank", "900000.00",
                    1600, -60, lifecycle=e.LIFECYCLE_MATURED, branch="Faridabad Old Faridabad")
    new_f = add_fdr("F_new", 5, "IOB/FAR/2024/0099-R", "Indian Overseas Bank", "950000.00",
                    30, 1100, verification=e.FDR_VERIFICATION_VERIFIED, branch="Faridabad Old Faridabad")
    new_f.renewal_parent_id = old_f.id
    new_f.link_type = "replacement"
    old_f.lifecycle_status = e.LIFECYCLE_REPLACED
    old_f.replacement_fdr_id = new_f.id
    db.flush()

    # Additional volume for dashboards (active + near maturity + matured mix).
    banks = ["State Bank of India", "HDFC Bank", "ICICI Bank", "Bank of India", "Central Bank of India",
             "Axis Bank", "Indian Bank", "UCO Bank"]
    extra_days = [120, 240, 45, 500, 28, 61, 75, 300, -12, 160, 400, 90, 200, 33, -30, 550]
    for i, days in enumerate(extra_days):
        inst_idx = (i + 2) % len(institutions)
        add_fdr(
            f"X{i}",
            inst_idx,
            f"{banks[i % len(banks)].split()[0].upper()}/DEMO/{2021 + i % 4}/{1000 + i * 37}",
            banks[i % len(banks)],
            str(Decimal(250000 + i * 137500)),
            300 + i * 40,
            days,
            lifecycle=e.LIFECYCLE_MATURED if days < 0 else e.LIFECYCLE_ACTIVE,
            verification=e.FDR_VERIFICATION_VERIFIED if i % 3 == 0 else e.FDR_VERIFICATION_PENDING,
            branch="Demo Branch",
        )

    # --- Documents --------------------------------------------------------
    searchable_pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/"
        b"Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
    )

    def make_pdf(text: str) -> bytes:
        stream = text.encode("latin-1", "replace")
        objects = [
            b"<</Type/Catalog/Pages 2 0 R>>",
            b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
            b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R"
            b"/Resources<</Font<</F1 5 0 R>>>>>>",
            b"<</Length " + str(len(stream)).encode() + b">>stream\n" + stream + b"\nendstream",
            b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
        ]
        out = bytearray(b"%PDF-1.4\n")
        offsets = []
        for idx, body in enumerate(objects, start=1):
            offsets.append(len(out))
            out += f"{idx} 0 obj\n".encode() + body + b"\nendobj\n"
        xref_pos = len(out)
        out += f"xref\n0 {len(objects) + 1}\n".encode()
        out += b"0000000000 65535 f \n"
        for off in offsets:
            out += f"{off:010d} 00000 n \n".encode()
        out += (
            f"trailer\n<</Size {len(objects) + 1}/Root 1 0 R>>\nstartxref\n{xref_pos}\n%%EOF".encode()
        )
        return bytes(out)

    def attach_document(fdr: FdrRecord, doc_type: str, filename: str, text: str) -> Document:
        data = make_pdf(text)
        doc = store_upload(
            db,
            data=data,
            original_filename=filename,
            document_type=doc_type,
            institution_id=fdr.institution_id,
            fdr_id=fdr.id,
            uploaded_by=fdr.created_by,
            filename_prefix=f"demo_{fdr.id}",
        )
        doc.is_demo = True
        doc.extracted_text = text
        return doc

    # Scenario A document — matches the submitted record exactly.
    f_a = fdrs["A"]
    doc_a = attach_document(
        f_a,
        "fdr_receipt",
        "fdr_receipt_A.pdf",
        "Fixed Deposit Receipt\n"
        f"Bank: {f_a.bank_name}\nBranch: Amaravati Main\n"
        f"FDR No: {f_a.fdr_reference_number}\n"
        f"Institution: {institutions[0].institution_name}\n"
        f"Deposit Amount: Rs. {f_a.deposit_amount:,.2f}\n"
        f"Date of Issue: {f_a.issue_date.strftime('%d %B %Y')}\n"
        f"Maturity Date: {f_a.maturity_date.strftime('%d %B %Y')}\n",
    )
    # Scenario C document — amount deliberately different (₹750,000 vs declared ₹500,000).
    f_c = fdrs["C"]
    doc_c = attach_document(
        f_c,
        "fdr_receipt",
        "fdr_receipt_C.pdf",
        "TERM DEPOSIT RECEIPT\n"
        f"Bank of Baroda, Coimbatore Peelamedu\n"
        f"Receipt No: {f_c.fdr_reference_number}\n"
        f"Institution: {institutions[2].institution_name}\n"
        "Principal Amount: Rs. 750000.00\n"
        f"Date of Deposit: {f_c.issue_date.strftime('%d/%m/%Y')}\n"
        f"Maturity Date: {f_c.maturity_date.strftime('%d/%m/%Y')}\n",
    )
    # Scenario D document — matches.
    f_d = fdrs["D"]
    doc_d = attach_document(
        f_d,
        "fdr_receipt",
        "fdr_receipt_D.pdf",
        "Certificate of Deposit\n"
        f"Union Bank of India, Dhanbad Joda Road\n"
        f"Fixed Deposit No: {f_d.fdr_reference_number}\n"
        f"Institution: {institutions[3].institution_name}\n"
        f"Amount: Rs. {f_d.deposit_amount:,.2f}\n"
        f"Issue Date: {f_d.issue_date.strftime('%d-%m-%Y')}\n"
        f"Maturity Date: {f_d.maturity_date.strftime('%d-%m-%Y')}\n",
    )
    # Scenario B — scanned/image-style document placeholder (metadata only, no text).
    f_b = fdrs["B"]
    doc_b = attach_document(f_b, "supporting", "fdr_receipt_B.pdf", "")
    doc_b.extraction_status = e.EXTRACTION_MANUAL
    doc_b.extraction_error = (
        "Synthetic seed document has no extractable text; marked for manual review (DEMO)."
    )

    # --- Extraction rows + discrepancy for scenario C ----------------------
    def add_field(doc, name, raw, normalized, confidence, status):
        db.add(
            ExtractedFdrField(
                document_id=doc.id,
                field_name=name,
                extracted_value=raw,
                normalized_value=normalized,
                confidence_score=confidence,
                review_status=status,
            )
        )

    add_field(doc_a, "bank_name", f_a.bank_name, f_a.bank_name, 0.95, e.FIELD_REVIEW_CONFIRMED)
    add_field(doc_a, "fdr_reference_number", f_a.fdr_reference_number, f_a.fdr_reference_number, 0.92,
              e.FIELD_REVIEW_CONFIRMED)
    add_field(doc_a, "deposit_amount", "2500000.00", "2500000.00", 0.93, e.FIELD_REVIEW_CONFIRMED)
    add_field(doc_a, "issue_date", f_a.issue_date.isoformat(), f_a.issue_date.isoformat(), 0.93,
              e.FIELD_REVIEW_CONFIRMED)
    add_field(doc_a, "maturity_date", f_a.maturity_date.isoformat(), f_a.maturity_date.isoformat(), 0.93,
              e.FIELD_REVIEW_CONFIRMED)
    add_field(doc_a, "institution_name", institutions[0].institution_name, institutions[0].institution_name,
              0.9, e.FIELD_REVIEW_CONFIRMED)

    add_field(doc_c, "bank_name", "Bank of Baroda", "Bank of Baroda", 0.95, e.FIELD_REVIEW_PENDING)
    add_field(doc_c, "fdr_reference_number", f_c.fdr_reference_number, f_c.fdr_reference_number, 0.92,
              e.FIELD_REVIEW_PENDING)
    add_field(doc_c, "deposit_amount", "750000.00", "750000.00", 0.93, e.FIELD_REVIEW_PENDING)
    add_field(doc_c, "issue_date", f_c.issue_date.isoformat(), f_c.issue_date.isoformat(), 0.9, e.FIELD_REVIEW_PENDING)
    add_field(doc_c, "maturity_date", f_c.maturity_date.isoformat(), f_c.maturity_date.isoformat(), 0.9,
              e.FIELD_REVIEW_PENDING)
    add_field(doc_c, "institution_name", institutions[2].institution_name, institutions[2].institution_name,
              0.9, e.FIELD_REVIEW_PENDING)

    db.add(
        DiscrepancyFlag(
            fdr_id=f_c.id,
            document_id=doc_c.id,
            field_name="deposit_amount",
            submitted_value="500000.00",
            extracted_value="750000.00",
            discrepancy_type=e.DISC_AMOUNT_MISMATCH,
            severity=e.SEVERITY_HIGH,
            explanation=(
                "Declared amount ₹500,000.00 differs from the amount read from the uploaded "
                "receipt ₹750,000.00 (difference ₹250,000.00). OCR can misread amounts — "
                "confirm against the original document before acting."
            ),
            status=e.DISC_OPEN,
            assigned_to=users["officer"].id,
        )
    )

    # A low-confidence missing-field flag on the unreadable Scenario B document.
    db.add(
        DiscrepancyFlag(
            fdr_id=f_b.id,
            document_id=doc_b.id,
            field_name=None,
            submitted_value=None,
            extracted_value=e.EXTRACTION_MANUAL,
            discrepancy_type=e.DISC_EXTRACTION_FAILED,
            severity=e.SEVERITY_LOW,
            explanation="Seeded document contains no machine-readable text; manual verification required.",
            status=e.DISC_OPEN,
        )
    )

    # --- Applications -----------------------------------------------------
    # Scenario E — application awaiting required clearance.
    app_e = ReleaseApplication(
        application_reference="REL-DEMO-0001",
        institution_id=institutions[4].id,
        fdr_id=fdrs["E"].id,
        submitted_at=now - timedelta(days=21),
        application_status=e.WF_CLEARANCE,
        completeness_status="complete",
        assigned_officer_id=users["officer"].id,
        pending_reason="Awaiting finance concurrence and audit clearance.",
        current_stage_started_at=now - timedelta(days=14),
        last_action_at=now - timedelta(days=3),
        is_demo=True,
    )
    db.add(app_e)
    db.flush()
    ensure_clearances(db, app_e)
    # Bank verification already cleared; finance concurrence pending beyond threshold (14 days).
    for clearance in app_e.clearances:
        if clearance.clearance_type == "bank_verification":
            clearance.status = e.CLEARANCE_CLEARED
            clearance.completed_at = now - timedelta(days=8)
            clearance.remarks = "Confirmed by deposit-holder bank (SYNTHETIC)."
    db.add(
        ApplicationEvent(
            application_id=app_e.id,
            previous_status=e.WF_OFFICER_VERIFICATION,
            new_status=e.WF_CLEARANCE,
            event_type="status_change",
            actor_user_id=users["officer"].id,
            comments="Document checks complete; routed for required clearances.",
        )
    )
    fdrs["E"].release_application_status = e.REL_RELEASE_AWAITING_CLEARANCE

    # Scenario D — application already submitted (matured-adjacent case).
    app_d = ReleaseApplication(
        application_reference="REL-DEMO-0002",
        institution_id=institutions[3].id,
        fdr_id=fdrs["D"].id,
        submitted_at=now - timedelta(days=5),
        application_status=e.WF_SUBMITTED,
        completeness_status="complete",
        assigned_officer_id=None,
        pending_reason=None,
        current_stage_started_at=now - timedelta(days=5),
        last_action_at=now - timedelta(days=5),
        is_demo=True,
    )
    db.add(app_d)
    db.flush()
    db.add(
        ApplicationEvent(
            application_id=app_d.id,
            previous_status=None,
            new_status=e.WF_SUBMITTED,
            event_type="created",
            actor_user_id=users["inst_3"].id,
            comments="Early submission ahead of maturity (SYNTHETIC).",
        )
    )
    fdrs["D"].release_application_status = e.REL_RELEASE_SUBMITTED

    # One completed case for analytics.
    f_x = fdrs["X3"]
    app_done = ReleaseApplication(
        application_reference="REL-DEMO-0003",
        institution_id=f_x.institution_id,
        fdr_id=f_x.id,
        submitted_at=now - timedelta(days=40),
        application_status=e.WF_COMPLETED,
        completeness_status="complete",
        assigned_officer_id=users["officer"].id,
        current_stage_started_at=now - timedelta(days=6),
        last_action_at=now - timedelta(days=6),
        is_demo=True,
    )
    db.add(app_done)
    db.flush()
    db.add(
        ApplicationEvent(
            application_id=app_done.id,
            previous_status=e.WF_RELEASE_PROCESSING,
            new_status=e.WF_COMPLETED,
            event_type="status_change",
            actor_user_id=users["authority"].id,
            comments="Release processed and closed (SYNTHETIC).",
        )
    )
    f_x.release_application_status = e.REL_RELEASE_COMPLETED
    f_x.lifecycle_status = e.LIFECYCLE_RELEASED

    # --- Notification preferences (default all-on for institution users) ---
    for u in users.values():
        if u.role == e.ROLE_INSTITUTION:
            for ntype in ("maturity_upcoming", "matured_no_application", "discrepancy_flagged"):
                db.add(
                    NotificationPreference(user_id=u.id, event_type=ntype, enabled=True, channel="in_app")
                )

    # --- A few in-app notifications so the centre is not empty -------------
    db.add(
        NotificationEvent(
            recipient_user_id=users["officer"].id,
            institution_id=institutions[2].id,
            fdr_id=fdrs["C"].id,
            notification_type="discrepancy_flagged",
            channel=e.CHANNEL_IN_APP,
            title=f"Amount mismatch flagged: FDR {fdrs['C'].fdr_reference_number}",
            message=(
                "College C declared ₹500,000 while the uploaded receipt shows ₹750,000. "
                "Review the extracted values (DEMO DATA)."
            ),
            sent_at=now,
            delivery_status=e.DELIVERY_SENT,
            deduplication_key=f"seed:discrepancy:{fdrs['C'].id}",
        )
    )
    db.add(
        NotificationEvent(
            recipient_user_id=users["officer"].id,
            institution_id=institutions[1].id,
            fdr_id=fdrs["B"].id,
            notification_type="matured_no_application",
            channel=e.CHANNEL_IN_APP,
            title=f"Action needed: FDR {fdrs['B'].fdr_reference_number} matured without application",
            message=(
                "College B's deposit matured 45 days ago and no release application is recorded "
                "in FDR Sentinel. Review trigger only (DEMO DATA)."
            ),
            sent_at=now,
            delivery_status=e.DELIVERY_SENT,
            deduplication_key=f"seed:matured:{fdrs['B'].id}",
        )
    )

    db.flush()
    return {
        "institutions": len(institutions),
        "users": len(users),
        "fdrs": len(fdrs),
        "applications": 3,
        "password": DEMO_PASSWORD,
    }


def reset_and_seed() -> None:
    """Drop everything, recreate schema and seed (development only)."""
    from .database import Base, engine

    init_db()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with session_scope() as db:
        ensure_default_settings(db)
        stats = build_seed(db)
    print("Seeded synthetic DEMO data:", stats)


if __name__ == "__main__":  # pragma: no cover
    parser = argparse.ArgumentParser(description="Seed FDR Sentinel demo data")
    parser.add_argument("--reset", action="store_true", help="Drop and recreate all tables first")
    args = parser.parse_args()
    if args.reset:
        reset_and_seed()
    else:
        with session_scope() as db:
            ensure_default_settings(db)
            if _has_data(db):
                print("Database already contains data; use --reset to reseed.")
            else:
                print("Seeded:", build_seed(db))
