"""Discrepancy detection: extracted values vs submitted record + duplicate review.

Rules:
  * Extracted values are candidates (OCR can be wrong) — flags are raised for
    *review*, never auto-rejected and never treated as proof of fraud.
  * Flag creation is idempotent: an already-open flag for the same
    (document, field, type) is not duplicated.
  * Potential duplicates are flagged for a review queue — never auto-deleted.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from difflib import SequenceMatcher
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import enums as e
from ..models import DiscrepancyFlag, Document, ExtractedFdrField, FdrRecord

OPEN_STATES = e.OPEN_DISCREPANCY_STATUSES

SEVERITY_BY_TYPE = {
    e.DISC_MISSING_FIELD: e.SEVERITY_MEDIUM,
    e.DISC_AMOUNT_MISMATCH: e.SEVERITY_HIGH,
    e.DISC_DATE_MISMATCH: e.SEVERITY_MEDIUM,
    e.DISC_REFERENCE_MISMATCH: e.SEVERITY_HIGH,
    e.DISC_BANK_MISMATCH: e.SEVERITY_MEDIUM,
    e.DISC_INSTITUTION_MISMATCH: e.SEVERITY_MEDIUM,
    e.DISC_POTENTIAL_DUPLICATE: e.SEVERITY_MEDIUM,
    e.DISC_EXTRACTION_FAILED: e.SEVERITY_LOW,
}


def _norm_text(value: Optional[str]) -> str:
    return " ".join((value or "").strip().lower().split())


def _norm_reference(value: Optional[str]) -> str:
    return "".join(ch for ch in (value or "").upper() if ch.isalnum())


def _parse_iso_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def _parse_decimal(value: Optional[str]) -> Optional[Decimal]:
    if not value:
        return None
    try:
        return Decimal(str(value).replace(",", "").strip())
    except Exception:  # noqa: BLE001
        return None


def _existing_flag(
    db: Session,
    *,
    fdr_id: Optional[int],
    document_id: Optional[int],
    field_name: Optional[str],
    discrepancy_type: str,
) -> Optional[DiscrepancyFlag]:
    stmt = select(DiscrepancyFlag).where(
        DiscrepancyFlag.discrepancy_type == discrepancy_type,
        DiscrepancyFlag.status.in_(list(OPEN_STATES)),
    )
    if fdr_id is not None:
        stmt = stmt.where(DiscrepancyFlag.fdr_id == fdr_id)
    if document_id is not None:
        stmt = stmt.where(DiscrepancyFlag.document_id == document_id)
    if field_name:
        stmt = stmt.where(DiscrepancyFlag.field_name == field_name)
    else:
        stmt = stmt.where(DiscrepancyFlag.field_name.is_(None))
    return db.execute(stmt).scalars().first()


def create_flag(
    db: Session,
    *,
    fdr_id: Optional[int],
    document_id: Optional[int],
    field_name: Optional[str],
    submitted_value: Optional[str],
    extracted_value: Optional[str],
    discrepancy_type: str,
    explanation: str,
) -> tuple[bool, Optional[DiscrepancyFlag]]:
    """Create a flag unless an equivalent open one already exists."""
    existing = _existing_flag(
        db, fdr_id=fdr_id, document_id=document_id,
        field_name=field_name, discrepancy_type=discrepancy_type,
    )
    if existing is not None:
        return False, existing
    flag = DiscrepancyFlag(
        fdr_id=fdr_id,
        document_id=document_id,
        field_name=field_name,
        submitted_value=(submitted_value or "")[:512] or None,
        extracted_value=(extracted_value or "")[:512] or None,
        discrepancy_type=discrepancy_type,
        severity=SEVERITY_BY_TYPE.get(discrepancy_type, e.SEVERITY_MEDIUM),
        explanation=explanation[:2000],
        status=e.DISC_OPEN,
    )
    db.add(flag)
    db.flush()
    return True, flag


# ---------------------------------------------------------------------------
# Field comparison
# ---------------------------------------------------------------------------
def compare_extraction(db: Session, document: Document) -> list[DiscrepancyFlag]:
    """Compare a document's extracted fields against the linked FDR record."""
    from .notifications import notify_discrepancy

    flags: list[DiscrepancyFlag] = []
    if document.fdr_id is None:
        return flags
    fdr = db.get(FdrRecord, document.fdr_id)
    if fdr is None:
        return flags

    if document.extraction_status in (e.EXTRACTION_FAILED, e.EXTRACTION_MANUAL):
        created, flag = create_flag(
            db,
            fdr_id=fdr.id,
            document_id=document.id,
            field_name=None,
            submitted_value=None,
            extracted_value=document.extraction_error or document.extraction_status,
            discrepancy_type=e.DISC_EXTRACTION_FAILED,
            explanation=(
                "The document could not be machine-read "
                f"({document.extraction_error or document.extraction_status}). "
                "Values must be verified manually; no values were inferred."
            ),
        )
        if created and flag:
            flags.append(flag)

    fields = {
        f.field_name: f
        for f in db.execute(
            select(ExtractedFdrField).where(ExtractedFdrField.document_id == document.id)
        ).scalars().all()
    }
    if not fields:
        return flags

    institution_name = fdr.institution.institution_name if fdr.institution else None

    def _submitted(field: str) -> Optional[str]:
        if field == "bank_name":
            return fdr.bank_name
        if field == "fdr_reference_number":
            return fdr.fdr_reference_number
        if field == "deposit_amount":
            return f"{fdr.deposit_amount:.2f}"
        if field == "issue_date":
            return fdr.issue_date.isoformat() if fdr.issue_date else None
        if field == "maturity_date":
            return fdr.maturity_date.isoformat() if fdr.maturity_date else None
        if field == "institution_name":
            return institution_name
        return None

    for field_name in required_fields():
        row = fields.get(field_name)
        submitted = _submitted(field_name)
        if row is None or not row.extracted_value:
            created, flag = create_flag(
                db,
                fdr_id=fdr.id,
                document_id=document.id,
                field_name=field_name,
                submitted_value=submitted,
                extracted_value=None,
                discrepancy_type=e.DISC_MISSING_FIELD,
                explanation=(
                    f"Required field '{field_name}' could not be located in the document text. "
                    "It must be confirmed manually."
                ),
            )
            if created and flag:
                flags.append(flag)
            continue

        extracted_norm = row.normalized_value or row.extracted_value
        mismatch = False
        explanation = ""

        if field_name == "deposit_amount":
            left, right = _parse_decimal(submitted), _parse_decimal(extracted_norm)
            if left is not None and right is not None and left != right:
                mismatch = True
                explanation = (
                    f"Declared amount {left:,.2f} differs from the amount read from the "
                    f"document {right:,.2f} (difference {abs(left - right):,.2f}). "
                    "OCR can misread amounts — confirm against the original document."
                )
        elif field_name in ("issue_date", "maturity_date"):
            left, right = _parse_iso_date(submitted), _parse_iso_date(extracted_norm)
            if left is not None and right is not None and left != right:
                mismatch = True
                explanation = (
                    f"Declared {field_name.replace('_', ' ')} {left.isoformat()} differs from the "
                    f"document value {right.isoformat()}."
                )
        elif field_name == "fdr_reference_number":
            if submitted and extracted_norm and _norm_reference(submitted) != _norm_reference(extracted_norm):
                mismatch = True
                explanation = (
                    f"Declared reference '{submitted}' does not match the document reference "
                    f"'{extracted_norm}' (ignoring case/formatting)."
                )
        elif field_name == "bank_name":
            if submitted and extracted_norm:
                ratio = SequenceMatcher(None, _norm_text(submitted), _norm_text(extracted_norm)).ratio()
                if ratio < 0.6 and _norm_text(submitted) not in _norm_text(extracted_norm) \
                        and _norm_text(extracted_norm) not in _norm_text(submitted):
                    mismatch = True
                    explanation = (
                        f"Declared bank '{submitted}' appears inconsistent with the document's "
                        f"'{extracted_norm}'."
                    )
        elif field_name == "institution_name":
            if submitted and extracted_norm:
                ratio = SequenceMatcher(None, _norm_text(submitted), _norm_text(extracted_norm)).ratio()
                if ratio < 0.85:
                    mismatch = True
                    explanation = (
                        f"Institution on the document '{extracted_norm}' does not clearly match "
                        f"the registered institution '{submitted}'."
                    )

        if mismatch:
            dtype = {
                "deposit_amount": e.DISC_AMOUNT_MISMATCH,
                "issue_date": e.DISC_DATE_MISMATCH,
                "maturity_date": e.DISC_DATE_MISMATCH,
                "fdr_reference_number": e.DISC_REFERENCE_MISMATCH,
                "bank_name": e.DISC_BANK_MISMATCH,
                "institution_name": e.DISC_INSTITUTION_MISMATCH,
            }[field_name]
            created, flag = create_flag(
                db,
                fdr_id=fdr.id,
                document_id=document.id,
                field_name=field_name,
                submitted_value=submitted,
                extracted_value=extracted_norm,
                discrepancy_type=dtype,
                explanation=explanation,
            )
            if created and flag:
                flags.append(flag)

    if flags:
        fdr.verification_status = e.FDR_VERIFICATION_DISCREPANCY
        for flag in flags:
            notify_discrepancy(db, fdr, flag.discrepancy_type)
    else:
        fdr.verification_status = e.FDR_VERIFICATION_PENDING
        fdr.last_verified_at = None
    db.flush()
    return flags


