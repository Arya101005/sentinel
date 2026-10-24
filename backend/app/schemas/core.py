"""Schemas for auth, users, institutions and FDR records."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from .common import ORMModel

RoleLiteral = Literal["admin", "officer", "institution", "auditor"]


# --- Auth -------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserOut(ORMModel):
    id: int
    display_name: str
    email: EmailStr
    username: Optional[str] = None
    role: str
    institution_id: Optional[int] = None
    institution_name: Optional[str] = None
    is_active: bool
    is_competent_authority: bool
    created_at: datetime


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class UserCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    username: str = Field(min_length=3, max_length=120, pattern=r"^[A-Za-z0-9_.-]+$")
    role: RoleLiteral
    institution_id: Optional[int] = None
    password: str = Field(min_length=8, max_length=256)
    is_competent_authority: bool = False

    @field_validator("institution_id")
    @classmethod
    def _inst(cls, v):
        return v


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[RoleLiteral] = None
    institution_id: Optional[int] = None
    is_active: Optional[bool] = None
    is_competent_authority: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=256)


# --- Institutions -----------------------------------------------------------
class InstitutionCreate(BaseModel):
    institution_code: str = Field(min_length=2, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    institution_name: str = Field(min_length=2, max_length=255)
    institution_type: str = "college"
    region: str = ""
    address: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    status: str = "active"


class InstitutionUpdate(BaseModel):
    institution_name: Optional[str] = None
    institution_type: Optional[str] = None
    region: Optional[str] = None
    address: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    status: Optional[str] = None


class InstitutionOut(ORMModel):
    id: int
    institution_code: str
    institution_name: str
    institution_type: str
    region: str
    address: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    status: str
    is_demo: bool
    created_at: datetime
    updated_at: Optional[datetime] = None


class InstitutionDetail(InstitutionOut):
    active_fdr_count: int = 0
    matured_without_application: int = 0
    open_discrepancies: int = 0
    open_applications: int = 0


# --- FDR --------------------------------------------------------------------
class FdrBase(BaseModel):
    institution_id: int
    fdr_reference_number: str = Field(min_length=3, max_length=64)
    bank_name: str = Field(min_length=2, max_length=160)
    branch_name: Optional[str] = None
    deposit_amount: Decimal = Field(gt=0, le=Decimal("999999999999.99"))
    currency: str = "INR"
    issue_date: Optional[date] = None
    maturity_date: Optional[date] = None
    lifecycle_status: str = "active"
    eligibility_notes: Optional[str] = None
    remarks: Optional[str] = None

    @field_validator("currency")
    @classmethod
    def _currency(cls, v: str) -> str:
        v = v.upper().strip()
        if v not in {"INR", "USD", "EUR", "GBP"}:
            raise ValueError("Unsupported currency")
        return v


class FdrCreate(FdrBase):
    pass


class FdrUpdate(BaseModel):
    fdr_reference_number: Optional[str] = Field(default=None, min_length=3, max_length=64)
    bank_name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    branch_name: Optional[str] = None
    deposit_amount: Optional[Decimal] = Field(default=None, gt=0)
    currency: Optional[str] = None
    issue_date: Optional[date] = None
    maturity_date: Optional[date] = None
    lifecycle_status: Optional[str] = None
    verification_status: Optional[str] = None
    eligibility_notes: Optional[str] = None
    remarks: Optional[str] = None


class FdrOut(ORMModel):
    id: int
    institution_id: int
    institution_name: Optional[str] = None
    institution_code: Optional[str] = None
    region: Optional[str] = None
    fdr_reference_number: str
    bank_name: str
    branch_name: Optional[str] = None
    deposit_amount: Decimal
    currency: str
    issue_date: Optional[date] = None
    maturity_date: Optional[date] = None
    verification_status: str
    lifecycle_status: str
    release_application_status: str
    renewal_parent_id: Optional[int] = None
    replacement_fdr_id: Optional[int] = None
    link_type: Optional[str] = None
    eligibility_notes: Optional[str] = None
    remarks: Optional[str] = None
    last_verified_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    is_demo: bool
    # Computed monitoring fields (populated by the API layer).
    monitoring_category: Optional[str] = None
    days_to_maturity: Optional[int] = None
    open_discrepancies: Optional[int] = None


class FdrLinkRequest(BaseModel):
    """Link a renewal or replacement FDR to an existing record."""

    link_type: Literal["renewal", "replacement"]
    # When the successor record already exists:
    linked_fdr_id: Optional[int] = None
    # When the successor record should be created in the same call:
    new_fdr: Optional[dict] = None
    comment: Optional[str] = None


class FdrLifecycleEventOut(ORMModel):
    id: int
    fdr_id: int
    event_type: str
    previous_value: Optional[str] = None
    new_value: Optional[str] = None
    actor_user_id: Optional[int] = None
    actor_name: Optional[str] = None
    comment: Optional[str] = None
    created_at: datetime
