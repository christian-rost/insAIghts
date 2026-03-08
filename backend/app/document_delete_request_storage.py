from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional

from .config import DELETE_REQUESTS_TABLE
from .database import get_db

_mem_delete_requests: Dict[str, Dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_delete_request(
    *,
    invoice_id: str,
    document_id: Optional[str],
    reason: str,
    requested_by_user_id: str,
    requested_by_username: Optional[str],
) -> Dict[str, Any]:
    row = {
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "document_id": document_id,
        "reason": reason,
        "status": "PENDING",
        "requested_by_user_id": requested_by_user_id,
        "requested_by_username": requested_by_username,
        "reviewed_by_user_id": None,
        "reviewed_by_username": None,
        "review_note": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    db = get_db()
    if db:
        result = db.table(DELETE_REQUESTS_TABLE).insert(row).execute()
        rows = result.data or []
        return rows[0] if rows else row
    _mem_delete_requests[row["id"]] = row
    return row


def list_delete_requests(status: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        query = db.table(DELETE_REQUESTS_TABLE).select("*")
        if status:
            query = query.eq("status", status)
        result = query.order("created_at", desc=True).limit(limit).execute()
        return result.data or []
    rows = list(_mem_delete_requests.values())
    if status:
        rows = [r for r in rows if str(r.get("status") or "") == status]
    rows = sorted(rows, key=lambda x: x.get("created_at", ""), reverse=True)
    return rows[:limit]


def get_delete_request_by_id(request_id: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db:
        result = db.table(DELETE_REQUESTS_TABLE).select("*").eq("id", request_id).limit(1).execute()
        rows = result.data or []
        return rows[0] if rows else None
    return _mem_delete_requests.get(request_id)


def update_delete_request(request_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    payload = {**updates, "updated_at": _now_iso()}
    db = get_db()
    if db:
        result = db.table(DELETE_REQUESTS_TABLE).update(payload).eq("id", request_id).execute()
        rows = result.data or []
        return rows[0] if rows else None
    row = _mem_delete_requests.get(request_id)
    if not row:
        return None
    row.update(payload)
    _mem_delete_requests[request_id] = row
    return row
