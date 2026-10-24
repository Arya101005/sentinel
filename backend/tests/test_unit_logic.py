"""Unit tests for pure business logic (no HTTP, no database).

Covers the spec's required areas: maturity calculations, matured non-applicant
detection, OCR parsing/normalisation, and workflow transition validation.
"""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app import enums as e
from app.services.extraction import (
    extract_amount,
    extract_bank_name,
    normalize_amount,
    parse_date,
    words_to_number,
)
from app.services.maturity import classify_fdr, days_until
from app.services.workflow import WorkflowError, validate_transition

TODAY = date(2026, 10, 24)


def _fdr(**kw):
    base = dict(
        lifecycle_status=e.LIFECYCLE_ACTIVE,
        maturity_date=None,
        eligibility_notes=None,
        id=1,
        fdr_reference_number="SBI/AIC/2023/0417",
        bank_name="State Bank of India",
        institution_id=1,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _app(status, ref="REL-1", updated=None):
    return SimpleNamespace(
        application_status=status,
        application_reference=ref,
        updated_at=updated or datetime_min(),
    )


def datetime_min():
    from datetime import datetime

    return datetime(2026, 1, 1)


# ---------------------------------------------------------------------------
# Maturity classification
# ---------------------------------------------------------------------------
class TestClassifyFdr:
    def test_matured_without_application(self):
        fdr = _fdr(maturity_date=TODAY - timedelta(days=45))
        cls = classify_fdr(fdr, [], TODAY)
        assert cls.category == e.CAT_MATURED_NO_APP
        assert cls.days_since_maturity == 45

    def test_upcoming_maturity_within_window(self):
        fdr = _fdr(maturity_date=TODAY + timedelta(days=30))
        cls = classify_fdr(fdr, [], TODAY)
        assert cls.category == e.CAT_UPCOMING
        assert cls.days_to_maturity == 30

    def test_active_not_near_maturity(self):
        fdr = _fdr(maturity_date=TODAY + timedelta(days=400))
        cls = classify_fdr(fdr, [], TODAY)
        assert cls.category == e.CAT_ACTIVE

    def test_open_application_decides_category(self):
        fdr = _fdr(maturity_date=TODAY - timedelta(days=10))
        cls = classify_fdr(fdr, [_app(e.WF_CLEARANCE)], TODAY)
        assert cls.category == e.CAT_APP_CLEARANCE  # not "matured_no_application"

    def test_completed_application_is_completed(self):
        fdr = _fdr(maturity_date=TODAY - timedelta(days=10))
        cls = classify_fdr(fdr, [_app(e.WF_COMPLETED)], TODAY)
        assert cls.category == e.CAT_COMPLETED

    def test_archived_and_replaced_are_excluded(self):
        for status in (e.LIFECYCLE_ARCHIVED, e.LIFECYCLE_REPLACED, e.LIFECYCLE_RENEWED):
            fdr = _fdr(lifecycle_status=status, maturity_date=TODAY - timedelta(days=5))
            cls = classify_fdr(fdr, [], TODAY)
            assert cls.category == e.CAT_EXCLUDED, status

    def test_renewal_pair_not_double_counted(self):
        """An old replaced record must be excluded even though it matured."""
        old = _fdr(lifecycle_status=e.LIFECYCLE_REPLACED, maturity_date=TODAY - timedelta(days=60))
        assert classify_fdr(old, [], TODAY).category == e.CAT_EXCLUDED

    def test_eligibility_note_yields_on_hold(self):
        fdr = _fdr(maturity_date=TODAY + timedelta(days=50), eligibility_notes="Court stay")
        cls = classify_fdr(fdr, [], TODAY)
        assert cls.category == e.CAT_ON_HOLD

    def test_missing_maturity_date_is_active_unknown(self):
        fdr = _fdr(maturity_date=None)
        cls = classify_fdr(fdr, [], TODAY)
        assert cls.category == e.CAT_ACTIVE
        assert cls.days_to_maturity is None

    def test_maturity_date_alone_is_not_eligibility(self):
        """A matured record is flagged for review, never 'eligible for release'."""
        fdr = _fdr(maturity_date=TODAY - timedelta(days=1))
        assert classify_fdr(fdr, [], TODAY).category == e.CAT_MATURED_NO_APP


class TestDaysUntil:
    def test_past_is_negative(self):
        assert days_until(TODAY - timedelta(days=3), TODAY) == -3

    def test_future_positive(self):
        assert days_until(TODAY + timedelta(days=7), TODAY) == 7

    def test_today_zero(self):
        assert days_until(TODAY, TODAY) == 0


# ---------------------------------------------------------------------------
# OCR parsing / normalisation
# ---------------------------------------------------------------------------
class TestAmountNormalisation:
    def test_indian_grouping_and_symbol(self):
        assert float(normalize_amount("₹1,234.56")) == pytest.approx(1234.56)

    def test_rupee_prefix(self):
        assert normalize_amount("Rs. 500000") == pytest.approx(500000)

    def test_zero_rejected(self):
        assert normalize_amount("0") is None

    def test_non_numeric_rejected(self):
        assert normalize_amount("abc") is None

    def test_sign_only_rejected(self):
        # Amounts parse as positive magnitudes; a bare sign has no digits.
        assert normalize_amount("-") is None
        assert normalize_amount("₹ -") is None


class TestExtractAmount:
    def test_labeled_amount(self):
        raw, value, conf = extract_amount("Deposit Amount: Rs. 410000.00")
        assert value == pytest.approx(410000.00)
        assert conf >= 0.9

    def test_labeled_with_grouping(self):
        raw, value, conf = extract_amount("Principal Amount: Rs. 750,000.00")
        assert value == pytest.approx(750000.00)

    def test_missing_amount_returns_none(self):
        assert extract_amount("No numbers here") is None


class TestWordsToNumber:
    def test_lakh(self):
        assert words_to_number("five lakh") == pytest.approx(500000)

    def test_thousand(self):
        assert words_to_number("ten thousand") == pytest.approx(10000)

    def test_no_words(self):
        assert words_to_number("nothing") is None


class TestParseDate:
    def test_dd_mm_yyyy(self):
        assert parse_date("15-04-2023") == date(2023, 4, 15)

    def test_slash_format(self):
        assert parse_date("15/04/2023") == date(2023, 4, 15)

    def test_iso_format(self):
        assert parse_date("2023-04-15") == date(2023, 4, 15)

    def test_month_name(self):
        assert parse_date("15 April 2023") == date(2023, 4, 15)

    def test_unparseable(self):
        assert parse_date("sometime soon") is None


class TestBankExtraction:
    def test_known_bank(self):
        name, conf = extract_bank_name("Receipt from State Bank of India, Amaravati")
        assert name == "State Bank of India"

    def test_unknown_text(self):
        assert extract_bank_name("no bank mentioned") is None


# ---------------------------------------------------------------------------
# Workflow transition validation
# ---------------------------------------------------------------------------
def _user(role=e.ROLE_OFFICER, competent=False, institution_id=None):
    return SimpleNamespace(
        role=role, is_competent_authority=competent, institution_id=institution_id, id=1
    )


def _application(status, institution_id=1, clearances=None):
    return SimpleNamespace(
        application_status=status,
        institution_id=institution_id,
        clearances=clearances or [],
        id=1,
        fdr=SimpleNamespace(release_application_status="none"),
    )


class TestValidateTransition:
    def test_invalid_transition_rejected(self):
        app = _application(e.WF_CLEARANCE)
        with pytest.raises(WorkflowError) as exc:
            validate_transition(None, _user(), app, e.WF_COMPLETED, reason=None)
        assert exc.value.status_code == 400

    def test_no_change_rejected(self):
        app = _application(e.WF_CLEARANCE)
        with pytest.raises(WorkflowError):
            validate_transition(None, _user(), app, e.WF_CLEARANCE, reason=None)

    def test_reason_required_for_rejection(self):
        app = _application(e.WF_SUBMITTED)
        with pytest.raises(WorkflowError) as exc:
            validate_transition(None, _user(), app, e.WF_REJECTED, reason=None)
        assert exc.value.detail["code"] == "reason_required"

    def test_clearance_gate_blocks_authority(self):
        pending = SimpleNamespace(
            clearance_type="finance_concurrence", status=e.CLEARANCE_PENDING
        )
        app = _application(e.WF_CLEARANCE, clearances=[pending])
        with pytest.raises(WorkflowError) as exc:
            validate_transition(None, _user(), app, e.WF_AUTHORITY, reason=None)
        assert exc.value.detail["code"] == "clearances_outstanding"

    def test_clearance_gate_allows_when_cleared(self):
        cleared = SimpleNamespace(clearance_type="finance_concurrence", status=e.CLEARANCE_CLEARED)
        auth = SimpleNamespace(
            clearance_type="competent_authority_approval", status=e.CLEARANCE_PENDING
        )
        app = _application(e.WF_CLEARANCE, clearances=[cleared, auth])
        # should not raise
        validate_transition(None, _user(), app, e.WF_AUTHORITY, reason=None)

    def test_authority_gate_requires_competent_authority(self):
        app = _application(e.WF_AUTHORITY)
        with pytest.raises(WorkflowError) as exc:
            validate_transition(None, _user(role=e.ROLE_OFFICER, competent=False), app,
                                e.WF_APPROVED, reason=None)
        assert exc.value.status_code == 403

    def test_competent_authority_can_approve(self):
        app = _application(e.WF_AUTHORITY)
        validate_transition(None, _user(role=e.ROLE_OFFICER, competent=True), app,
                            e.WF_APPROVED, reason=None)

    def test_admin_cannot_bypass_authority(self):
        """Even an admin who is not the competent authority cannot approve."""
        app = _application(e.WF_AUTHORITY)
        with pytest.raises(WorkflowError) as exc:
            validate_transition(None, _user(role=e.ROLE_ADMIN, competent=False), app,
                                e.WF_APPROVED, reason=None)
        assert exc.value.status_code == 403

    def test_institution_limited_to_submit(self):
        app = _application(e.WF_SUBMITTED, institution_id=5)
        inst = _user(role=e.ROLE_INSTITUTION, institution_id=5)
        with pytest.raises(WorkflowError) as exc:
            validate_transition(None, inst, app, e.WF_DOCUMENT_CHECKS, reason=None)
        assert exc.value.status_code == 403

    def test_institution_can_submit_draft(self):
        app = _application(e.WF_DRAFT, institution_id=5)
        inst = _user(role=e.ROLE_INSTITUTION, institution_id=5)
        validate_transition(None, inst, app, e.WF_SUBMITTED, reason=None)

    def test_auditor_read_only(self):
        app = _application(e.WF_DRAFT, institution_id=5)
        auditor = _user(role=e.ROLE_AUDITOR, institution_id=5)
        with pytest.raises(WorkflowError) as exc:
            validate_transition(None, auditor, app, e.WF_SUBMITTED, reason=None)
        assert exc.value.status_code == 403

    def test_unknown_status_rejected(self):
        app = _application(e.WF_SUBMITTED)
        with pytest.raises(WorkflowError):
            validate_transition(None, _user(), app, "not_a_state", reason=None)
