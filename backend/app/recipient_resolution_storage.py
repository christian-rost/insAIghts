from __future__ import annotations

import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
import uuid
from typing import Any, Dict, List, Optional, Tuple

from .config import RECIPIENT_ALIASES_TABLE
from .database import get_db

FUZZY_THRESHOLD = 0.93

_mem_aliases: Dict[str, Dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_key(value: str) -> str:
    raw = str(value or "").strip().lower()
    raw = raw.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    cleaned = []
    for ch in raw:
        if ch.isalnum() or ch == "_":
            cleaned.append(ch)
    return "".join(cleaned)


def _is_person_like_entity(entity_type: str) -> bool:
    key = _normalize_key(entity_type)
    hints = ["recipient", "empfaenger", "person", "contact", "kontakt", "owner", "user", "employee", "mitarbeiter"]
    return any(h in key for h in hints)


def normalize_attribute_value(raw: str, entity_type: str) -> str:
    value = str(raw or "").strip().lower()
    if not value:
        return ""
    person_like = _is_person_like_entity(entity_type)

    value = value.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    if person_like:
        value = re.sub(r"\b(dr|prof|mr|mrs|ms|herr|frau)\.?\b", " ", value)
        value = re.sub(r"[^a-z0-9, ]+", " ", value)
    else:
        value = re.sub(r"[^a-z0-9 ]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()

    if person_like and "," in value:
        left, right = [p.strip() for p in value.split(",", 1)]
        if left and right:
            value = f"{right} {left}".strip()

    return value


def _default_canonical(normalized: str, entity_type: str, raw_value: str) -> str:
    if not normalized:
        return str(raw_value or "").strip()
    key = _normalize_key(entity_type)
    if "currency" in key:
        return normalized.replace(" ", "").upper()
    if "status" in key:
        return normalized.replace(" ", "_").upper()
    return " ".join(part.capitalize() for part in normalized.split(" ") if part)


def _normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "entity_type": row.get("entity_type") or "",
        "raw_value": row.get("raw_value") or "",
        "raw_value_key": row.get("raw_value_key") or "",
        "normalized_value": row.get("normalized_value") or "",
        "canonical_value": row.get("canonical_value") or "",
        "match_method": row.get("match_method") or "rule",
        "confidence": float(row.get("confidence") or 0),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _save_alias(
    entity_type: str,
    raw_value: str,
    raw_value_key: str,
    normalized_value: str,
    canonical_value: str,
    match_method: str,
    confidence: float,
) -> Dict[str, Any]:
    db = get_db()
    payload = {
        "entity_type": entity_type,
        "raw_value": raw_value,
        "raw_value_key": raw_value_key,
        "normalized_value": normalized_value,
        "canonical_value": canonical_value,
        "match_method": match_method,
        "confidence": confidence,
        "updated_at": _now_iso(),
    }
    if db:
        existing = (
            db.table(RECIPIENT_ALIASES_TABLE)
            .select("id")
            .eq("entity_type", entity_type)
            .eq("raw_value_key", raw_value_key)
            .limit(1)
            .execute()
        )
        if existing.data:
            result = db.table(RECIPIENT_ALIASES_TABLE).update(payload).eq("id", existing.data[0]["id"]).execute()
            rows = result.data or []
            return _normalize_row(rows[0] if rows else payload)
        payload["id"] = str(uuid.uuid4())
        payload["created_at"] = _now_iso()
        result = db.table(RECIPIENT_ALIASES_TABLE).insert(payload).execute()
        rows = result.data or []
        return _normalize_row(rows[0] if rows else payload)

    mem_key = f"{entity_type}:{raw_value_key}"
    row = _mem_aliases.get(mem_key) or {
        "id": str(uuid.uuid4()),
        "created_at": _now_iso(),
    }
    row.update(payload)
    _mem_aliases[mem_key] = row
    return _normalize_row(row)


def _list_aliases(entity_type: str, limit: int = 500) -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        result = (
            db.table(RECIPIENT_ALIASES_TABLE)
            .select("*")
            .eq("entity_type", entity_type)
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        )
        return [_normalize_row(r) for r in (result.data or [])]
    prefix = f"{entity_type}:"
    rows = [r for k, r in _mem_aliases.items() if k.startswith(prefix)]
    rows = sorted(rows, key=lambda x: x.get("updated_at", ""), reverse=True)
    return [_normalize_row(r) for r in rows[:limit]]


def list_attribute_aliases(entity_type: str, limit: int = 500, search: str = "") -> List[Dict[str, Any]]:
    entity = _normalize_key(entity_type)
    rows = _list_aliases(entity, limit=max(limit, 2000))
    needle = str(search or "").strip().lower()
    if needle:
        rows = [
            r
            for r in rows
            if needle in str(r.get("raw_value") or "").lower()
            or needle in str(r.get("normalized_value") or "").lower()
            or needle in str(r.get("canonical_value") or "").lower()
        ]
    return rows[:limit]


def get_attribute_alias_by_id(alias_id: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    if db:
        result = db.table(RECIPIENT_ALIASES_TABLE).select("*").eq("id", alias_id).limit(1).execute()
        rows = result.data or []
        return _normalize_row(rows[0]) if rows else None
    for row in _mem_aliases.values():
        if str(row.get("id") or "") == alias_id:
            return _normalize_row(row)
    return None


def update_attribute_alias(alias_id: str, canonical_value: str, match_method: str = "manual") -> Optional[Dict[str, Any]]:
    canonical_input = str(canonical_value or "").strip()
    if not canonical_input:
        return None

    db = get_db()
    if db:
        existing = db.table(RECIPIENT_ALIASES_TABLE).select("entity_type").eq("id", alias_id).limit(1).execute()
        rows = existing.data or []
        if not rows:
            return None
        entity_type = str(rows[0].get("entity_type") or "")
        canonical = _default_canonical(normalize_attribute_value(canonical_input, entity_type), entity_type, canonical_input)
        payload = {
            "canonical_value": canonical,
            "match_method": match_method,
            "confidence": 1.0,
            "updated_at": _now_iso(),
        }
        result = db.table(RECIPIENT_ALIASES_TABLE).update(payload).eq("id", alias_id).execute()
        updated = result.data or []
        return _normalize_row(updated[0]) if updated else None

    for key, row in _mem_aliases.items():
        if str(row.get("id") or "") != alias_id:
            continue
        entity_type = str(row.get("entity_type") or "")
        canonical = _default_canonical(normalize_attribute_value(canonical_input, entity_type), entity_type, canonical_input)
        row.update(
            {
                "canonical_value": canonical,
                "match_method": match_method,
                "confidence": 1.0,
                "updated_at": _now_iso(),
            }
        )
        _mem_aliases[key] = row
        return _normalize_row(row)
    return None


def create_attribute_alias(entity_type: str, raw_value: str, canonical_value: str, match_method: str = "manual") -> Optional[Dict[str, Any]]:
    entity = _normalize_key(entity_type)
    raw = str(raw_value or "").strip()
    canonical_input = str(canonical_value or "").strip()
    if not entity or not raw or not canonical_input:
        return None
    normalized = normalize_attribute_value(raw, entity)
    canonical = _default_canonical(normalize_attribute_value(canonical_input, entity), entity, canonical_input)
    raw_key = raw.lower().strip()
    return _save_alias(
        entity_type=entity,
        raw_value=raw,
        raw_value_key=raw_key,
        normalized_value=normalized,
        canonical_value=canonical,
        match_method=match_method,
        confidence=1.0,
    )


def resolve_attribute_value(entity_type: str, raw_value: str) -> Tuple[str, Dict[str, Any]]:
    entity = _normalize_key(entity_type)
    raw = str(raw_value or "").strip()
    if not entity or not raw:
        return "", {"match_method": "empty", "confidence": 0.0}

    raw_key = raw.lower().strip()
    normalized = normalize_attribute_value(raw, entity)
    canonical = _default_canonical(normalized, entity, raw)
    match_method = "rule"
    confidence = 1.0

    aliases = _list_aliases(entity, limit=1000)

    exact_raw = next((a for a in aliases if a.get("raw_value_key") == raw_key), None)
    if exact_raw:
        canonical = exact_raw.get("canonical_value") or canonical
        match_method = "exact_raw"
        confidence = 1.0
    else:
        exact_norm = next((a for a in aliases if a.get("normalized_value") == normalized and normalized), None)
        if exact_norm:
            canonical = exact_norm.get("canonical_value") or canonical
            match_method = "exact_normalized"
            confidence = 0.99
        else:
            best_score = 0.0
            best_alias: Optional[Dict[str, Any]] = None
            for alias in aliases:
                alias_norm = str(alias.get("normalized_value") or "")
                if not alias_norm or not normalized:
                    continue
                score = SequenceMatcher(a=normalized, b=alias_norm).ratio()
                if score > best_score:
                    best_score = score
                    best_alias = alias
            if best_alias and best_score >= FUZZY_THRESHOLD:
                canonical = str(best_alias.get("canonical_value") or canonical)
                match_method = "fuzzy"
                confidence = round(float(best_score), 4)

    alias_row = _save_alias(
        entity_type=entity,
        raw_value=raw,
        raw_value_key=raw_key,
        normalized_value=normalized,
        canonical_value=canonical,
        match_method=match_method,
        confidence=confidence,
    )
    return canonical, {
        "entity_type": entity,
        "match_method": match_method,
        "confidence": confidence,
        "normalized_value": normalized,
        "alias_id": alias_row.get("id"),
    }
