"""Schemas for documents, extraction review and discrepancy flags."""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from .common import ORMModel


# --- Documents --------------------------------------------------------------
class DocumentOut(ORMModel):
    id: int
    institution_id: int
    fdr_id: Optional[int] = None
    document_type: str
    original_filename: str
    mime_type: str
    file_size: int
    checksum: str
    upload_status: str
    uploaded_by: Optional[int] = None
    uploader_name: Optional[str] = None
    uploaded_at: datetime
    version_number: int
    extraction_status: str
    extraction_error: Optional[str] = None
    extraction_completed_at: Optional[datetime] = None
    review_status: str
    reviewed_by: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    is_demo: bool
    download_url: Optional[str] = None


class ExtractedFieldOut(ORMModel):
    id: int
    document_id: int
    field_name: str
    extracted_value: Optional[str] = None
    normalized_value: Optional[str] = None
    confidence_score: Optional[float] = None
    review_status: str
    reviewed_by: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime


class ExtractedFieldReview(BaseModel):
    review_status: Literal["confirmed", "corrected", "needs_review", "pending"]
    corrected_value: Optional[str] = Field(default=None, max_length=512)


class DocumentReviewRequest(BaseModel):
    review_status: Literal["reviewed", "in_review", "pending"]
    comments: Optional[str] = Field(default=None, max_length=1000)


# --- Discrepancies ----------------------------------------------------------
class DiscrepancyOut(ORMModel):
    id: int
    fdr_id: Optional[int] = None
    document_id: Optional[int] = None
    field_name: Optional[str] = None
    submitted_value: Optional[str] = None
    extracted_value: Optional[str] = None
    discrepancy_type: str
    severity: str
    explanation: Optional[str] = None
    status: str
    assigned_to: Optional[int] = None
    resolution_notes: Optional[str] = None
    resolved_by: Optional[int] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    # Denormalised convenience fields
    fdr_reference_number: Optional[str] = None
    bank_name: Optional[str] = None
    institution_id: Optional[int] = None
    institution_name: Optional[str] = None


class DiscrepancyAction(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=1000)
    resolution_notes: Optional[str] = Field(default=None, max_length=1000)


class CorrectionRequest(BaseModel):
    requested_changes: str = Field(min_length=5, max_length=2000)
