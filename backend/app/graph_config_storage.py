from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional

from .config import GRAPH_CONFIG_TABLE
from .database import get_db

DEFAULT_GRAPH_CONFIG_NAME = "invoice_data_layer"
DEFAULT_GRAPH_CONFIG_JSON: Dict[str, Any] = {
    "data_layer_fields": ["supplier_name", "currency", "status", "empfaenger"],
}

_mem_config: Dict[str, Any] = {
    "id": str(uuid.uuid4()),
    "config_name": DEFAULT_GRAPH_CONFIG_NAME,
    "config_json": DEFAULT_GRAPH_CONFIG_JSON,
    "updated_by": None,
    "updated_at": datetime.now(timezone.utc).isoformat(),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize(row: Dict[str, Any]) -> Dict[str, Any]:
    cfg = row.get("config_json") or {}
    fields = cfg.get("data_layer_fields") if isinstance(cfg, dict) else []
    if not isinstance(fields, list):
        fields = []
    normalized_fields: List[str] = []
    seen = set()
    for value in fields:
        name = str(value or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        normalized_fields.append(name)
    return {
        "id": row.get("id"),
        "config_name": row.get("config_name") or DEFAULT_GRAPH_CONFIG_NAME,
        "config_json": {
            "data_layer_fields": normalized_fields,
        },
        "updated_by": row.get("updated_by"),
        "updated_at": row.get("updated_at"),
    }


def _ensure_default_db() -> None:
    db = get_db()
    if not db:
        return
    result = db.table(GRAPH_CONFIG_TABLE).select("id").eq("config_name", DEFAULT_GRAPH_CONFIG_NAME).limit(1).execute()
    if result.data:
        return
    db.table(GRAPH_CONFIG_TABLE).insert(
        {
            "config_name": DEFAULT_GRAPH_CONFIG_NAME,
            "config_json": DEFAULT_GRAPH_CONFIG_JSON,
        }
    ).execute()


def get_graph_config() -> Dict[str, Any]:
    db = get_db()
    if db:
        _ensure_default_db()
        result = db.table(GRAPH_CONFIG_TABLE).select("*").eq("config_name", DEFAULT_GRAPH_CONFIG_NAME).limit(1).execute()
        rows = result.data or []
        if rows:
            return _normalize(rows[0])
        return {
            "id": None,
            "config_name": DEFAULT_GRAPH_CONFIG_NAME,
            "config_json": DEFAULT_GRAPH_CONFIG_JSON,
            "updated_by": None,
            "updated_at": None,
        }
    return _normalize(_mem_config)


def update_graph_config(data_layer_fields: List[str], actor_user_id: Optional[str] = None) -> Dict[str, Any]:
    updates = {
        "config_json": {"data_layer_fields": data_layer_fields},
        "updated_by": actor_user_id,
        "updated_at": _now_iso(),
    }
    db = get_db()
    if db:
        _ensure_default_db()
        result = (
            db.table(GRAPH_CONFIG_TABLE)
            .update(updates)
            .eq("config_name", DEFAULT_GRAPH_CONFIG_NAME)
            .execute()
        )
        rows = result.data or []
        return _normalize(rows[0] if rows else {"config_name": DEFAULT_GRAPH_CONFIG_NAME, **updates})

    _mem_config.update(updates)
    return _normalize(_mem_config)
