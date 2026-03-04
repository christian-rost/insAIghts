from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, Optional

from .config import WORKFLOW_RULES_TABLE
from .database import get_db

DEFAULT_RULE_NAME = "invoice_approval"
DEFAULT_RULES_JSON: Dict[str, Any] = {
    "approval": {
        "four_eyes": False,
        "require_validated_status": False,
        "amount_limits": [
            {"max_amount": 1000, "allowed_roles": ["AP_CLERK", "APPROVER", "ADMIN"]},
            {"max_amount": 10000, "allowed_roles": ["APPROVER", "ADMIN"]},
            {"max_amount": None, "allowed_roles": ["ADMIN"]},
        ],
        "supplier_role_overrides": [],
    }
}

_mem_rule: Dict[str, Any] = {
    "id": str(uuid.uuid4()),
    "rule_name": DEFAULT_RULE_NAME,
    "rules_json": DEFAULT_RULES_JSON,
    "updated_by": None,
    "updated_at": datetime.now(timezone.utc).isoformat(),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "rule_name": row.get("rule_name") or DEFAULT_RULE_NAME,
        "rules_json": row.get("rules_json") or {},
        "updated_by": row.get("updated_by"),
        "updated_at": row.get("updated_at"),
    }


def _ensure_default_db() -> None:
    db = get_db()
    if not db:
        return
    result = db.table(WORKFLOW_RULES_TABLE).select("id").eq("rule_name", DEFAULT_RULE_NAME).limit(1).execute()
    if result.data:
        return
    db.table(WORKFLOW_RULES_TABLE).insert(
        {
            "rule_name": DEFAULT_RULE_NAME,
            "rules_json": DEFAULT_RULES_JSON,
        }
    ).execute()


def get_workflow_rules() -> Dict[str, Any]:
    db = get_db()
    if db:
        _ensure_default_db()
        result = db.table(WORKFLOW_RULES_TABLE).select("*").eq("rule_name", DEFAULT_RULE_NAME).limit(1).execute()
        rows = result.data or []
        if rows:
            return _normalize(rows[0])
        return {
            "id": None,
            "rule_name": DEFAULT_RULE_NAME,
            "rules_json": DEFAULT_RULES_JSON,
            "updated_by": None,
            "updated_at": None,
        }
    return _normalize(_mem_rule)


def update_workflow_rules(rules_json: Dict[str, Any], actor_user_id: Optional[str] = None) -> Dict[str, Any]:
    db = get_db()
    updates = {
        "rules_json": rules_json,
        "updated_by": actor_user_id,
        "updated_at": _now_iso(),
    }
    if db:
        _ensure_default_db()
        result = (
            db.table(WORKFLOW_RULES_TABLE)
            .update(updates)
            .eq("rule_name", DEFAULT_RULE_NAME)
            .execute()
        )
        rows = result.data or []
        return _normalize(rows[0]) if rows else {"rule_name": DEFAULT_RULE_NAME, **updates}

    _mem_rule.update(updates)
    return _normalize(_mem_rule)
