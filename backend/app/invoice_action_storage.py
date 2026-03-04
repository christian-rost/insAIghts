from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional

from .config import INVOICE_ACTIONS_TABLE
from .database import get_db

_mem_actions: Dict[str, List[Dict[str, Any]]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_invoice_action(
    *,
    invoice_id: str,
    action_type: str,
    from_status: Optional[str],
    to_status: str,
    comment: Optional[str],
    actor_user_id: Optional[str],
    actor_username: Optional[str],
) -> Dict[str, Any]:
    row = {
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "action_type": action_type,
        "comment": comment,
        "from_status": from_status,
        "to_status": to_status,
        "actor_user_id": actor_user_id,
        "actor_username": actor_username,
        "created_at": _now_iso(),
    }

    db = get_db()
    if db:
        result = db.table(INVOICE_ACTIONS_TABLE).insert(row).execute()
        rows = result.data or []
        return rows[0] if rows else row

    _mem_actions.setdefault(invoice_id, []).append(row)
    return row


def list_invoice_actions(invoice_id: str, limit: int = 200) -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        result = (
            db.table(INVOICE_ACTIONS_TABLE)
            .select("*")
            .eq("invoice_id", invoice_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    rows = sorted(_mem_actions.get(invoice_id, []), key=lambda x: x.get("created_at", ""), reverse=True)
    return rows[:limit]


def list_all_invoice_actions(limit: int = 5000) -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        result = (
            db.table(INVOICE_ACTIONS_TABLE)
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    merged: List[Dict[str, Any]] = []
    for actions in _mem_actions.values():
        merged.extend(actions)
    merged.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return merged[:limit]
