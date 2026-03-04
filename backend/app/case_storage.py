from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional

from .config import INVOICE_CASES_TABLE
from .database import get_db

_mem_cases: Dict[str, Dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_case(
    *,
    invoice_id: str,
    title: str,
    description: Optional[str],
    status: str,
    created_by_user_id: Optional[str],
    created_by_username: Optional[str],
) -> Dict[str, Any]:
    row = {
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "title": title,
        "description": description,
        "status": status,
        "created_by_user_id": created_by_user_id,
        "created_by_username": created_by_username,
        "resolved_note": None,
        "resolved_by_user_id": None,
        "resolved_by_username": None,
        "resolved_at": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    db = get_db()
    if db:
        result = db.table(INVOICE_CASES_TABLE).insert(row).execute()
        rows = result.data or []
        return rows[0] if rows else row

    _mem_cases[row["id"]] = row
    return row


def get_case_by_id(case_id: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db:
        result = db.table(INVOICE_CASES_TABLE).select("*").eq("id", case_id).limit(1).execute()
        rows = result.data or []
        return rows[0] if rows else None
    return _mem_cases.get(case_id)


def list_cases(invoice_id: Optional[str] = None, status: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        query = db.table(INVOICE_CASES_TABLE).select("*")
        if invoice_id:
            query = query.eq("invoice_id", invoice_id)
        if status:
            query = query.eq("status", status)
        result = query.order("created_at", desc=True).limit(limit).execute()
        return result.data or []

    rows = list(_mem_cases.values())
    if invoice_id:
        rows = [r for r in rows if str(r.get("invoice_id") or "") == invoice_id]
    if status:
        rows = [r for r in rows if str(r.get("status") or "") == status]
    rows = sorted(rows, key=lambda x: x.get("created_at", ""), reverse=True)
    return rows[:limit]


def update_case(case_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    payload = {**updates, "updated_at": _now_iso()}
    db = get_db()
    if db:
        result = db.table(INVOICE_CASES_TABLE).update(payload).eq("id", case_id).execute()
        rows = result.data or []
        return rows[0] if rows else None

    row = _mem_cases.get(case_id)
    if not row:
        return None
    row.update(payload)
    _mem_cases[case_id] = row
    return row
