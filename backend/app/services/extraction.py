"""AI-assisted document intelligence pipeline (Module B).

Stages: validate -> store privately -> extract text (embedded PDF text, OCR
fallback) -> parse/normalise FDR fields -> compare with the submitted record
(comparison lives in ``discrepancy.py``).

Important honesty rules encoded here:
  * File type is decided by magic bytes, never by extension.
  * A field that cannot be confidently extracted is marked for manual review
    instead of being invented.
  * OCR output is treated as a *candidate value*, not proof of authenticity.
  * If no OCR engine is installed, processing degrades to
    ``manual_review_required`` with an explicit reason — it never crashes.
"""

from __future__ import annotations

import hashlib
import io
import re
import unicodedata
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import enums as e
from ..config import settings
from ..models import Document, ExtractedFdrField, Institution

# --- Magic byte validation ---------------------------------------------------
PDF_MAGIC = b"%PDF-"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"

MIME_PDF = "application/pdf"
MIME_PNG = "image/png"
MIME_JPEG = "image/jpeg"


def sniff_mime(data: bytes) -> Optional[str]:
    if data.startswith(PDF_MAGIC):
        return MIME_PDF
    if data.startswith(PNG_MAGIC):
        return MIME_PNG
    if data.startswith(JPEG_MAGIC):
        return MIME_JPEG
    return None


def safe_filename(name: str) -> str:
    """Strip any path components / traversal sequences (defence in depth)."""
    name = unicodedata.normalize("NFKC", name or "file")
    name = name.replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip(" .")
    name = re.sub(r"\.{2,}", ".", name)  # no ".."
    return (name or "document")[:180]


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --- OCR availability --------------------------------------------------------
def ocr_available() -> bool:
    if settings.ocr_engine == "none":
        return False
    try:
        import pytesseract  # noqa: F401
        from PIL import Image  # noqa: F401

        pytesseract.get_tesseract_version()
        return True
    except Exception:  # noqa: BLE001
        return False


OCR_UNAVAILABLE_REASON = (
    "OCR engine unavailable: the Tesseract binary (and pytesseract) must be installed "
    "and on PATH for scanned/image documents. Marked for manual review."
)


