from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional

from .database import get_db

DEFAULT_CONNECTORS = ("mail", "rest", "minio")

_mem_connectors: Dict[str, Dict[str, Any]] = {
    name: {
        "id": str(uuid.uuid4()),
        "connector_name": name,
        "enabled": False,
        "schedule_cron": None,
        "poll_interval_seconds": 300,
        "retry_max_attempts": 3,
        "retry_backoff_seconds": 30,
        "timeout_seconds": 60,
        "config_json": {},
        "updated_by": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    for name in DEFAULT_CONNECTORS
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_connector(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "connector_name": row.get("connector_name"),
        "enabled": bool(row.get("enabled", False)),
        "schedule_cron": row.get("schedule_cron"),
        "poll_interval_seconds": row.get("poll_interval_seconds"),
        "retry_max_attempts": row.get("retry_max_attempts"),
        "retry_backoff_seconds": row.get("retry_backoff_seconds"),
        "timeout_seconds": row.get("timeout_seconds"),
        "config_json": row.get("config_json") or {},
        "updated_by": row.get("updated_by"),
        "updated_at": row.get("updated_at"),
    }


def _ensure_default_connectors_db() -> None:
    db = get_db()
    if not db:
        return
    for name in DEFAULT_CONNECTORS:
        result = db.table("app_config_connectors").select("id").eq("connector_name", name).limit(1).execute()
        rows = result.data or []
        if rows:
            continue
        db.table("app_config_connectors").insert(
            {
                "connector_name": name,
                "enabled": False,
                "poll_interval_seconds": 300,
                "retry_max_attempts": 3,
                "retry_backoff_seconds": 30,
                "timeout_seconds": 60,
                "config_json": {},
            }
        ).execute()


def list_connectors() -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        _ensure_default_connectors_db()
        result = db.table("app_config_connectors").select("*").order("connector_name").execute()
        return [_normalize_connector(r) for r in (result.data or [])]
    return [_normalize_connector(v) for v in _mem_connectors.values()]


def get_connector(connector_name: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db:
        _ensure_default_connectors_db()
        result = (
            db.table("app_config_connectors")
            .select("*")
            .eq("connector_name", connector_name)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return _normalize_connector(rows[0]) if rows else None

    row = _mem_connectors.get(connector_name)
    return _normalize_connector(row) if row else None


def update_connector(connector_name: str, updates: Dict[str, Any], actor_user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    updates = {**updates, "updated_at": _now_iso(), "updated_by": actor_user_id}
    db = get_db()
    if db:
        _ensure_default_connectors_db()
        result = (
            db.table("app_config_connectors")
            .update(updates)
            .eq("connector_name", connector_name)
            .execute()
        )
        rows = result.data or []
        return _normalize_connector(rows[0]) if rows else None

    current = _mem_connectors.get(connector_name)
    if not current:
        return None
    current.update(updates)
    _mem_connectors[connector_name] = current
    return _normalize_connector(current)

