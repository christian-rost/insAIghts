from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Dict, List, Optional

from .database import get_db
from .security import hash_password

_mem_users: Dict[str, Dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_user(row: Dict) -> Dict:
    roles = row.get("roles", [])
    if isinstance(roles, str):
        roles = [r.strip() for r in roles.split(",") if r.strip()]
    if not roles:
        roles = ["AP_CLERK"]
    return {
        "id": str(row.get("id")),
        "username": row.get("username", ""),
        "email": row.get("email", ""),
        "password_hash": row.get("password_hash", ""),
        "roles": roles,
        "is_active": bool(row.get("is_active", True)),
        "created_at": row.get("created_at", _now_iso()),
        "updated_at": row.get("updated_at", _now_iso()),
    }


def list_users() -> List[Dict]:
    db = get_db()
    if db:
        result = db.table("app_users").select("*").order("created_at").execute()
        return [_normalize_user(r) for r in (result.data or [])]
    return sorted(_mem_users.values(), key=lambda u: u.get("created_at", ""))


def get_user_by_id(user_id: str) -> Optional[Dict]:
    db = get_db()
    if db:
        result = db.table("app_users").select("*").eq("id", user_id).limit(1).execute()
        rows = result.data or []
        return _normalize_user(rows[0]) if rows else None
    return _mem_users.get(user_id)


def get_user_by_username(username: str) -> Optional[Dict]:
    db = get_db()
    if db:
        result = db.table("app_users").select("*").eq("username", username).limit(1).execute()
        rows = result.data or []
        return _normalize_user(rows[0]) if rows else None
    for user in _mem_users.values():
        if user.get("username") == username:
            return user
    return None


def create_user(username: str, email: str, password: str, roles: Optional[List[str]] = None) -> Dict:
    if get_user_by_username(username):
        raise ValueError("Username already exists")

    user = {
        "id": str(uuid.uuid4()),
        "username": username,
        "email": email,
        "password_hash": hash_password(password),
        "roles": roles or ["AP_CLERK"],
        "is_active": True,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    db = get_db()
    if db:
        result = db.table("app_users").insert(user).execute()
        rows = result.data or []
        return _normalize_user(rows[0]) if rows else _normalize_user(user)
    _mem_users[user["id"]] = user
    return user


def update_user(user_id: str, updates: Dict) -> Optional[Dict]:
    updates = {**updates, "updated_at": _now_iso()}
    db = get_db()
    if db:
        result = db.table("app_users").update(updates).eq("id", user_id).execute()
        rows = result.data or []
        return _normalize_user(rows[0]) if rows else None
    existing = _mem_users.get(user_id)
    if not existing:
        return None
    existing.update(updates)
    _mem_users[user_id] = existing
    return existing


def bootstrap_admin(admin_username: str, admin_password: str) -> Optional[Dict]:
    if not admin_username or not admin_password:
        return None
    existing = get_user_by_username(admin_username)
    if existing:
        return existing
    return create_user(
        username=admin_username,
        email=f"{admin_username}@local",
        password=admin_password,
        roles=["ADMIN"],
    )