def required_fields() -> tuple[str, ...]:
    return (
        "bank_name",
        "fdr_reference_number",
        "deposit_amount",
        "issue_date",
        "maturity_date",
        "institution_name",
    )


# ---------------------------------------------------------------------------
# Duplicate detection
# ---------------------------------------------------------------------------
def find_potential_duplicates(db: Session, fdr: FdrRecord) -> list[FdrRecord]:
    """Exact + similarity based duplicate candidates (excluding linked records)."""
    target_ref = _norm_reference(fdr.fdr_reference_number)
    if not target_ref:
        return []
    linked = {fdr.renewal_parent_id, fdr.replacement_fdr_id} - {None}
    candidates = db.execute(
        select(FdrRecord).where(FdrRecord.id != fdr.id)
    ).scalars().all()

    results: list[FdrRecord] = []
    for other in candidates:
        if other.id in linked:
            continue
        if other.renewal_parent_id == fdr.id or other.replacement_fdr_id == fdr.id:
            continue
        if other.lifecycle_status in (e.LIFECYCLE_ARCHIVED,):
            continue
        other_ref = _norm_reference(other.fdr_reference_number)
        same_bank = _norm_text(other.bank_name) == _norm_text(fdr.bank_name)
        exact = other_ref == target_ref
        similar = SequenceMatcher(None, other_ref, target_ref).ratio() >= 0.85
        if exact and (same_bank or other.institution_id == fdr.institution_id):
            results.append(other)
        elif similar and same_bank:
            results.append(other)
    return results


