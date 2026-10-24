"""Schemas for release applications, clearances, notifications, reports,
audit, settings and monitoring."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field

from .common import ORMModel


# --- Applications -----------------------------------------------------------
class ApplicationCreate(BaseModel):
    fdr_id: int
    completeness_status: Literal["complete", "incomplete", "unknown"] = "unknown"
    assigned_officer_id: Optional[int] = None
    comments: Optional[str] = Field(default=None, max_length=2000)


class ApplicationOut(ORMModel):
    id: int
    application_reference: str
    institution_id: int
    institution_name: Optional[str] = None
    fdr_id: int
    fdr_reference_number: Optional[str] = None
    bank_name: Optional[str] = None
    deposit_amount: Optional[str] = None
    maturity_date: Optional[date] = None
    submitted_at: Optional[datetime] = None
    application_status: str
    completeness_status: str
    assigned_officer_id: Optional[int] = None
    assigned_officer_name: Optional[str] = None
    pending_reason: Optional[str] = None
    current_stage_started_at: datetime
    last_action_at: datetime
    created_at: datetime
    updated_at: Optional[datetime] = None
    days_in_current_stage: Optional[int] = None
    is_overdue: Optional[bool] = None
    open_clearance_count: Optional[int] = None
    missing_document_count: Optional[int] = None


class ApplicationStatusChange(BaseModel):
    new_status: str
    reason: Optional[str] = Field(default=None, max_length=2000)
    comments: Optional[str] = Field(default=None, max_length=2000)


class ApplicationAssign(BaseModel):
    officer_id: Optional[int] = None
    comments: Optional[str] = Field(default=None, max_length=500)


class ApplicationEventOut(ORMModel):
    id: int
    application_id: int
    previous_status: Optional[str] = None
    new_status: Optional[str] = None
    event_type: str
    actor_user_id: Optional[int] = None
    actor_name: Optional[str] = None
    comments: Optional[str] = None
    created_at: datetime


# --- Clearances -------------------------------------------------------------
class ClearanceCreate(BaseModel):
    clearance_type: str
    assigned_unit: Optional[str] = None
    remarks: Optional[str] = Field(default=None, max_length=1000)


class ClearanceUpdate(BaseModel):
    status: str
    remarks: Optional[str] = Field(default=None, max_length=2000)


class ClearanceOut(ORMModel):
    id: int
    application_id: int
    clearance_type: str
    clearance_label: Optional[str] = None
    status: str
    assigned_unit: Optional[str] = None
    requested_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    remarks: Optional[str] = None
    updated_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    days_pending: Optional[int] = None
    is_overdue: Optional[bool] = None


# --- Notifications ----------------------------------------------------------
class NotificationOut(ORMModel):
    id: int
    recipient_user_id: Optional[int] = None
    institution_id: Optional[int] = None
    fdr_id: Optional[int] = None
    application_id: Optional[int] = None
    notification_type: str
    channel: str
    title: str
    message: str
    scheduled_at: datetime
    sent_at: Optional[datetime] = None
    delivery_status: str
    read_at: Optional[datetime] = None
    is_escalation: bool
    created_at: datetime
    fdr_reference_number: Optional[str] = None


class NotificationPrefOut(ORMModel):
    id: int
    user_id: int
    event_type: str
    enabled: bool
    channel: str


class NotificationPrefUpdate(BaseModel):
    event_type: str
    enabled: bool
    channel: Literal["in_app", "email"] = "in_app"


# --- Reports ----------------------------------------------------------------
class ReportQuery(BaseModel):
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    institution_id: Optional[int] = None
    region: Optional[str] = None
    status: Optional[str] = None
    bank_name: Optional[str] = None
    category: Optional[str] = None


class ReportColumn(BaseModel):
    key: str
    label: str


class ReportPreview(BaseModel):
    report_key: str
    report_title: str
    generated_at: datetime
    row_count: int
    columns: List[ReportColumn]
    rows: List[dict]
    page: int
    page_size: int
    pages: int
    filters: dict
    data_coverage_warning: Optional[str] = None


# --- Audit ------------------------------------------------------------------
class AuditOut(ORMModel):
    id: int
    actor_user_id: Optional[int] = None
    actor_name: Optional[str] = None
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    timestamp: datetime
    request_id: Optional[str] = None
    reason: Optional[str] = None
    metadata_json: Optional[dict] = None


# --- Settings ---------------------------------------------------------------
class SettingOut(BaseModel):
    key: str
    value: Any
    description: Optional[str] = None
    updated_at: Optional[datetime] = None


class SettingUpdate(BaseModel):
    key: str
    value: Any


# --- Monitoring / dashboard -------------------------------------------------
class KpiCard(BaseModel):
    key: str
    label: str
    value: int
    hint: Optional[str] = None
    route: Optional[str] = None
    severity: Optional[str] = None


class DashboardSummary(BaseModel):
    generated_at: datetime
    cards: List[KpiCard]
    data_coverage_warning: Optional[str] = None


class ChartBucket(BaseModel):
    label: str
    value: int


class ChartSeries(BaseModel):
    key: str
    title: str
    buckets: List[ChartBucket]


class DashboardCharts(BaseModel):
    lifecycle_status: ChartSeries
    upcoming_maturity_by_month: ChartSeries
    by_region: ChartSeries
    discrepancy_categories: ChartSeries
    pending_by_stage: ChartSeries
    application_processing_days: ChartSeries


class MaturityRow(BaseModel):
    fdr_id: int
    fdr_reference_number: str
    bank_name: str
    institution_id: int
    institution_name: str
    region: str
    deposit_amount: str
    maturity_date: Optional[date] = None
    days_to_maturity: Optional[int] = None
    lifecycle_status: str
    release_application_status: str
    monitoring_category: str
    application_reference: Optional[str] = None
    application_status: Optional[str] = None
    open_discrepancies: int = 0
    days_since_maturity: Optional[int] = None


class MonitoringRunResult(BaseModel):
    checked: int
    notifications_created: int
    duplicates_suppressed: int
    escalations_created: int
    categories: dict