# --- Text extraction ---------------------------------------------------------
def extract_pdf_text(data: bytes) -> str:
    import fitz  # PyMuPDF

    with fitz.open(stream=data, filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


def extract_image_text(data: bytes, mime: str) -> str:
    import pytesseract
    from PIL import Image

    image = Image.open(io.BytesIO(data))
    return pytesseract.image_to_string(image, lang=settings.ocr_languages)


def extract_scanned_pdf_text(data: bytes) -> str:
    """Render each page of a textless PDF to an image and OCR it."""
    import fitz
    import pytesseract
    from PIL import Image

    chunks: list[str] = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        for page in doc:
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
            image = Image.open(io.BytesIO(pix.tobytes("png")))
            chunks.append(pytesseract.image_to_string(image, lang=settings.ocr_languages))
    return "\n".join(chunks)


def extract_text(data: bytes, mime: str) -> tuple[str, str, Optional[str]]:
    """Return (text, extraction_status, error_message)."""
    if mime == MIME_PDF:
        try:
            text = extract_pdf_text(data)
        except Exception as exc:  # noqa: BLE001
            return "", e.EXTRACTION_FAILED, f"PDF parsing failed: {type(exc).__name__}"
        if len(text.strip()) >= settings.min_embedded_text_chars:
            return text, e.EXTRACTION_EXTRACTED, None
        # Treat as a scanned PDF.
        if not ocr_available():
            return text, e.EXTRACTION_MANUAL, OCR_UNAVAILABLE_REASON
        try:
            ocr_text = extract_scanned_pdf_text(data)
            status = e.EXTRACTION_EXTRACTED if len(ocr_text.strip()) >= settings.min_embedded_text_chars else e.EXTRACTION_PARTIAL
            return ocr_text, status, None if status == e.EXTRACTION_EXTRACTED else "OCR returned little or no text."
        except Exception as exc:  # noqa: BLE001
            return text, e.EXTRACTION_MANUAL, f"OCR failed: {type(exc).__name__}"

    if mime in (MIME_PNG, MIME_JPEG):
        if not ocr_available():
            return "", e.EXTRACTION_MANUAL, OCR_UNAVAILABLE_REASON
        try:
            text = extract_image_text(data, mime)
            status = e.EXTRACTION_EXTRACTED if len(text.strip()) >= settings.min_embedded_text_chars else e.EXTRACTION_PARTIAL
            return text, status, None if status == e.EXTRACTION_EXTRACTED else "OCR returned little or no text."
        except Exception as exc:  # noqa: BLE001
            return "", e.EXTRACTION_MANUAL, f"OCR failed: {type(exc).__name__}"

    return "", e.EXTRACTION_FAILED, f"Unsupported file type: {mime}"


# ---------------------------------------------------------------------------
# Field parsing / normalisation
# ---------------------------------------------------------------------------
BANK_NAMES = [
    "State Bank of India", "Punjab National Bank", "Bank of Baroda", "Canara Bank",
    "Union Bank of India", "Bank of India", "Central Bank of India", "Indian Bank",
    "UCO Bank", "Bank of Maharashtra", "Indian Overseas Bank", "Punjab & Sind Bank",
    "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank", "IndusInd Bank",
    "IDFC First Bank", "Federal Bank", "South Indian Bank", "Karur Vysya Bank",
    "Tamilnad Mercantile Bank", "City Union Bank", "DCB Bank", "Bandhan Bank",
    "Jammu and Kashmir Bank", "AU Small Finance Bank", "Equitas Small Finance Bank",
    "Fino Payments Bank", "Airtel Payments Bank", "Jio Payments Bank",
]

REQUIRED_FIELDS = (
    "bank_name",
    "fdr_reference_number",
    "deposit_amount",
    "issue_date",
    "maturity_date",
    "institution_name",
)

DATE_LABEL_ISSUE = r"(?:date of issue|issue date|deposit date|date of deposit|commencement date|opening date)"
DATE_LABEL_MATURITY = r"(?:maturity date|date of maturity|due date|payable on|withdrawal date|closing date)"
AMOUNT_LABEL = r"(?:deposit amount|principal amount|amount of deposit|term deposit amount|sum deposited)"

_WORD_NUM = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
_WORD_MULT = {"hundred": 100, "thousand": 1_000, "lakh": 100_000, "lac": 100_000, "lakhs": 100_000, "crore": 10_000_000, "crores": 10_000_000}


def words_to_number(text: str) -> Optional[Decimal]:
    """Parse Indian-style number words: 'five lakh only', 'ten thousand'."""
    tokens = re.findall(r"[a-z]+", text.lower())
    total = 0
    current = 0
    seen = False
    for token in tokens:
        if token in _WORD_NUM:
            current += _WORD_NUM[token]
            seen = True
        elif token in _WORD_MULT:
            mult = _WORD_MULT[token]
            current = (current or 1) * mult
            total += current
            current = 0
            seen = True
        elif token == "and":
            continue
        else:
            break
    if not seen:
        return None
    total += current
    return Decimal(total) if total > 0 else None


def normalize_amount(raw: str) -> Optional[Decimal]:
    raw = raw.replace(",", "").replace("₹", "").replace("Rs.", "").replace("Rs", "").strip()
    raw = re.sub(r"[^0-9.]", "", raw)
    if not raw:
        return None
    try:
        value = Decimal(raw)
    except InvalidOperation:
        return None
    if value <= 0:
        return None
    return value


_DATE_PATTERNS = (
    re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b"),          # 15-04-2023 / 15/04/2023
    re.compile(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b"),          # 2023-04-15
    re.compile(r"\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b"),        # 15 April 2023
)


def parse_date(raw: str) -> Optional[date]:
    """Parse the supported date formats (Indian DD/MM/YYYY convention default)."""
    raw = raw.strip()
    for idx, pattern in enumerate(_DATE_PATTERNS):
        m = pattern.search(raw)
        if not m:
            continue
        try:
            if idx == 1:            # YYYY-MM-DD
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            elif idx == 2:          # 15 April 2023
                d, mo, y = int(m.group(1)), _month_from_name(m.group(2)), int(m.group(3))
            else:                   # 15-04-2023 (DD-MM-YYYY)
                d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if y < 100:
                y += 2000
            return date(y, mo, d)
        except (ValueError, TypeError):
            continue
    return None


def _month_from_name(name: str) -> int:
    name = name[:3].lower()
    months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    return months.index(name) + 1


def _find_labeled_date(text: str, label_pattern: str) -> Optional[tuple[str, date]]:
    m = re.search(label_pattern + r"[\s:#]*([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})", text, re.I)
    if m:
        parsed = parse_date(m.group(1))
        if parsed:
            return m.group(1), parsed
    return None


def extract_bank_name(text: str) -> Optional[tuple[str, float]]:
    lowered = text.lower()
    for bank in BANK_NAMES:
        if bank.lower() in lowered:
            return bank, 0.95
    m = re.search(r"(?:bank|banking)\s+(?:of|for)?\s*([A-Z][A-Za-z& ]{3,40})", text)
    if m:
        candidate = m.group(0).strip()
        if len(candidate) >= 6:
            return candidate.title(), 0.55
    return None


def extract_reference(text: str) -> Optional[tuple[str, float]]:
    patterns = [
        r"(?:fdr|fd|fixed deposit|term deposit|deposit)\s*(?:receipt|certificate)?\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-/.]{3,40})",
        r"(?:receipt|reference|certificate)\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-/.]{3,40})",
        r"(?:account|a/c|acct)\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-/.]{3,40})",
    ]
    for idx, pattern in enumerate(patterns):
        m = re.search(pattern, text, re.I)
        if m:
            return m.group(1).strip(), 0.92 - idx * 0.08
    # Fallback: any standalone token that looks like a deposit reference.
    m = re.search(r"\b([A-Z]{2,6}[-/]\d{3,12}[-/]\d{2,6})\b", text)
    if m:
        return m.group(1), 0.55
    return None


def extract_amount(text: str) -> Optional[tuple[str, Decimal, float]]:
    # 1) Labeled numeric amount
    m = re.search(AMOUNT_LABEL + r"[\s:of]*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)", text, re.I)
    if m:
        value = normalize_amount(m.group(1))
        if value:
            return m.group(1), value, 0.93
    # 2) Labeled word amount
    m = re.search(AMOUNT_LABEL + r"[\s:of]*rupees\s+([a-z ,]+?)\s*(?:only|/-)", text, re.I)
    if m:
        value = words_to_number(m.group(1))
        if value:
            return m.group(1).strip(), value, 0.9
    # 3) Any currency-marked amount
    m = re.search(r"(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:/-|only)?", text, re.I)
    if m:
        value = normalize_amount(m.group(1))
        if value:
            return m.group(1), value, 0.75
    # 4) "Rupees ... only"
    m = re.search(r"rupees\s+([a-z ,]+?)\s*(?:only|/-)", text, re.I)
    if m:
        value = words_to_number(m.group(1))
        if value:
            return m.group(1).strip(), value, 0.7
    # 5) Largest plain number (weak signal — marked for review)
    candidates = re.findall(r"\b\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?\b", text)
    if candidates:
        best = max(candidates, key=lambda c: len(c))
        value = normalize_amount(best)
        if value:
            return best, value, 0.5
    return None


def extract_dates(text: str) -> tuple[Optional[tuple[str, date, float]], Optional[tuple[str, date, float]]]:
    """Return ((raw, issue, conf), (raw, maturity, conf))."""
    issue = maturity = None
    found = _find_labeled_date(text, DATE_LABEL_ISSUE)
    if found:
        issue = (found[0], found[1], 0.93)
    found = _find_labeled_date(text, DATE_LABEL_MATURITY)
    if found:
        maturity = (found[0], found[1], 0.93)

    # Fallback: two unlabeled dates in order => issue then maturity.
    if issue is None or maturity is None:
        matches: list[date] = []
        for pattern in _DATE_PATTERNS:
            for m in pattern.finditer(text):
                parsed = parse_date(m.group(0))
                if parsed:
                    matches.append(parsed)
        uniq = sorted(set(matches))
        if len(uniq) >= 2:
            if issue is None:
                issue = (uniq[0].isoformat(), uniq[0], 0.6)
            if maturity is None and len(uniq) >= 2:
                candidate = uniq[-1]
                if issue and candidate <= issue[1]:
                    later = [d for d in uniq if d > issue[1]]
                    candidate = later[0] if later else candidate
                maturity = (candidate.isoformat(), candidate, 0.6)
        elif len(uniq) == 1 and issue is None and maturity is None:
            issue = (uniq[0].isoformat(), uniq[0], 0.5)
    return issue, maturity


def extract_institution(text: str, institutions: list[Institution]) -> Optional[tuple[str, float]]:
    lowered = text.lower()
    best: Optional[tuple[str, float]] = None
    for inst in institutions:
        name = inst.institution_name.strip()
        if name and name.lower() in lowered:
            return name, 0.9
        code = (inst.institution_code or "").strip()
        if code and re.search(rf"\b{re.escape(code)}\b", text, re.I):
            return name, 0.8
    # Fuzzy fallback against generic college phrasing.
    m = re.search(r"([A-Z][A-Za-z&'. ]{4,60}(?:College|Institute|University|Polytechnic)[A-Za-z&'. ]{0,30})", text)
    if m:
        candidate = m.group(1).strip()
        for inst in institutions:
            score = SequenceMatcher(None, candidate.lower(), inst.institution_name.lower()).ratio()
            if score >= 0.8:
                return inst.institution_name, 0.7
        return candidate, 0.5
    return best


def parse_fdr_fields(text: str, institutions: list[Institution]) -> dict[str, dict[str, Any]]:
    """Run every field strategy over extracted text.

    Returns {field_name: {"raw": str|None, "normalized": str|None, "confidence": float}}
    Missing required fields are present with raw=None so reviewers see them.
    """
    out: dict[str, dict[str, Any]] = {}

    bank = extract_bank_name(text)
    out["bank_name"] = {
        "raw": bank[0] if bank else None,
        "normalized": bank[0] if bank else None,
        "confidence": bank[1] if bank else 0.0,
    }

    ref = extract_reference(text)
    out["fdr_reference_number"] = {
        "raw": ref[0] if ref else None,
        "normalized": ref[0].upper().replace(" ", "") if ref else None,
        "confidence": ref[1] if ref else 0.0,
    }

    amount = extract_amount(text)
    out["deposit_amount"] = {
        "raw": amount[0] if amount else None,
        "normalized": f"{amount[1]:.2f}" if amount else None,
        "confidence": amount[2] if amount else 0.0,
    }

    issue, maturity = extract_dates(text)
    out["issue_date"] = {
        "raw": issue[0] if issue else None,
        "normalized": issue[1].isoformat() if issue else None,
        "confidence": issue[2] if issue else 0.0,
    }
    out["maturity_date"] = {
        "raw": maturity[0] if maturity else None,
        "normalized": maturity[1].isoformat() if maturity else None,
        "confidence": maturity[2] if maturity else 0.0,
    }

    inst = extract_institution(text, institutions)
    out["institution_name"] = {
        "raw": inst[0] if inst else None,
        "normalized": inst[0] if inst else None,
        "confidence": inst[1] if inst else 0.0,
    }
    return out


CONFIDENT_THRESHOLD = 0.85  # below this a field is explicitly flagged for manual review


# ---------------------------------------------------------------------------
# Private storage backends
#   * Local disk by default (development / long-running hosts).
#   * Supabase Storage when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set —
#     required on serverless hosts (e.g. Vercel) where disk is ephemeral.
# ---------------------------------------------------------------------------
def _bucket_key(relative: str) -> str:
    return relative.replace("\\", "/").lstrip("/")


def _supabase_object_url(object_key: str) -> str:
    base = settings.supabase_url.rstrip("/")
    bucket = settings.supabase_storage_bucket
    return f"{base}/storage/v1/object/{bucket}/{quote(_bucket_key(object_key), safe='/')}"


def _supabase_headers(content_type: Optional[str] = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {settings.supabase_service_role_key}"}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def storage_put(object_key: str, data: bytes, mime: str) -> None:
    """Upload bytes to Supabase Storage (upsert). Raises ValueError on failure."""
    request = urllib.request.Request(_supabase_object_url(object_key), data=data, method="POST")
    for header, value in _supabase_headers(mime).items():
        request.add_header(header, value)
    request.add_header("x-upsert", "true")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status >= 400:
                raise ValueError(f"Document storage rejected the upload (HTTP {response.status}).")
    except urllib.error.HTTPError as exc:
        raise ValueError(f"Document storage upload failed (HTTP {exc.code}).") from exc
    except urllib.error.URLError as exc:
        raise ValueError("Document storage is unavailable.") from exc


def storage_get(object_key: str) -> bytes:
    """Download bytes from Supabase Storage. Raises ValueError on failure."""
    request = urllib.request.Request(_supabase_object_url(object_key))
    for header, value in _supabase_headers().items():
        request.add_header(header, value)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        raise ValueError(f"Document storage download failed (HTTP {exc.code}).") from exc
    except urllib.error.URLError as exc:
        raise ValueError("Document storage is unavailable.") from exc


# ---------------------------------------------------------------------------
# Pipeline orchestration
# ---------------------------------------------------------------------------
def store_upload(
    db: Session,
    *,
    data: bytes,
    original_filename: str,
    document_type: str,
    institution_id: int,
    fdr_id: Optional[int],
    uploaded_by: Optional[int],
    filename_prefix: Optional[str] = None,
) -> Document:
    """Validate + persist an upload into private storage. Returns a Document row."""
    if not data:
        raise ValueError("The uploaded file is empty.")
    if len(data) > settings.max_upload_bytes:
        raise ValueError(
            f"File exceeds the {settings.max_upload_mb} MB upload limit configured for this deployment."
        )
    mime = sniff_mime(data)
    if mime is None:
        raise ValueError("Unsupported file type. Only PDF, PNG and JPEG files are accepted "
                         "(the file content itself must match — the extension is not trusted).")
    if mime not in settings.allowed_mime_types:
        raise ValueError(f"File type {mime} is not permitted by the current settings.")

    safe_name = safe_filename(original_filename)
    checksum = sha256_hex(data)
    relative_dir = Path("documents") / str(institution_id)
    prefix = filename_prefix or uuid.uuid4().hex
    relative_path = relative_dir / f"{prefix}_{safe_name}"

    if settings.supabase_storage_enabled:
        # Supabase Storage (upsert): unique prefixes for real uploads; seed
        # reseeds are idempotent because the same content rewrites the key.
        object_key = str(relative_path).replace("\\", "/")
        storage_put(object_key, data, mime)
    else:
        absolute = settings.storage_path / relative_path
        absolute.parent.mkdir(parents=True, exist_ok=True)
        if absolute.exists():
            # Deterministic seed prefixes can collide on reseeds; suffix instead of failing.
            stem = f"{prefix}_{safe_name}"
            for n in range(1, 1000):
                candidate = relative_dir / f"{stem}.{n}"
                if not (settings.storage_path / candidate).exists():
                    relative_path = candidate
                    break
            else:  # pragma: no cover - pathological collision storm
                raise ValueError("Storage collision; please retry the upload.")
            absolute = settings.storage_path / relative_path
        absolute.write_bytes(data)
        object_key = str(relative_path).replace("\\", "/")

    document = Document(
        institution_id=institution_id,
        fdr_id=fdr_id,
        document_type=document_type,
        original_filename=safe_name,
        private_storage_path=object_key,
        mime_type=mime,
        file_size=len(data),
        checksum=checksum,
        upload_status=e.DOC_UPLOAD_UPLOADED,
        uploaded_by=uploaded_by,
        extraction_status=e.EXTRACTION_PENDING,
    )
    db.add(document)
    db.flush()
    return document


def read_document_bytes(document: Document) -> bytes:
    """Load file bytes from private storage, refusing any path outside the root."""
    if settings.supabase_storage_enabled:
        return storage_get(document.private_storage_path)
    root = settings.storage_path.resolve()
    target = (settings.storage_path / document.private_storage_path).resolve()
    if not str(target).startswith(str(root)):
        raise ValueError("Invalid storage path.")
    return target.read_bytes()


def process_document(db: Session, document: Document) -> Document:
    """Full extraction pipeline for one stored document (never raises)."""
    document.extraction_started_at = datetime.utcnow()
    try:
        data = read_document_bytes(document)
    except Exception as exc:  # noqa: BLE001
        document.extraction_status = e.EXTRACTION_FAILED
        document.extraction_error = f"Stored file could not be read: {exc}"
        document.extraction_completed_at = datetime.utcnow()
        db.flush()
        return document

    text, status, error = extract_text(data, document.mime_type)
    document.extracted_text = text
    document.extraction_status = status
    document.extraction_error = error

    institutions = list(db.execute(select(Institution)).scalars().all())
    fields = parse_fdr_fields(text, institutions) if text.strip() else {
        f: {"raw": None, "normalized": None, "confidence": 0.0} for f in REQUIRED_FIELDS
    }

    existing = {
        f.field_name: f
        for f in db.execute(
            select(ExtractedFdrField).where(ExtractedFdrField.document_id == document.id)
        ).scalars().all()
    }
    for field_name, payload in fields.items():
        confidence = round(float(payload["confidence"]), 3)
        review_status = (
            e.FIELD_REVIEW_PENDING if confidence >= CONFIDENT_THRESHOLD else e.FIELD_REVIEW_NEEDS_REVIEW
        )
        row = existing.get(field_name)
        if row is None:
            row = ExtractedFdrField(
                document_id=document.id,
                field_name=field_name,
                extracted_value=payload["raw"],
                normalized_value=payload["normalized"],
                confidence_score=confidence,
                review_status=review_status,
            )
            db.add(row)
        elif row.review_status in (e.FIELD_REVIEW_PENDING, e.FIELD_REVIEW_NEEDS_REVIEW):
            row.extracted_value = payload["raw"]
            row.normalized_value = payload["normalized"]
            row.confidence_score = confidence
            row.review_status = review_status

    document.extraction_completed_at = datetime.utcnow()
    db.flush()
    return document
