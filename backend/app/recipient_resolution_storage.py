from __future__ import annotations

import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
import uuid
from typing import Any, Dict, List, Optional, Tuple

from .config import RECIPIENT_ALIASES_TABLE
from .database import get_db

RECIPIENT_FIELDS = {"empfaenger", "leistungsempfaenger", "recipient", "customer_name"}
FUZZY_THRESHOLD = 0.93

_mem_aliases: Dict[str, Dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _title_case_name(value: str) -> str:
    return " ".join(part.capitalize() for part in value.split(" ") if part)


def normalize_recipient_name(raw: str) -> str:
    value = str(raw or "").strip().lower()
    if not value:
        return ""
    value = value.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    value = re.sub(r"\b(dr|prof|mr|mrs|ms|herr|frau)\.?\b", " ", value)
    value = re.sub(r"[^a-z0-9, ]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()

    if "," in value:
        left, right = [p.strip() for p in value.split(",", 1)]
        if left and right:
            value = f"{right} {left}".strip()

    parts = [p for p in value.split(" ") if p]
    if len(parts) == 2:
        # Deterministic order normalization for two-part person names.
        parts = sorted(parts)
        value = " ".join(parts)

    return value


def _normalize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id"),
        "entity_type": row.get("entity_type") or "recipient",
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
    raw_value: str,
    raw_value_key: str,
    normalized_value: str,
    canonical_value: str,
    match_method: str,
    confidence: float,
) -> Dict[str, Any]:
    db = get_db()
    payload = {
        "entity_type": "recipient",
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
            .eq("entity_type", "recipient")
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

    row = _mem_aliases.get(raw_value_key) or {
        "id": str(uuid.uuid4()),
        "created_at": _now_iso(),
    }
    row.update(payload)
    _mem_aliases[raw_value_key] = row
    return _normalize_row(row)


def _list_aliases(limit: int = 500) -> List[Dict[str, Any]]:
    db = get_db()
    if db:
        result = (
            db.table(RECIPIENT_ALIASES_TABLE)
            .select("*")
            .eq("entity_type", "recipient")
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        )
        return [_normalize_row(r) for r in (result.data or [])]
    rows = sorted(_mem_aliases.values(), key=lambda x: x.get("updated_at", ""), reverse=True)
    return [_normalize_row(r) for r in rows[:limit]]


def list_recipient_aliases(limit: int = 500, search: str = "") -> List[Dict[str, Any]]:
    rows = _list_aliases(limit=max(limit, 2000))
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


def update_recipient_alias(alias_id: str, canonical_value: str, match_method: str = "manual") -> Optional[Dict[str, Any]]:
    canonical = _title_case_name(normalize_recipient_name(canonical_value)) or str(canonical_value or "").strip()
    if not canonical:
        return None

    db = get_db()
    payload = {
        "canonical_value": canonical,
        "match_method": match_method,
        "confidence": 1.0,
        "updated_at": _now_iso(),
    }
    if db:
        result = db.table(RECIPIENT_ALIASES_TABLE).update(payload).eq("id", alias_id).execute()
        rows = result.data or []
        return _normalize_row(rows[0]) if rows else None

    for key, row in _mem_aliases.items():
        if str(row.get("id") or "") != alias_id:
            continue
        row.update(payload)
        _mem_aliases[key] = row
        return _normalize_row(row)
    return None


def resolve_recipient_name(raw_value: str) -> Tuple[str, Dict[str, Any]]:
    raw = str(raw_value or "").strip()
    if not raw:
        return "", {"match_method": "empty", "confidence": 0.0}

    raw_key = raw.lower().strip()
    normalized = normalize_recipient_name(raw)
    canonical = _title_case_name(normalized) if normalized else raw
    match_method = "rule"
    confidence = 1.0

    aliases = _list_aliases(limit=1000)

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
        raw_value=raw,
        raw_value_key=raw_key,
        normalized_value=normalized,
        canonical_value=canonical,
        match_method=match_method,
        confidence=confidence,
    )
    return canonical, {
        "match_method": match_method,
        "confidence": confidence,
        "normalized_value": normalized,
        "alias_id": alias_row.get("id"),
    }