def flag_duplicates(db: Session, fdr: FdrRecord) -> list[DiscrepancyFlag]:
    """Raise idempotent 'potential_duplicate' flags for review (never deletion)."""
    flags: list[DiscrepancyFlag] = []
    for other in find_potential_duplicates(db, fdr):
        created, flag = create_flag(
            db,
            fdr_id=fdr.id,
            document_id=None,
            field_name="fdr_reference_number",
            submitted_value=fdr.fdr_reference_number,
            extracted_value=other.fdr_reference_number,
            discrepancy_type=e.DISC_POTENTIAL_DUPLICATE,
            explanation=(
                f"FDR #{other.id} ({other.bank_name}, institution #{other.institution_id}) has a "
                "matching or highly similar reference number. Review both records; nothing is "
                "merged or deleted automatically."
            ),
        )
        if created and flag:
            flags.append(flag)
    return flags


def refresh_fdr_verification(db: Session, fdr: FdrRecord) -> None:
    """Recompute verification_status from open flags (after resolve/dismiss)."""
    open_count = (
        db.execute(
            select(DiscrepancyFlag).where(
                DiscrepancyFlag.fdr_id == fdr.id,
                DiscrepancyFlag.status.in_(list(OPEN_STATES)),
            )
        )
        .scalars()
        .all()
    )
    if open_count:
        fdr.verification_status = e.FDR_VERIFICATION_DISCREPANCY
    else:
        reviewed = db.execute(
            select(DiscrepancyFlag).where(
                DiscrepancyFlag.fdr_id == fdr.id,
                DiscrepancyFlag.status.in_([e.DISC_RESOLVED, e.DISC_DISMISSED]),
            )
        ).scalars().all()
        if reviewed:
            fdr.verification_status = e.FDR_VERIFICATION_VERIFIED
            fdr.last_verified_at = datetime.utcnow()
        else:
            fdr.verification_status = e.FDR_VERIFICATION_PENDING
    db.flush()
