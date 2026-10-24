"""Shared Pydantic schemas: pagination, errors, helpers."""

from __future__ import annotations

from datetime import datetime
from typing import Generic, List, Optional, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int
    pages: int


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    detail: ErrorDetail


class Message(BaseModel):
    message: str


class PaginationParams(BaseModel):
    page: int = 1
    page_size: int = 25


def paginate(items: List[T], total: int, page: int, page_size: int) -> Page[T]:
    pages = max(1, -(-total // page_size)) if page_size else 1
    return Page(items=items, total=total, page=page, page_size=page_size, pages=pages)


class Timestamped(ORMModel):
    created_at: datetime
    updated_at: Optional[datetime] = None
