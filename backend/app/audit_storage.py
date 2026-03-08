from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional

from .config import ADMIN_AUDIT_TABLE
from .database import get_db

_mem_audit_events: List[Dict[str, Any]] = []


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_admin_event(
    event_type: str,
    actor_user_id: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    metadata_json: Optional[Dict[str, Any]] = None,
    diff_before: Optional[Dict[str, Any]] = None,
    diff_after: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    row = {
        "id": str(uuid.uuid4()),
        "event_type": event_type,
        "actor_user_id": actor_user_id,
        "target_type": target_type,
        "target_id": target_id,
        "metadata_json": metadata_json or {},
        "diff_before": diff_before,
        "diff_after": diff_after,
        "created_at": _now_iso(),
    }

    db = get_db()
    if db:
        result = db.table(ADMIN_AUDIT_TABLE).insert(row).execute()
        rows = result.data or []
        return rows[0] if rows else row

    _mem_audit_events.append(row)
    return row


def list_admin_events(limit: int = 200) -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        result = db.table(ADMIN_AUDIT_TABLE).select("*").order("created_at", desc=True).limit(limit).execute()
        return result.data or []
    rows = sorted(_mem_audit_events, key=lambda x: x.get("created_at", ""), reverse=True)
    return rows[:limit]
