from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Dict, List, Optional

from cryptography.fernet import Fernet, InvalidToken

from .config import PROVIDER_KEYS_TABLE, PROVIDER_KEY_ENCRYPTION_KEY
from .database import get_db

DEFAULT_PROVIDERS = ("mistral",)

_mem_provider_keys: Dict[str, Dict[str, Any]] = {
    name: {
        "id": str(uuid.uuid4()),
        "provider_name": name,
        "is_enabled": False,
        "key_value": None,
        "updated_by": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    for name in DEFAULT_PROVIDERS
}

_fernet: Optional[Fernet] = None
if PROVIDER_KEY_ENCRYPTION_KEY:
    try:
        _fernet = Fernet(PROVIDER_KEY_ENCRYPTION_KEY.encode("utf-8"))
    except Exception:
        _fernet = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_provider(row: Dict[str, Any]) -> Dict[str, Any]:
    key_value = row.get("key_value")
    return {
        "id": row.get("id"),
        "provider_name": row.get("provider_name"),
        "is_enabled": bool(row.get("is_enabled", False)),
        "key_present": bool(key_value),
        "updated_by": row.get("updated_by"),
        "updated_at": row.get("updated_at"),
    }


def _encrypt_key_value(raw: str) -> str:
    value = str(raw or "").strip()
    if not value:
        return ""
    if value.startswith("enc:v1:"):
        return value
    if not _fernet:
        return value
    token = _fernet.encrypt(value.encode("utf-8")).decode("utf-8")
    return f"enc:v1:{token}"


def _decrypt_key_value(raw: Any) -> Optional[str]:
    value = str(raw or "").strip()
    if not value:
        return None
    if value.startswith("enc:v1:"):
        token = value[len("enc:v1:") :]
        if not _fernet:
            return None
        try:
            return _fernet.decrypt(token.encode("utf-8")).decode("utf-8")
        except (InvalidToken, Exception):
            return None
    return value


def _ensure_default_providers_db() -> None:
    db = get_db()
    if not db:
        return
    for name in DEFAULT_PROVIDERS:
        result = db.table(PROVIDER_KEYS_TABLE).select("id").eq("provider_name", name).limit(1).execute()
        rows = result.data or []
        if rows:
            continue
        db.table(PROVIDER_KEYS_TABLE).insert(
            {"provider_name": name, "is_enabled": False}
        ).execute()


def list_providers() -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        _ensure_default_providers_db()
        result = db.table(PROVIDER_KEYS_TABLE).select("*").order("provider_name").execute()
        return [_normalize_provider(r) for r in (result.data or [])]
    return [_normalize_provider(v) for v in _mem_provider_keys.values()]


def get_provider(provider_name: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db:
        _ensure_default_providers_db()
        result = db.table(PROVIDER_KEYS_TABLE).select("*").eq("provider_name", provider_name).limit(1).execute()
        rows = result.data or []
        return rows[0] if rows else None
    return _mem_provider_keys.get(provider_name)


def get_provider_key(provider_name: str) -> Optional[str]:
    row = get_provider(provider_name)
    if not row:
        return None
    if not row.get("is_enabled", False):
        return None
    return _decrypt_key_value(row.get("key_value"))


def update_provider(
    provider_name: str,
    *,
    is_enabled: Optional[bool] = None,
    key_value: Optional[str] = None,
    actor_user_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    db = get_db()
    updates: Dict[str, Any] = {"updated_at": _now_iso(), "updated_by": actor_user_id}
    if is_enabled is not None:
        updates["is_enabled"] = is_enabled
    if key_value is not None:
        updates["key_value"] = _encrypt_key_value(key_value)

    if db:
        _ensure_default_providers_db()
        result = db.table(PROVIDER_KEYS_TABLE).update(updates).eq("provider_name", provider_name).execute()
        rows = result.data or []
        return rows[0] if rows else None

    current = _mem_provider_keys.get(provider_name)
    if not current:
        return None
    current.update(updates)
    _mem_provider_keys[provider_name] = current
    return current
